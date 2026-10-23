import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { atRest } from './rest';

/**
 * The table of the notifications of the settings page, in every engine: a column can be ticked only when its channel is set up,
 * the shortcut of a column ticks all of it, two channels work at once, what is saved is there after a reload, and on a phone the
 * table is a list that does not scroll sideways, with boxes a finger can hit. Nothing is sent: saving a webhook only checks
 * its shape, and the platform of the suite has no channel set up, which the journeys leave as they found it.
 */

const WEBHOOK = 'https://discord.com/api/webhooks/123456789/qa-browsers-secret';
const SLACK = 'https://hooks.slack.com/services/T123/B456/qabrowsers';

/** The form of the notifications: the settings page holds one form per section, each with its own Save button. */
const form = (page: Page) =>
  page.locator('form', { has: page.getByRole('heading', { name: 'Who is told, and where' }) });

// the boxes of the table only: other sections of the page have boxes of their own
const ticked = (page: Page) => form(page).locator('input[type="checkbox"]:checked').count();
const tickable = (page: Page) =>
  form(page).locator('input[type="checkbox"]:not(:disabled)').count();

async function save(page: Page) {
  await form(page).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await atRest(page);
}

/** Whatever happened, the platform is left with no channel set up, as it came. */
async function leaveNoChannel(page: Page) {
  await page.goto('/en/settings');
  for (const name of ['Discord', 'Slack']) {
    const remove = form(page).getByRole('button', { name: `Remove ${name}` });
    if (await remove.isVisible()) await remove.click();
  }
  const keep = form(page).getByRole('button', { name: /^Keep / });
  if ((await keep.count()) > 0) {
    await save(page);
  }
}

test.describe('the table of notifications', () => {
  test('opens with nothing ticked, and a channel to set up before any box', async ({ as }) => {
    const page = await as('owner');
    await page.goto('/en/settings');
    await expect(page.getByRole('heading', { name: 'Who is told, and where' })).toBeVisible();

    await expect.poll(() => ticked(page)).toBe(0);
    // no box can be ticked: every channel is still to be set up
    await expect.poll(() => tickable(page)).toBe(0);
    await expect(form(page).getByRole('button', { name: 'Discord: check all' })).toBeDisabled();
    // the e-mail of a member who was removed does not exist
    await expect(page.getByRole('checkbox', { name: 'Member removed — E-mail' })).toHaveCount(0);
  });

  test('sets up two channels, ticks a column and a box, saves, and finds them after a reload', async ({
    as,
  }) => {
    const page = await as('owner');
    await page.goto('/en/settings');
    try {
      await form(page).getByLabel('Discord webhook address').fill(WEBHOOK);
      await form(page).getByLabel('Slack webhook address').fill(SLACK);
      await expect.poll(() => tickable(page)).toBe(8 + 8);

      await form(page).getByRole('button', { name: 'Discord: check all' }).click();
      await expect.poll(() => ticked(page)).toBe(8);
      await expect(form(page).getByRole('button', { name: 'Discord: clear all' })).toBeVisible();

      await page.getByRole('checkbox', { name: 'Event confirmed — Slack' }).check();
      await save(page);

      await page.reload();
      await expect(page.getByRole('heading', { name: 'Who is told, and where' })).toBeVisible();
      await expect.poll(() => ticked(page)).toBe(9);
      await expect(page.getByRole('checkbox', { name: 'Event confirmed — Slack' })).toBeChecked();
      await expect(page.getByRole('checkbox', { name: 'Event confirmed — Discord' })).toBeChecked();
      await expect(
        page.getByRole('checkbox', { name: 'Event reminder — Slack' }),
      ).not.toBeChecked();
      // an address saved is never shown back, only that there is one
      await expect(page.getByText('Address already saved: leave blank to keep it.')).toHaveCount(2);
      expect(await page.locator('body').innerText()).not.toContain('qa-browsers-secret');
    } finally {
      await leaveNoChannel(page);
    }
  });

  test('refuses a wrong address under its field, and saves nothing', async ({ as }) => {
    const page = await as('owner');
    await page.goto('/en/settings');
    try {
      await form(page).getByLabel('Discord webhook address').fill('https://evil.example/x');
      await form(page).getByRole('button', { name: 'Save' }).click();
      await expect(form(page).getByRole('alert').first()).toBeVisible();
      await page.reload();
      await expect.poll(() => tickable(page)).toBe(0);
    } finally {
      await leaveNoChannel(page);
    }
  });

  test('on a phone is a list of notifications with their boxes, with nothing that scrolls sideways', async ({
    as,
  }) => {
    const page = await as('owner', { viewport: { width: 390, height: 800 } });
    await page.goto('/en/settings');
    try {
      await form(page).getByLabel('Discord webhook address').fill(WEBHOOK);
      await form(page).getByRole('button', { name: 'Discord: check all' }).click();

      const table = page.getByRole('table').filter({ hasText: 'Access request waiting' });
      await table.scrollIntoViewIfNeeded();
      const sideways = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(sideways, 'the page scrolls sideways').toBeLessThanOrEqual(0);
      const tableOverflow = await table.evaluate((element) => {
        const container = element.parentElement;
        return container ? container.scrollWidth - container.clientWidth : 0;
      });
      expect(tableOverflow, 'the table scrolls sideways').toBeLessThanOrEqual(0);

      // each box is in a line a finger can hit: at least 44 px high, and the channel is written next to it
      const line = page
        .getByRole('checkbox', { name: 'Access request waiting — Discord' })
        .locator('xpath=ancestor::label');
      const box = await line.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      await expect(line).toContainText('Discord');
    } finally {
      await leaveNoChannel(page);
    }
  });
});
