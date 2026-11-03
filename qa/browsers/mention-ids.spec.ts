import type { Page } from '@playwright/test';
import { Client } from 'pg';
import { expect, test } from './fixtures';
import { atRest } from './rest';

/**
 * The Discord and Slack ids of the members (docs/design.md, "Asking for the ids"), in every engine, on a computer and on a phone:
 * - **the first sign-in**: after 42 and before the waiting page, a step asks the ids of the platforms the BDE posts on, and cannot be skipped;
 * - **a platform added later**, with a session already open: the next page has a window that cannot be closed (not by Escape, not by a click outside, not
 *   by going elsewhere) until the id is given, and it shows to an owner too, the one who has just added the platform;
 * - **the bypass**: taking the window out of the browser leaves nothing to use, because the server sends nothing else while an id is missing.
 * The ids are not checked for their shape only: the platform asks them for what follows (the account is then signed in, and the ids are in the database).
 */

const DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/123456789/qa-browsers-secret';
const SLACK_WEBHOOK = 'https://hooks.slack.com/services/T123/B456/qabrowsers';
const DISCORD_ID = '348291047563210241';
const SLACK_ID = 'U04ABCD1234';

const SIZES = [
  { name: 'a computer', viewport: { width: 1280, height: 900 } },
  { name: 'a phone', viewport: { width: 390, height: 800 } },
];

const form = (page: Page) =>
  page.locator('form', { has: page.getByRole('heading', { name: 'Who is told, and where' }) });

async function openSettings(page: Page) {
  await page.goto('/en/settings');
  await expect(page.getByRole('heading', { name: 'Who is told, and where' })).toBeVisible();
  await atRest(page);
}

async function save(page: Page) {
  await form(page).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await atRest(page);
}

async function sql(query: string, params: unknown[] = []) {
  const db = new Client({ connectionString: process.env.QA_DATABASE_URL });
  await db.connect();
  try {
    return (await db.query(query, params)).rows;
  } finally {
    await db.end();
  }
}

const resetIds = () => sql(`UPDATE "User" SET "discordUserId" = NULL, "slackUserId" = NULL`);
const idsOf = async (login: string) =>
  (await sql(`SELECT "discordUserId", "slackUserId" FROM "User" WHERE login = $1`, [login]))[0];

/** The owner sets the BDE's webhooks (the platform of the suite has none): from then on the ids of these platforms are asked of everybody. */
async function configure(owner: Page, platforms: ('Discord' | 'Slack')[]) {
  await openSettings(owner);
  for (const platform of platforms) {
    await form(owner)
      .getByLabel(`${platform} webhook address`)
      .fill(platform === 'Discord' ? DISCORD_WEBHOOK : SLACK_WEBHOOK);
  }
  await save(owner);
}

/** Whatever happened, the platform is left as it came: no channel, and nobody with an id. The owner is given one to be able to open the settings. */
async function leaveAsFound(owner: Page) {
  await sql(`UPDATE "User" SET "discordUserId" = $1, "slackUserId" = $2 WHERE login = 'qa-owner'`, [
    DISCORD_ID,
    SLACK_ID,
  ]);
  await openSettings(owner);
  for (const name of ['Discord', 'Slack']) {
    const remove = form(owner).getByRole('button', { name: `Remove ${name}` });
    if (await remove.isVisible()) await remove.click();
  }
  const keep = form(owner).getByRole('button', { name: /^Keep / });
  if ((await keep.count()) > 0) await save(owner);
  await resetIds();
}

const windowOf = (page: Page) => page.getByRole('alertdialog');

