/**
 * Pictures of a screen of the platform, in the light and the dark theme, on a computer and on a phone, signed in as a persona:
 * what a person looks at to judge a change of look before it goes further (docs/architecture.md, "Visual regression" holds the
 * automatic comparison; this is for the eyes).
 *
 *   eval "$(sh qa/platform.sh env)"
 *   QA_PREVIEW_DIR=design-ref/captures npx tsx qa/design-preview.ts [--name dashboard] [--path /en/dashboard] [--as validator]
 *                                                                    [--label teal] [--extras]
 *
 * The accent is the platform's (`QA_ACCENT=#E4572E sh qa/platform.sh up …`); `--label` names it in the file names.
 * `--extras` also opens the account menu, the "More" and "Create" sheets and the keyboard focus.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { forgeSessionCookie, persona, SESSION_COOKIE, type PersonaKey } from './personas';

const flag = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? (process.argv[at + 1] ?? fallback) : fallback;
};

const base = process.env.QA_BASE_URL ?? 'http://127.0.0.1:3100';
const secret = process.env.QA_AUTH_SECRET;
if (!secret) throw new Error('QA_AUTH_SECRET is needed (eval "$(sh qa/platform.sh env)")');

const out = process.env.QA_PREVIEW_DIR ?? 'design-ref/captures';
const name = flag('name', 'dashboard');
const path = flag('path', '/en/dashboard');
const who = flag('as', 'validator') as PersonaKey;
const label = flag('label', 'default');
const extras = process.argv.includes('--extras');

const SCREENS = {
  computer: { width: 1440, height: 900 },
  tablet: { width: 820, height: 1100 },
  phone: { width: 390, height: 844 },
} as const;

/** The page at rest: what it asked for has come back, and nothing is still animating. */
async function atRest(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState === 'finished' ||
          animation.effect?.getComputedTiming().iterations === Infinity,
      ),
  );
}

async function signedIn(context: BrowserContext): Promise<void> {
  const account = persona(who);
  if (!account.hasCookie || !account.login) return;
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: await forgeSessionCookie(account.login, secret!),
      url: base,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

async function main(): Promise<void> {
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const theme of ['light', 'dark'] as const) {
      for (const [device, viewport] of Object.entries(SCREENS)) {
        const context = await browser.newContext({
          baseURL: base,
          viewport,
          colorScheme: theme,
          reducedMotion: 'reduce',
          deviceScaleFactor: device === 'phone' ? 2 : 1,
          // A phone has touch and scrollbars that float over the page: without this the picture has a classic scrollbar's gutter.
          isMobile: device === 'phone',
          hasTouch: device === 'phone',
        });
        await signedIn(context);
        const page = await context.newPage();
        await page.goto(path);
        await atRest(page);
        // `next dev` draws its own indicator over the foot of the page: it is not the page.
        await page.evaluate(() =>
          document.querySelectorAll('nextjs-portal').forEach((element) => element.remove()),
        );
        const file = (suffix = '') =>
          join(out, `${name}-${label}-${theme}-${device}${suffix ? `-${suffix}` : ''}.png`);
        if (device === 'phone') {
          // The tab bar is fixed: on a picture of the whole page it would sit in the middle of it. A phone gets the top and the foot.
          await page.screenshot({ path: file('top') });
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await atRest(page);
          await page.screenshot({ path: file('foot') });
          await page.evaluate(() => window.scrollTo(0, 0));
        } else {
          await page.screenshot({ path: file(), fullPage: !process.argv.includes('--viewport') });
        }

        if (extras) {
          if (device === 'phone') {
            await page.getByRole('button', { name: /^(More|Plus)$/ }).click();
            await page.getByRole('dialog').waitFor();
            await atRest(page);
            await page.screenshot({ path: file('more') });
            await page.keyboard.press('Escape');
            const create = page.getByRole('button', { name: /^(Create|Créer)$/ });
            if (await create.count()) {
              await create.click();
              await page.getByRole('dialog').waitFor();
              await atRest(page);
              await page.screenshot({ path: file('create') });
              await page.keyboard.press('Escape');
            }
          } else {
            const account = page.locator('aside button[aria-haspopup="menu"]');
            await account.click();
            await page.getByRole('menu').waitFor();
            await atRest(page);
            await page.screenshot({ path: file('menu') });
            await page.keyboard.press('Escape');
            await page.keyboard.press('Tab');
            await page.keyboard.press('Tab');
            await page.keyboard.press('Tab');
            await page.screenshot({
              path: file('focus'),
              clip: { x: 0, y: 0, width: 700, height: 500 },
            });
          }
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`pictures of ${name} (${label}, ${who}) in ${out}`);
}

void main();
