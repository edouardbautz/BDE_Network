import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { atRest } from './rest';

/**
 * The secrets of the settings page, in every engine. A browser fills what looks like a login (a text field followed by a password field)
 * and offers to save what is typed in a password field: the mail server's user got an address of another site and the webhook of Discord a
 * saved password, and a test then sent that password as the address. So: no field of the page is of the type `password`, every field of a
 * secret or of a service's identifier tells the managers to leave it alone, and a secret that is saved is not a field at all ("Configured ·
 * ends with …a1b2", with Replace and Remove), so there is nothing to fill. An empty field changes nothing, and a test uses the saved one.
 *
 * What cannot be played here is a browser that has a password saved: a headless engine has no password manager. The page is held to what
 * a manager reads: the type of the fields, their attributes, and that no field holds a saved secret.
 */

const WEBHOOK = 'https://discord.com/api/webhooks/123456789/qa-browsers-secret';
const REPLACEMENT = 'https://discord.com/api/webhooks/123456789/qa-browsers-newone';

const form = (page: Page) =>
  page.locator('form', { has: page.getByRole('heading', { name: 'Who is told, and where' }) });
const channel = (page: Page) => page.getByRole('group', { name: 'Discord webhook address' });
const field = (page: Page) => page.getByRole('textbox', { name: 'Discord webhook address' });

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

/** Whatever happened, the platform is left with no channel set up, as it came. */
async function leaveNoChannel(page: Page) {
  await openSettings(page);
  for (const name of ['Discord', 'Slack']) {
    const remove = form(page).getByRole('button', { name: `Remove ${name}` });
    if (await remove.isVisible()) await remove.click();
  }
  if (
    (await form(page)
      .getByRole('button', { name: /^Keep / })
      .count()) > 0
  )
    await save(page);
}

