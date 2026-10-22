import type { Page } from '@playwright/test';
import { PAGES } from '../access/matrix';
import { LOCALE } from '../access/model';
import type { PersonaKey } from '../personas';
import { expect, test } from './fixtures';
import { patternOf } from './explore-support';
import { atRest } from './rest';

/**
 * Somebody who goes through the interface the way a person would, as each persona, on a computer and on a phone: from the
 * first page, every link the page offers is followed, every menu and every dialog it offers is opened, and what a person would
 * notice is written down. The accessibility suite (axe) and the visual one look at pages one by one; this one walks.
 *
 * What a person notices (a finding is a failure, with the page it was seen on and the link that led there):
 *  - a link that leads to a page that does not exist, or that sends a signed-in person to the login page: the interface offered
 *    what the person cannot use;
 *  - a page with no heading or no title of its own, or in another language than its address;
 *  - a page that scrolls sideways on a phone;
 *  - a picture of the platform that does not load;
 *  - a menu or a dialog that breaks the page when it opens (an exception, a console error: the watcher of the journeys adds those
 *    to the failure; and the page must still show its content). The menu of the signed-in person crashed on opening in every
 *    released version until phase 5, because no test ever opened it.
 *
 * Nothing is submitted and nothing is confirmed: links are followed and menus and dialogs opened, never acted on, so the
 * database is left as it was. The walk is bounded (a few pages of each kind of address: a hundred events are not a hundred
 * findings of the same page) and the same on every run: links are followed in the order the pages give them.
 */

/** The addresses of the matrix that `who` is shown (in English, the language of the walk). */
function seenBy(who: PersonaKey): string[] {
  return PAGES.flatMap((page) => page.probes)
    .filter((probe) => probe.expect(who, 'events-enabled').kind === 'ok')
    .map((probe) => `/en${probe.path.slice(LOCALE.length + 1)}`);
}

const MAX_PAGES = 70;
const PER_PATTERN = 2;
const MAX_TRIGGERS = 8;

/** The viewers: everybody who can be somebody (the removed member is sent away at the first request: `public.spec.ts`). */
const WALKERS: readonly PersonaKey[] = [
  'anonymous',
  'pending',
  'member',
  'proposer',
  'validator',
  'custom',
  'admin',
  'owner',
];

const VIEWPORTS = [
  { name: 'computer', size: { width: 1280, height: 900 } },
  { name: 'phone', size: { width: 390, height: 800 } },
] as const;

/** Does this page say that it does not exist (the status, or the not-found page streamed under a 200)? */
async function saysNotFound(page: Page, status: number): Promise<boolean> {
  if (status === 404) return true;
  return page.evaluate(() => {
    const noindex = document.querySelector('meta[name="robots"][content*="noindex"]') !== null;
    const heading = document.querySelector('h1')?.textContent ?? '';
    return noindex && /not found|introuvable/i.test(heading);
  });
}

interface Link {
  href: string;
  text: string;
}

async function linksOf(page: Page): Promise<Link[]> {
  return page.$$eval('a[href]', (anchors) =>
    anchors.map((anchor) => ({
      href: (anchor as HTMLAnchorElement).href,
      text: (
        anchor.getAttribute('aria-label') ||
        anchor.textContent ||
        anchor.getAttribute('title') ||
        ''
      )
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 50),
    })),
  );
}

