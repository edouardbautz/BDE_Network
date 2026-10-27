import { test as base, expect, type Page, type Request } from '@playwright/test';
import { SESSION_COOKIE, forgeSessionCookie, persona, type PersonaKey } from '../personas';

export { expect };

/** What a page raised that nobody should see. */
export interface Problems {
  list: string[];
  /**
   * Judges now what was held back until the end (an error worded like a cancelled fetch: see `suspect`). The journey does it by
   * itself when it ends; the tests of the watcher do it to see the verdict. What was judged is not judged twice.
   */
  judge(): void;
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
  // The preview of an e-mail is a frame with `sandbox=""` (it runs no script, whatever the message holds): Playwright puts the init script of
  // this watcher in every frame, and Chromium refuses it there and says so. That is the sandbox doing its work on the tool, not a defect of
  // the page; only that frame (`about:srcdoc`) and that sentence are let through (`watcher.spec.ts` checks a real error still shows).
  /Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed/i,
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
  // React's own word (#412) for a stream of the router that was closed under it: the prefetch it was reading was cancelled.
  /Minified React error #412|Connection closed/i,
];
const RECENTLY_MS = 5000;
/**
 * WebKit does not always say which request a navigation cancelled: a fetch that the page started and that the navigation (or the
 * closing of the page) cut short can raise "Load failed" / "due to access control checks" with no `requestfailed` and no `request`
 * the page could have been waiting for (seen in CI, Linux, one journey in twenty, always on the line of a click that reloads the page
 * or follows a link). So an error worded like a cancellation is also excused when the page left its document within
 * `LEAVING_MS` after it (or just before: the engine can report the commit first). Anywhere else it is still a failure.
 */
const LEAVING_MS = 2000;
const LEAVING_BEFORE_MS = 200;

/**
 * WebKit leaves the rejection of a prefetch that the navigation interrupted unhandled, with its own wording: the address is the
 * router's (`_rsc=` is Next.js's), and the engine does not always say the request was cancelled before it says this. It is the
 * router's to catch, not ours (a known behaviour of Next.js's client in Safari); only this exact message is let through,
 * so that nothing else of the page, a hydration error least of all, can hide behind it.
 */
const INTERRUPTED_PREFETCH = /[?&]_rsc=[\w-]+ due to access control checks\.?$/;

export const test = base.extend<Fixtures>({
  problems: async ({}, use) => {
    const problems: Problems = { list: [], judge: () => {} };
    await use(problems);
    // Said after the test, so that a journey that already failed keeps its own message first.
    expect(problems.list, 'the pages raised errors').toEqual([]);
  },

  as: async ({ browser, baseURL, problems }, use) => {
    const contexts: { close(): Promise<void> }[] = [];
    const judgements: (() => void)[] = [];
    problems.judge = () => {
      for (const judge of judgements) judge();
    };
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
      // When the page left its document (a navigation committed, the page closed): see LEAVING_MS.
      const departures: number[] = [];
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
        for (const { at, what } of suspects.splice(0)) {
          const left = departures.some(
            (departed) => departed - at >= -LEAVING_BEFORE_MS && departed - at < LEAVING_MS,
          );
          if (!left && !cancellations.some((cancelled) => Math.abs(cancelled - at) < RECENTLY_MS)) {
            problems.list.push(
              `${what} (and no request was cancelled around it; the page did, in order: ${trail.join(' | ') || 'nothing'})`,
            );
          }
        }
      });

      // A page that breaks its own content policy (a script that evaluates a string, an inline handler…).
      await page.exposeFunction('__reportViolation', (what: string) =>
        report(`policy violation: ${what}`),
      );
      // What the page gives `console.error` is read where the call is made, in the page, before anything else can happen to it. Read
      // afterwards from here, an object was already gone when the page had navigated meanwhile (a redirect, the next click), and
      // all that was left was "?": the one thing the judgment of a cancelled fetch (`suspect`) needs, its words, was lost.
      await page.exposeFunction('__reportConsoleError', (described: string) => {
        if (NETWORK_WORDS.some((words) => words.test(described))) return;
        if (suspect(described, `console error: ${described}`)) return;
        report(`console error: ${described}`);
      });
      await page.addInitScript(() => {
        const describe = (value: unknown): string => {
          try {
            return value instanceof Error
              ? `${value.name}: ${value.message}`
              : typeof value === 'string'
                ? value
                : (JSON.stringify(value) ?? String(value));
          } catch {
            return String(value);
          }
        };
        const original = console.error;
        console.error = (...args: unknown[]) => {
          try {
            const described = args.map(describe).join(' ').slice(0, 300);
            void Promise.resolve(
              (
                window as unknown as { __reportConsoleError(what: string): unknown }
              ).__reportConsoleError(described),
            ).catch(() => {});
          } catch {
            // the page never fails because of the watcher
          }
          original.apply(console, args);
        };
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
      // The errors the browser writes by itself (a blocked request, a policy) have no arguments; the calls of the page's own code
      // are the ones reported above.
      page.on('console', (message) => {
        if (message.type() !== 'error' || message.args().length > 0) return;
        const text = message.text().slice(0, 300);
        if (NETWORK_WORDS.some((words) => words.test(text))) return;
        if (suspect(text, `console error: ${text}`)) return;
        report(`console error: ${text}`);
      });
      // A request that failed otherwise than by being cancelled (the next click, a page left), or a server error.
      // A request that is still in flight when a navigation replaces the document is cancelled by it, and that is how an engine can word
      // what it raises: WebKit says `Load request cancelled` (a `requestfailed`) on one system and, on another, only an exception of
      // the page ("Fetch API cannot load … due to access control checks", `TypeError: Load failed`) with no `requestfailed` at all.
      // The navigation is the evidence, so it counts as a cancellation: the request was really there, and the page really left. (A
      // journey that clicks right after a debounced request of the page, a preview, met it one time in ten in WebKit.)
      const inFlight = new Set<Request>();
      // What the network and the navigations did, with their times: written under the verdict of a suspect that nothing excused,
      // because "no request was cancelled" is what this is about and a bare sentence does not say what the engine did instead.
      const trail: string[] = [];
      const started = Date.now();
      const note = (what: string) => {
        // (the prefetches Next.js makes by the dozen when a page is drawn would push everything else out of the list)
        if (/GET [^ ]*_rsc=/.test(what)) return;
        trail.push(`+${Date.now() - started}ms ${what}`);
        if (trail.length > 40) trail.shift();
      };
      const shown = (request: Request) =>
        `${request.method()} ${request
          .url()
          .replace(baseURL ?? '', '')
          .slice(0, 70)}`;
      page.on('request', (request) => {
        inFlight.add(request);
        note(`request ${shown(request)}`);
      });
      page.on('requestfinished', (request) => {
        inFlight.delete(request);
        note(`finished ${shown(request)}`);
      });
      const cancelWhatIsInFlight = () => {
        const cancelled = [...inFlight].filter((request) => !request.isNavigationRequest());
        if (cancelled.length > 0) cancellations.push(Date.now());
        inFlight.clear();
      };
      page.on('framenavigated', (frame) => {
        if (frame !== page.mainFrame()) return;
        note(`navigated to ${frame.url().replace(baseURL ?? '', '')}`);
        departures.push(Date.now());
        cancelWhatIsInFlight();
      });
      page.on('close', () => {
        departures.push(Date.now());
        cancelWhatIsInFlight();
      });
      page.on('requestfailed', (request) => {
        inFlight.delete(request);
        const reason = request.failure()?.errorText ?? '';
        note(`failed ${shown(request)} (${reason})`);
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