for (const size of SIZES) {
  test.describe(`the ids of the members, on ${size.name}`, () => {
    test('are asked at the first sign-in, before the waiting page, and the step cannot be skipped', async ({
      as,
    }) => {
      const owner = await as('owner');
      try {
        await configure(owner, ['Discord', 'Slack']);
        const page = await as('pending', { viewport: size.viewport });

        // wherever the account goes, the step is where it ends
        for (const path of ['/en', '/en/pending', '/en/dashboard', '/en/members']) {
          await page.goto(path);
          await expect(page).toHaveURL(/\/en\/identifiers$/);
        }
        await expect(page.getByRole('heading', { level: 1 })).toContainText('One last detail');
        await expect(page.getByText(/mention you in its notifications/)).toBeVisible();
        const discord = page.getByLabel('Your Discord id', { exact: true });
        const slack = page.getByLabel('Your Slack id', { exact: true });
        await expect(discord).toBeVisible();
        await expect(slack).toBeVisible();
        // the guide: open, and in the words of the device
        await expect(page.getByTestId('guide-discord')).toHaveAttribute('open', '');
        await expect(
          page.getByText(
            size.viewport.width < 600 ? /Long-press your name/ : /Right-click your name/,
          ),
        ).toBeVisible();
        await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

        // empty: refused, on each field, by the server
        await page.getByRole('button', { name: 'Continue' }).click();
        await expect(page.getByText('This id is required to continue.')).toHaveCount(2);
        await expect(page).toHaveURL(/\/en\/identifiers$/);

        // a mention, a name: refused, with a sentence that says what to paste
        await discord.fill('@everyone');
        await discord.blur();
        await expect(page.getByText(/paste the long number/)).toBeVisible();
        await slack.fill('<!channel>');
        await slack.blur();
        await expect(page.getByText(/paste the member ID/)).toBeVisible();
        await page.getByRole('button', { name: 'Continue' }).click();
        await expect(page).toHaveURL(/\/en\/identifiers$/);
        expect(await idsOf('qa-pending')).toEqual({ discordUserId: null, slackUserId: null });

        // good ids: saved, and on to the waiting page
        await discord.fill(DISCORD_ID);
        await slack.fill(SLACK_ID.toLowerCase());
        await expect(page.getByText('Valid id')).toHaveCount(2);
        await page.getByRole('button', { name: 'Continue' }).click();
        await expect(page).toHaveURL(/\/en\/pending$/);
        expect(await idsOf('qa-pending')).toEqual({
          discordUserId: DISCORD_ID,
          slackUserId: SLACK_ID,
        });
        // and the step is not asked again
        await page.goto('/en/identifiers');
        await expect(page).toHaveURL(/\/en\/pending$/);
      } finally {
        await leaveAsFound(owner);
      }
    });

    test('are asked in a window that cannot be closed, over any page, when a platform is added with the session open', async ({
      as,
    }) => {
      const owner = await as('owner');
      const member = await as('member', { viewport: size.viewport });
      try {
        // before: the platform posts nowhere, nothing is asked
        await member.goto('/en/events');
        await atRest(member);
        await expect(windowOf(member)).toHaveCount(0);
        await expect(member.getByRole('heading', { level: 1 })).toBeVisible();

        await configure(owner, ['Slack']);

        // the very next page of the member, with the same session
        await member.goto('/en/events');
        const dialog = windowOf(member);
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveAccessibleName('Your Slack id is missing');
        await expect(member.getByLabel('Your Slack id', { exact: true })).toBeFocused();
        await expect(member.getByLabel('Your Discord id', { exact: true })).toHaveCount(0);
        await expect(member.getByRole('button', { name: 'Sign out' })).toBeVisible();

        // it cannot be closed: Escape, a click outside, going elsewhere
        await member.keyboard.press('Escape');
        await expect(dialog).toBeVisible();
        await member.mouse.click(3, 3);
        await expect(dialog).toBeVisible();
        for (const path of ['/en/dashboard', '/en/profile', '/en/events/new']) {
          await member.goto(path);
          await expect(windowOf(member)).toBeVisible();
        }
        await member.goBack();
        await expect(windowOf(member)).toBeVisible();

        // the focus is trapped: Tab goes round inside it
        for (let presses = 0; presses < 14; presses += 1) {
          await member.keyboard.press('Tab');
          // (the focus passes a guard at the edge of the window for a moment: it is polled, not read once)
          await expect
            .poll(() =>
              member.evaluate(() => !!document.activeElement?.closest('[role="alertdialog"]')),
            )
            .toBe(true);
        }

        // a wrong id, then the right one
        const field = member.getByLabel('Your Slack id', { exact: true });
        await field.fill('@everyone');
        await field.blur();
        await expect(member.getByText(/paste the member ID/)).toBeVisible();
        await member.getByRole('button', { name: 'Save' }).click();
        await expect(windowOf(member)).toBeVisible();
        await field.fill(SLACK_ID);
        await member.getByRole('button', { name: 'Save' }).click();
        await expect(windowOf(member)).toHaveCount(0);
        await atRest(member);
        await expect(member.getByRole('heading', { level: 1 })).toBeVisible();
        expect(await idsOf('qa-member')).toMatchObject({ slackUserId: SLACK_ID });
      } finally {
        await leaveAsFound(owner);
      }
    });
  });
}

