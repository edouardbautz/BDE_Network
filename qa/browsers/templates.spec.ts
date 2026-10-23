import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { atRest } from './rest';

/**
 * The page where a BDE customises its notifications, in every engine: who may open it, what is typed is drawn at once in the
 * preview and written down by Save, a channel can be made different and brought back, the facts are moved with buttons (a
 * keyboard does it), a variable is inserted where the cursor is, somebody to mention is added to the directory and taken off,
 * and on a phone the editor stacks and never scrolls sideways. Nothing is sent: the platform of the suite has no channel set up,
 * and each journey puts the templates back as it found them (none).
 */

const PATH = '/en/notifications?type=memberPending';

async function open(page: Page, path = PATH) {
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
  await atRest(page);
}

/** Whatever a journey did, the templates are back to none: the next one starts from the platform's own words. */
async function putBack(page: Page) {
  await open(page);
  await page.getByRole('button', { name: 'More' }).click();
  const all = page.getByRole('menuitem', { name: /Reset everything/ });
  // the menu is open before it is asked whether an entry is enabled: that answer is given at once and does not wait
  await expect(all).toBeVisible();
  if (await all.isEnabled()) {
    await all.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Back to default' }).click();
    await expect(page.getByText(/Every channel is back/)).toBeVisible();
  } else {
    await page.keyboard.press('Escape');
  }
}