/** Opens every menu and dialog the page offers (and closes it), and says what went wrong. */
async function openPopups(page: Page, at: string): Promise<string[]> {
  const findings: string[] = [];
  const triggers = page.locator(
    '[aria-haspopup]:not([aria-haspopup="false"]):visible, button[aria-expanded]:visible',
  );
  const count = Math.min(await triggers.count(), MAX_TRIGGERS);
  for (let index = 0; index < count; index += 1) {
    const trigger = triggers.nth(index);
    const name = ((await trigger.getAttribute('aria-label')) ?? (await trigger.innerText()).trim())
      .replace(/\s+/g, ' ')
      .slice(0, 40);
    await trigger
      .click({ timeout: 5_000 })
      .catch(() => findings.push(`${at}: "${name}" could not be clicked`));
    await page.waitForTimeout(250);
    const alive = await page
      .locator('main, [role="main"]')
      .first()
      .isVisible()
      .catch(() => false);
    if (!alive) findings.push(`${at}: the page lost its content when "${name}" was opened`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
  return findings;
}

test.describe('a walk through the interface', () => {
  for (const who of WALKERS) {
    for (const viewport of VIEWPORTS) {
      test(`${who} on a ${viewport.name}`, async ({ as, baseURL }) => {
        test.setTimeout(300_000);
        const page = await as(who, { viewport: viewport.size });
        const locale = 'en';
        const start = who === 'anonymous' ? `/${locale}` : `/${locale}/dashboard`;
        const origin = new URL(baseURL ?? 'http://127.0.0.1:3100').origin;

        const findings: string[] = [];
        const seen = new Set<string>();
        const perPattern = new Map<string, number>();
        const queue: { url: string; from: string; text: string }[] = [
          { url: start, from: '(the first page)', text: '' },
          // and every page of the access matrix this persona is allowed to see: some are offered by no link (the page that says
          // the service is unavailable, the one that says the sign-in was refused)
          ...seenBy(who).map((path) => ({ url: path, from: '(the access matrix)', text: '' })),
        ];
        let visited = 0;

        while (queue.length > 0 && visited < MAX_PAGES) {
          const item = queue.shift()!;
          const target = new URL(item.url, origin);
          const canonical = `${target.pathname}?${[...target.searchParams].sort().join('&')}`;
          if (seen.has(canonical)) continue;
          seen.add(canonical);
          const pattern = patternOf(target.pathname, target.search);
          if ((perPattern.get(pattern) ?? 0) >= PER_PATTERN) continue;
          perPattern.set(pattern, (perPattern.get(pattern) ?? 0) + 1);
          visited += 1;

          const response = await page.goto(target.pathname + target.search, {
            waitUntil: 'domcontentloaded',
          });
          await atRest(page);
          const final = new URL(page.url());
          const where = `${final.pathname}${final.search}`;
          const via = item.text === '' ? item.from : `"${item.text}" on ${item.from}`;
          const status = response?.status() ?? 0;

          if (status >= 400 && status !== 404) {
            findings.push(`${via}: answered ${status}`);
            continue;
          }
          if (await saysNotFound(page, status)) {
            findings.push(`${via}: leads to a page that does not exist (${where})`);
            continue;
          }
          const signedIn = who !== 'anonymous' && who !== 'pending';
          if (signedIn && new RegExp(`^/${locale}/?$`).test(final.pathname)) {
            findings.push(`${via}: sends a signed-in person to the login page`);
            continue;
          }

          // What the page itself must be.
          const facts = await page.evaluate(() => ({
            title: document.title,
            headings: document.querySelectorAll('h1, [role="heading"][aria-level="1"]').length,
            lang: document.documentElement.lang,
            overflow: document.documentElement.scrollWidth - window.innerWidth,
            broken: [...document.images]
              .filter(
                (image) =>
                  image.complete &&
                  image.naturalWidth === 0 &&
                  image.src.startsWith(location.origin),
              )
              .map((image) => image.src.replace(location.origin, '')),
          }));
          if (!/ · /.test(facts.title))
            findings.push(`${where}: the title is "${facts.title}": no title of its own`);
          if (facts.headings === 0) findings.push(`${where}: no heading`);
          const pathLocale = final.pathname.split('/')[1];
          if (facts.lang !== pathLocale)
            findings.push(`${where}: <html lang="${facts.lang}"> on an address in "${pathLocale}"`);
          if (viewport.name === 'phone' && facts.overflow > 1)
            findings.push(`${where}: scrolls sideways by ${facts.overflow}px on a phone`);
          for (const image of facts.broken)
            findings.push(`${where}: the picture ${image} does not load`);

          findings.push(...(await openPopups(page, where)));

          // The pages this one offers, in the order it gives them, within this language and not the API or a file.
          for (const link of await linksOf(page)) {
            const next = new URL(link.href);
            if (next.origin !== origin || (next.hash !== '' && next.pathname === final.pathname))
              continue;
            if (next.pathname.startsWith('/api/') || !next.pathname.startsWith(`/${locale}`))
              continue;
            queue.push({ url: next.pathname + next.search, from: where, text: link.text });
          }
        }

        expect(visited, 'pages visited').toBeGreaterThan(0);
        expect(findings, `${findings.length} finding(s) in ${visited} pages`).toEqual([]);
      });
    }
  }
});