test.describe('the secrets of the settings page', () => {
  test('are in no field of the type password, and each field tells the managers to leave it alone', async ({
    as,
  }) => {
    const page = await as('owner');
    await openSettings(page);

    expect(await page.locator('input[type="password"]').count()).toBe(0);
    // every field that takes a secret or the identifier of a service: the address of a webhook, the mail server (its user, its password,
    // its sender), the application of 42
    const fields = [
      form(page).getByRole('textbox', { name: 'Discord webhook address' }),
      form(page).getByRole('textbox', { name: 'Slack webhook address' }),
      form(page).getByRole('textbox', { name: 'Login (optional)' }),
      form(page).getByRole('textbox', { name: 'Password (optional)' }),
      form(page).getByRole('textbox', { name: 'Sender address' }),
    ];
    for (const one of fields) {
      await expect(one).toHaveAttribute('autocomplete', 'off');
      await expect(one).toHaveAttribute('data-1p-ignore', 'true');
      await expect(one).toHaveAttribute('data-lpignore', 'true');
      await expect(one).toHaveAttribute('data-bwignore', 'true');
      await expect(one).toHaveAttribute('data-form-type', 'other');
      await expect(one).not.toHaveAttribute('type', 'password');
      await expect(one).not.toHaveAttribute('type', 'email');
    }
    // the password and the webhooks are drawn as dots, in the three engines, by the style and not by the type of the field
    for (const one of [fields[0]!, fields[1]!, fields[3]!]) {
      const security = await one.evaluate((element) =>
        getComputedStyle(element).getPropertyValue('-webkit-text-security'),
      );
      expect(security).toBe('disc');
    }
    // the mail user is a plain field: it must stay readable
    expect(
      await fields[2]!.evaluate((element) =>
        getComputedStyle(element).getPropertyValue('-webkit-text-security'),
      ),
    ).not.toBe('disc');
  });

  test('a saved one is a statement, not a field; Replace opens an empty field, Cancel closes it', async ({
    as,
  }) => {
    const page = await as('owner');
    await openSettings(page);
    try {
      await field(page).fill(WEBHOOK);
      await save(page);
      await page.reload();
      await atRest(page);

      // nothing a browser can fill: no field, and not a word of the address in the page
      await expect(field(page)).toHaveCount(0);
      await expect(channel(page)).toContainText('Configured · ends with …cret');
      const source = await page.content();
      expect(source).not.toContain('qa-browsers-secret');
      expect(source).not.toContain('webhooks/123456789');
      expect(await page.locator('input[type="password"]').count()).toBe(0);

      await page.getByRole('button', { name: 'Replace: Discord webhook address' }).click();
      await expect(field(page)).toBeVisible();
      await expect(field(page)).toHaveValue('');
      await expect(field(page)).toHaveAttribute('data-1p-ignore', 'true');
      await expect(page.getByText('Leave it empty to keep the one that is saved.')).toBeVisible();
      await page
        .getByRole('button', { name: 'Cancel the replacement: Discord webhook address' })
        .click();
      await expect(field(page)).toHaveCount(0);
      await expect(channel(page)).toContainText('Configured');
    } finally {
      await leaveNoChannel(page);
    }
  });

  test('an empty field changes nothing, and a test goes to the address that is saved', async ({
    as,
  }) => {
    const page = await as('owner');
    await openSettings(page);
    try {
      await field(page).fill(WEBHOOK);
      await save(page);
      await page.reload();
      await atRest(page);

      // a field opened and left empty, then Save: the address is still there
      await page.getByRole('button', { name: 'Replace: Discord webhook address' }).click();
      await save(page);
      await page.reload();
      await atRest(page);
      await expect(channel(page)).toContainText('Configured · ends with …cret');

      // the test is sent to the saved address: it fails, or arrives, but it is never refused as "not a Discord address", which is what a
      // password put in the field by a browser said
      await form(page).getByRole('button', { name: 'Send a test on Discord' }).click();
      await expect(
        form(page)
          .getByText(/Test sent on Discord|Sending failed/)
          .first(),
      ).toBeVisible({ timeout: 30_000 });
      await expect(form(page).getByText(/not a Discord webhook address/i)).toHaveCount(0);
    } finally {
      await leaveNoChannel(page);
    }
  });

  test('a new one replaces the saved one, and a wrong one is refused under its field', async ({
    as,
  }) => {
    const page = await as('owner');
    await openSettings(page);
    try {
      await field(page).fill(WEBHOOK);
      await save(page);
      await page.reload();
      await atRest(page);

      await page.getByRole('button', { name: 'Replace: Discord webhook address' }).click();
      await field(page).fill('hunter2 is my password');
      await form(page).getByRole('button', { name: 'Save' }).click();
      await expect(form(page).getByRole('alert').first()).toBeVisible();
      // refused: the one that was saved is still there
      await page.reload();
      await atRest(page);
      await expect(channel(page)).toContainText('…cret');

      await page.getByRole('button', { name: 'Replace: Discord webhook address' }).click();
      await field(page).fill(REPLACEMENT);
      await save(page);
      await page.reload();
      await atRest(page);
      await expect(channel(page)).toContainText('Configured · ends with …wone');
      expect(await page.content()).not.toContain('qa-browsers-newone');
    } finally {
      await leaveNoChannel(page);
    }
  });

  test('on a phone: Replace and Remove are buttons a finger can hit, and nothing scrolls sideways', async ({
    as,
  }) => {
    const page = await as('owner', { viewport: { width: 390, height: 800 } });
    await openSettings(page);
    try {
      await field(page).fill(WEBHOOK);
      await save(page);
      await page.reload();
      await atRest(page);
      for (const name of ['Replace: Discord webhook address', 'Remove Discord']) {
        const box = await page.getByRole('button', { name }).boundingBox();
        expect(box?.height, name).toBeGreaterThanOrEqual(44);
      }
      const sideways = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(sideways).toBeLessThanOrEqual(0);
    } finally {
      await leaveNoChannel(page);
    }
  });
});
