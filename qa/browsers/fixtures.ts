import { test as base, expect, type ConsoleMessage, type Page } from '@playwright/test';
import { SESSION_COOKIE, forgeSessionCookie, persona, type PersonaKey } from '../personas';

export { expect };

/** What a page raised that nobody should see. */
export interface Problems {
  list: string[];
}

interface Fixtures {
  /** A page signed in as a persona (a fresh browser context each time), watched for what it should never do. */
  as: (
    who: PersonaKey,
    options?: {
      viewport?: { width: number; height: number };
      /** The scheme the browser reports: with no choice made in the interface, the theme follows it. */
      colorScheme?: 'light' | 'dark';
    },
  ) => Promise<Page>;
  problems: Problems;
}

const secret = () => {
  const value = process.env.QA_AUTH_SECRET;
  if (!value) throw new Error('QA_AUTH_SECRET is needed (eval "$(sh qa/platform.sh env)")');
  return value;
};

/**
 * What a browser writes for a request that did not complete, whatever the cause (Chromium: "Failed to load resource"). The
 * cause is looked at where it can be told apart: the network events below. A CSP violation has its own event, the same in
 * every engine (Firefox also writes it to the console, Chromium does not).
 */
const NETWORK_WORDS = [
  /Failed to load resource/i,
  /Content-Security-Policy/i,
  // The tracer's fetch of a blob image (see below), as Chromium words it in the console.
  /Connecting to 'blob:/i,
];

/**
 * While a test is traced, Playwright's snapshotter reads the images of the page again with `fetch`, from inside the page:
 * the preview of a file just chosen (a `blob:` address) is refused by `connect-src 'self'`, which is the policy doing its work
 * on the tool, not a defect of the page (without a trace, no violation: checked). Only that case is let through, by the
 * listener below (it runs in the page, so the rule is written there) and by the console pattern above.
 */

/**
 * How the engines word a fetch that a navigation cancelled: Next.js prefetches the pages a link leads to, and the click that
 * comes next cancels the ones still on their way. Firefox says "NS_BASE_STREAM_CLOSED" or "Error in input stream", WebKit
 * "Load failed" or "Fetch API cannot load … due to access control checks" (as an unhandled rejection too). They are not
 * defects of the platform, but only when a request was in fact cancelled a moment before: the same words with nothing
 * cancelled are a real failure.
 */
const CANCELLED_REQUEST = /cancel|abort|NS_BASE_STREAM_CLOSED|NS_BINDING_ABORTED/i;
const CANCELLATION_WORDS = [
  /Load failed/i,
  /due to access control checks/i,
  /Error in input stream/i,
  /NetworkError/i,
  /NS_BASE_STREAM_CLOSED/i,
];
const RECENTLY_MS = 5000;

/**
 * WebKit leaves the rejection of a prefetch that the navigation interrupted unhandled, with its own wording: the address is the
 * router's (`_rsc=` is Next.js's), and the engine does not always say the request was cancelled before it says this. It is the
 * router's to catch, not ours (a known behaviour of Next.js's client in Safari); only this exact message is let through,
 * so that nothing else of the page, a hydration error least of all, can hide behind it.
 */
const INTERRUPTED_PREFETCH = /[?&]_rsc=[\w-]+ due to access control checks\.?$/;

/** Reads what `console.error` was given, whatever it was (an object is `JSHandle@object` in `text()`). */
async function describeConsole(message: ConsoleMessage): Promise<string> {
  const parts = await Promise.all(
    message
      .args()
      .map((argument) =>
        argument
          .evaluate((value: unknown) =>
            value instanceof Error
              ? `${value.name}: ${value.message}`
              : typeof value === 'string'
                ? value
                : JSON.stringify(value),
          )
          .catch(() => '?'),
      ),
  );
  return (parts.join(' ') || message.text()).slice(0, 300);
}

export const test = base.extend<Fixtures>({
  problems: async ({}, use) => {
    const problems: Problems = { list: [] };
    await use(problems);
    // Said after the test, so that a journey that already failed keeps its own message first.
    expect(problems.list, 'the pages raised errors').toEqual([]);
  },

  as: async ({ browser, baseURL, problems }, use) => {
    const contexts: { close(): Promise<void> }[] = [];
    const judgements: (() => void)[] = [];
    await use(async (who, options = {}) => {
      const account = persona(who);
      const context = await browser.newContext({
        baseURL,
        viewport: options.viewport,
        colorScheme: options.colorScheme,
      });
      contexts.push(context);
      if (account.hasCookie && account.login) {
        await context.addCookies([
          {
            name: SESSION_COOKIE,
            value: await forgeSessionCookie(account.login, secret()),
            url: baseURL ?? 'http://127.0.0.1:3100',
            httpOnly: true,
            sameSite: 'Lax',
          },
        ]);
      }
      const page = await context.newPage();
      const report = (what: string) => problems.list.push(`[${who}] ${page.url()}: ${what}`);
      const cancellations: number[] = [];
      // What is worded like a cancelled fetch is judged at the end, by its distance from a request that really was
      // cancelled: the engine can tell us about the error before it tells us about the request.
      const suspects: { at: number; what: string }[] = [];
      /** True (and kept apart) when what was raised may only be the engine's word for a request a navigation cancelled. */
      const suspect = (text: string, what: string) => {
        if (INTERRUPTED_PREFETCH.test(text.trim())) return true;
        if (!CANCELLATION_WORDS.some((words) => words.test(text))) return false;
        suspects.push({ at: Date.now(), what: `[${who}] ${page.url()}: ${what}` });
        return true;
      };
      judgements.push(() => {
        for (const { at, what } of suspects) {
          if (!cancellations.some((cancelled) => Math.abs(cancelled - at) < RECENTLY_MS)) {
            problems.list.push(`${what} (and no request was cancelled around it)`);
          }
        }
      });

      // A page that breaks its own content policy (a script that evaluates a string, an inline handler…).
      await page.exposeFunction('__reportViolation', (what: string) =>
        report(`policy violation: ${what}`),
      );
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => {
          if (event.violatedDirective.startsWith('connect-src') && event.blockedURI === 'blob')
            return; // the tracer's fetch
          const where = event.sourceFile
            ? ` at ${event.sourceFile.split('/').pop()}:${event.lineNumber}`
            : '';
          (window as unknown as { __reportViolation(what: string): void }).__reportViolation(
            `${event.violatedDirective} blocked ${event.blockedURI || event.sample || 'something'}${where}`,
          );
        });
      });

      page.on('pageerror', (error) => {
        if (!suspect(error.message, `exception: ${error.message}`))
          report(`exception: ${error.message}`);
      });
      page.on('console', async (message) => {
        if (message.type() !== 'error') return;
        const text = message.text();
        if (NETWORK_WORDS.some((words) => words.test(text))) return;
        const described = await describeConsole(message);
        if (suspect(`${text} ${described}`, `console error: ${described}`)) return;
        report(`console error: ${described}`);
      });
      // A request that failed otherwise than by being cancelled (the next click, a page left), or a server error.
      page.on('requestfailed', (request) => {
        const reason = request.failure()?.errorText ?? '';
        if (CANCELLED_REQUEST.test(reason)) {
          cancellations.push(Date.now());
          return;
        }
        report(
          `request failed: ${request.method()} ${request.url().replace(baseURL ?? '', '')} (${reason})`,
        );
      });
      page.on('response', (response) => {
        if (response.status() >= 500)
          report(`server error: ${response.status()} ${response.url().replace(baseURL ?? '', '')}`);
      });
      return page;
    });
    for (const judge of judgements) judge();
    for (const context of contexts) await context.close();
  },
});