test.describe('the ids of the members, for everybody', () => {
  test('are asked of the owner who has just added the platform, as of anybody else', async ({
    as,
  }) => {
    const owner = await as('owner');
    try {
      await configure(owner, ['Discord']);
      await owner.goto('/en/dashboard');
      const dialog = windowOf(owner);
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAccessibleName('Your Discord id is missing');
      // nothing of the platform is reachable meanwhile: not even the settings the owner just left
      await owner.goto('/en/settings');
      await expect(windowOf(owner)).toBeVisible();
      await expect(owner.getByRole('heading', { name: 'Who is told, and where' })).toHaveCount(0);
      await owner.getByLabel('Your Discord id', { exact: true }).fill(DISCORD_ID);
      await owner.getByRole('button', { name: 'Save' }).click();
      await expect(windowOf(owner)).toHaveCount(0);
      await expect(owner.getByRole('heading', { name: 'Who is told, and where' })).toBeVisible();
    } finally {
      await leaveAsFound(owner);
    }
  });

  test('cannot be got round by taking the window out of the browser: the server sends nothing else, and refuses the rest', async ({
    as,
  }) => {
    const owner = await as('owner');
    const member = await as('member');
    try {
      // what the member could read before
      await member.goto('/en/events?view=list');
      await atRest(member);
      const title = (await member.locator('a[data-row-link]').first().innerText()).trim();
      expect(title.length).toBeGreaterThan(2);

      await configure(owner, ['Discord']);

      for (const path of ['/en/events?view=list', '/en/dashboard', '/en/members', '/en/profile']) {
        await member.goto(path);
        await expect(windowOf(member)).toBeVisible();
        // the window is taken out, and so is its veil
        await member.evaluate(() => {
          document
            .querySelectorAll('[role="alertdialog"], [data-slot="dialog-overlay"]')
            .forEach((node) => node.remove());
        });
        // there is nothing left to use: no menu, no page, none of what the member read before
        await expect(member.getByRole('navigation')).toHaveCount(0);
        await expect(member.getByText(title)).toHaveCount(0);
        expect(await member.locator('body').innerText()).not.toContain(title);

        // the server itself sends nothing of the page, whoever asks, with the member's own cookie
        const html = await (await member.request.get(path)).text();
        expect(html).not.toContain(title);
        // what the server sends instead: the gate, with no page in it
        expect(html).toContain('data-mention-ids-gate');
      }
      // what is not a page is refused too: the calendar download of an event, and the feeds that need the member's session
      expect((await member.request.get('/api/events/qa-evt-0001/ics')).status()).toBe(404);
      // The one thing that stays open is the copy of one's own data (the right of access does not wait for more data to be given): it holds the
      // account's own rows only, filtered on the account's id as for anybody, and none of the events read above.
      const copy = await member.request.get('/api/me/export');
      expect(copy.status()).toBe(200);
      expect(await copy.text()).not.toContain(title);
    } finally {
      await leaveAsFound(owner);
    }
  });
});
