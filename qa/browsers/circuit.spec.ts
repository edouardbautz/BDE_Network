import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The proposal circuit end to end, in every engine, as the people it was made for: somebody who proposes an event (the
 * form, with the date fields and the preview of a repeat rule), somebody who validates (validates, refuses with a comment),
 * and a member who reads the result. It also plays the confirmation dialog, which every destructive action goes through
 * (focus, keyboard, Escape). Every journey makes its own events, named after the engine, so engines never meet on the same data.
 */

/** A day well ahead, so the event is always upcoming whatever day the suite runs on, as `YYYY-MM-DD`. */
const aDayAhead = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** Fills the form of a new event as a proposer, sends it, and returns the address of its page. */
async function propose(
  page: Page,
  { title, day, repeatAfter }: { title: string; day: string; repeatAfter?: number },
): Promise<string> {
  await page.goto(`/en/events/new?date=${day}`);
  await expect(page.getByRole('heading', { name: 'New event', level: 1 })).toBeVisible();
  await page.getByRole('textbox', { name: 'Title' }).fill(title);
  await page.getByRole('combobox', { name: 'Category' }).selectOption({ label: 'Sport' });
  // The two fields of date and time are the browser's own (datetime-local): the part of the suite that differs most by engine.
  await page.getByRole('textbox', { name: 'Start' }).fill(`${day}T19:00`);
  await page.getByRole('textbox', { name: 'End' }).fill(`${day}T21:30`);
  await page.getByRole('textbox', { name: 'Location' }).fill('Gymnase');
  await page
    .getByRole('textbox', { name: 'Description' })
    .fill('Created by the browser suite.\nSecond line.');

  if (repeatAfter) {
    const repeat = page.getByRole('combobox', { name: 'Repeat' });
    const weekly =
      (await repeat.locator('option', { hasText: /^Every week on/ }).textContent())?.trim() ?? '';
    await repeat.selectOption({ label: weekly });
    await page.getByRole('radio', { name: 'After' }).check();
    await page.getByRole('spinbutton', { name: 'Number of occurrences' }).fill(String(repeatAfter));
    // The preview is computed by the same code as the server's, and says the rule in one sentence.
    const preview = page.getByRole('status', { name: 'Preview' });
    await expect(preview).toContainText('Every week on');
    await expect(preview).toContainText(String(repeatAfter));
  }

  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(page).toHaveURL(/\/en\/events\/[^/?]+/);
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  return new URL(page.url()).pathname;
}

const nameOf = (engine: string, what: string) => `PW ${engine} ${what} ${Date.now()}`;