test.describe('who may open the page', () => {
  for (const who of ['owner', 'admin'] as const) {
    test(`${who} opens it and sees every notification`, async ({ as }) => {
      const page = await as(who);
      await open(page);
      const list = page.getByRole('navigation', { name: 'Notifications to customise' });
      for (const name of [
        'Event confirmed',
        'Event reminder',
        'Proposal refused',
        'Access request waiting',
        'Member removed',
      ]) {
        await expect(list.getByRole('link', { name })).toBeVisible();
      }
      await expect(page.getByRole('tab', { name: 'All channels' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });
  }

  test('a member who does not hold the right is sent back to the dashboard, with no menu entry', async ({
    as,
  }) => {
    const page = await as('custom');
    await page.goto('/en/notifications');
    await expect(page).toHaveURL(/\/en\/dashboard/);
    await expect(page.getByRole('link', { name: 'Messages' })).toHaveCount(0);
  });
});

test.describe('writing a template', () => {
  test('is drawn in the preview as it is typed, saved, found again after a reload, and put back', async ({
    as,
  }) => {
    const page = await as('owner');
    await open(page);
    try {
      const title = page.getByLabel('Title', { exact: true });
      await expect(title).toHaveValue('{name}');
      await title.fill('Hello {name}!');
      // the preview is the real notification, drawn by the server, with the example person
      const card = page.getByTestId('preview-discord');
      await expect(card).toContainText('Hello');
      await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();

      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
      await expect(page.getByText('Unsaved changes')).toHaveCount(0);

      await open(page);
      await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Hello {name}!');
      await expect(page.getByTestId('preview-discord')).toContainText('Hello');
      // the list says which notifications were customised
      await expect(
        page
          .getByRole('navigation', { name: 'Notifications to customise' })
          .getByRole('link', { name: /Access request waiting/ }),
      ).toContainText('Customised');
    } finally {
      await putBack(page);
    }
  });

  test('says what is wrong with a variable that does not exist, and keeps the last good picture', async ({
    as,
  }) => {
    const page = await as('owner');
    await open(page);
    await page.getByLabel('Title', { exact: true }).fill('{nothing}');
    await expect(page.getByText(/last valid version/)).toBeVisible();
    await expect(page.getByText('Unknown variable: nothing.')).toBeVisible();
    await expect(page.getByTestId('preview-discord')).toBeVisible();
  });

  test('inserts a variable where the cursor is', async ({ as }) => {
    const page = await as('owner');
    await open(page);
    const eyebrow = page.getByLabel('Small text above the title');
    await eyebrow.fill('Hello !');
    await eyebrow.evaluate((element: HTMLInputElement) => element.setSelectionRange(6, 6));
    await page.getByRole('button', { name: 'Insert a variable' }).first().click();
    await page.getByRole('menuitem', { name: /\{login\}/ }).click();
    await expect(eyebrow).toHaveValue('Hello {login}!');
  });

  test('moves a fact with the keyboard, and stores the new order', async ({ as }) => {
    const page = await as('owner');
    await open(page);
    try {
      const rows = page.getByTestId(/^item-/);
      await expect(rows.first()).toHaveAttribute('data-testid', 'item-summary');
      await page.getByRole('button', { name: 'Move down: Introductory sentence' }).focus();
      await page.keyboard.press('Enter');
      await expect(rows.first()).toHaveAttribute('data-testid', 'item-login');
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
      await open(page);
      await expect(page.getByTestId(/^item-/).first()).toHaveAttribute('data-testid', 'item-login');
    } finally {
      await putBack(page);
    }
  });
});

test.describe('a channel', () => {
  test('follows the common template, is customised, then goes back to it', async ({ as }) => {
    const page = await as('owner');
    await open(page);
    try {
      await page.getByRole('tab', { name: 'Slack' }).click();
      await expect(page.getByText('Slack follows the common template')).toBeVisible();
      await expect(page.getByLabel('Title', { exact: true })).toHaveCount(0);

      await page.getByRole('button', { name: 'Customise this channel' }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Customise this channel' })
        .click();
      await expect(page.getByText('This channel now has its own template.')).toBeVisible();
      await atRest(page);
      await expect(page.getByLabel('Title', { exact: true })).toBeVisible();

      await page.getByRole('button', { name: 'Back to the common template' }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Back to the common template' })
        .click();
      await expect(page.getByText('Slack follows the common template')).toBeVisible();
    } finally {
      await putBack(page);
    }
  });

  test('cannot be tested while no channel is set up, and says so', async ({ as }) => {
    const page = await as('owner');
    await open(page);
    await expect(page.getByRole('button', { name: 'Send a test on Discord' })).toBeDisabled();
    await expect(page.getByText(/Discord is not set up/)).toBeVisible();
  });
});

test.describe('the people a message can mention', () => {
  test('are added to the directory of a channel and taken off', async ({ as }) => {
    const page = await as('owner');
    await open(page, `${PATH}&scope=discord`);
    try {
      await page.getByRole('button', { name: 'Customise this channel' }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Customise this channel' })
        .click();
      await atRest(page);

      await page.getByRole('button', { name: 'Mention' }).click();
      await page.getByRole('menuitem', { name: /Manage people and roles/ }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Displayed name').fill('The board');
      await dialog.getByLabel('Identifier').fill('123456789012345678');
      await dialog.getByRole('button', { name: 'Add' }).click();
      await expect(dialog.getByRole('button', { name: 'Remove The board' })).toBeVisible();

      // a wrong identifier is refused with a sentence
      await dialog.getByLabel('Displayed name').fill('Nobody');
      await dialog.getByLabel('Identifier').fill('12');
      await dialog.getByRole('button', { name: 'Add' }).click();
      await expect(dialog.getByRole('alert')).toContainText('does not have the expected shape');

      await dialog.getByRole('button', { name: 'Remove The board' }).click();
      await expect(dialog.getByRole('button', { name: 'Remove The board' })).toHaveCount(0);
    } finally {
      await page.keyboard.press('Escape');
      await putBack(page);
    }
  });
});

test.describe('on a phone', () => {
  test('stacks the editor, shows the preview on its own, and never scrolls sideways', async ({
    as,
  }) => {
    const page = await as('owner', { viewport: { width: 390, height: 844 } });
    await open(page);
    const sideways = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
    expect(await sideways(), 'the editor scrolls sideways on a phone').toBe(false);

    // the preview is a view of its own, not squeezed beside the fields
    await expect(page.getByTestId('preview-discord')).toBeHidden();
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.getByTestId('preview-discord')).toBeVisible();
    await expect(page.getByLabel('Title', { exact: true })).toBeHidden();
    expect(await sideways()).toBe(false);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();

    // a fact: its name and switch, then its fields below, never side by side
    const row = page.getByTestId('item-login');
    const name = await row.getByText('Login', { exact: true }).first().boundingBox();
    const field = await row.getByLabel('Name').boundingBox();
    expect(name && field && field.y > name.y + name.height - 1).toBe(true);
    expect(field && field.width > 200).toBe(true);
  });
});