test.describe('the proposal circuit', () => {
  test('a proposer proposes a weekly event, a validator approves it, and a member reads it', async ({
    as,
  }, testInfo) => {
    const title = nameOf(testInfo.project.name, 'weekly');
    const proposer = await as('proposer');
    const path = await propose(proposer, { title, day: aDayAhead(40), repeatAfter: 3 });

    // Only the author and the validators can see it, and the author can still take it back.
    await expect(proposer.getByText('Awaiting validation').first()).toBeVisible();
    await expect(proposer.getByRole('button', { name: 'Withdraw the proposal' })).toBeVisible();
    await expect(proposer.getByRole('button', { name: 'Validate' })).toHaveCount(0);

    const member = await as('member');
    const hidden = await member.goto(path);
    await expect
      .poll(
        async () =>
          hidden?.status() === 404 || (await member.getByText('Page not found').isVisible()),
      )
      .toBe(true);

    // The validator finds it counted in the menu and in the list, and approves it.
    const validator = await as('validator');
    await validator.goto('/en/events/review');
    await expect(validator.getByRole('heading', { name: 'To validate', level: 1 })).toBeVisible();
    const row = validator
      .getByRole('listitem')
      .filter({ has: validator.getByRole('link', { name: title }) });
    await expect(row).toContainText('Proposed by QA proposer');
    await expect(row).toContainText('Every week on');
    await row.getByRole('button', { name: 'Validate' }).click();
    const approval = validator.getByRole('dialog', { name: 'Validate this proposal?' });
    await expect(approval).toBeVisible();
    await approval.getByRole('button', { name: 'Validate' }).click();
    // The page is loaded again after an action that stays on it (rule 2 of "Navigation"): the loading skeleton has no
    // row either, so what is waited for is the real page, drawn again without the proposal.
    await expect(validator.getByRole('heading', { name: 'To validate', level: 1 })).toBeVisible();
    await expect(row).toHaveCount(0);

    await validator.goto(path);
    await expect(validator.getByText('Confirmed').first()).toBeVisible();
    await expect(validator.getByText('Upcoming occurrences')).toBeVisible();
    // The three dates of the series, each a link to its own page.
    await expect(validator.getByRole('link', { name: /07:00 PM – 09:30 PM/ })).toHaveCount(3);

    // A member now reads it, with its place and its description (two lines, as typed).
    await member.goto(path);
    await expect(member.getByRole('heading', { name: title, level: 1 })).toBeVisible();
    await expect(member.getByText('Gymnase')).toBeVisible();
    await expect(member.getByText('Second line.')).toBeVisible();
    await expect(member.getByText('Every week on')).toBeVisible();

    // The proposer, whose event is now published, is shown an explanation instead of an Edit button.
    await proposer.goto(path);
    await expect(proposer.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await proposer.goto(`${path}/edit`);
    await expect(proposer).not.toHaveURL(/\/edit/);
  });

  test('a validator refuses a proposal with a comment, which its author reads', async ({
    as,
  }, testInfo) => {
    const title = nameOf(testInfo.project.name, 'refused');
    const comment = 'Too close to the exams — pick a date in January.';
    const proposer = await as('proposer');
    const path = await propose(proposer, { title, day: aDayAhead(45) });

    const validator = await as('validator');
    await validator.goto('/en/events/review');
    const row = validator
      .getByRole('listitem')
      .filter({ has: validator.getByRole('link', { name: title }) });
    await row.getByRole('button', { name: 'Refuse' }).click();

    const dialog = validator.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // The comment is required: the button that refuses stays disabled until one is typed (spaces are no comment).
    const confirm = dialog.getByRole('button', { name: 'Refuse the proposal' });
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('textbox', { name: 'Comment for the author' }).fill('   ');
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('textbox', { name: 'Comment for the author' }).fill(comment);
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(dialog).toBeHidden();
    await expect(validator.getByRole('heading', { name: 'To validate', level: 1 })).toBeVisible();
    await expect(row).toHaveCount(0);

    await proposer.goto(path);
    await expect(proposer.getByText(comment)).toBeVisible();
  });

  test('the confirmation dialog keeps the focus on Cancel, traps it, and gives it back on Escape', async ({
    as,
  }, testInfo) => {
    const title = nameOf(testInfo.project.name, 'delete');
    const validator = await as('validator');
    const path = await propose(validator, { title, day: aDayAhead(50) });

    const trigger = validator.getByRole('button', { name: 'Delete event' });
    await trigger.click();
    const dialog = validator.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();

    // Tab and Shift+Tab stay inside the dialog.
    // (Asked again until it holds: the focus passes through guards at the edges of the dialog before it is put back.)
    const focusInside = () =>
      dialog.evaluate((element) => element.contains(document.activeElement));
    for (let step = 0; step < 4; step += 1) {
      await validator.keyboard.press('Tab');
      await expect.poll(focusInside).toBe(true);
    }
    await validator.keyboard.press('Shift+Tab');
    await expect.poll(focusInside).toBe(true);

    await validator.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    // Confirming does it: the event is gone, and its address is a 404.
    await trigger.click();
    await validator
      .getByRole('dialog')
      .getByRole('button', { name: 'Yes, delete permanently' })
      .click();
    await expect(validator).toHaveURL(/\/en\/events(\?|$)/);
    await validator.goto(path);
    await expect(validator.getByText('Page not found')).toBeVisible();
  });
});
