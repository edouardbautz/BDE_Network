import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { atRest } from './rest';

/**
 * The publication of the events on the intra, end to end and in every engine, as the people it was made for: somebody who
 * validates writes and confirms an event with the intra's fields, the staff of the school (who holds nothing else) finds the
 * request, sees the fields in the order of the intra's form and refuses it with a comment, the author reads the comment and sends the
 * request again, the staff publishes it, the author changes the event, the staff is shown what the intra holds against what the
 * event became and confirms the update. A phone shows the same pages without scrolling sideways. Every journey makes its own event,
 * named after its engine, and leaves the platform as it found it (the setting off, the event deleted).
 */

const aDayAhead = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const EVENT_PAGE = /\/en\/events\/(?!new)[^/?]+$/;

const eventsForm = (page: Page) => page.locator('form', { has: page.getByLabel('Reminder hour') });

async function setPublication(page: Page, on: boolean) {
  await page.goto('/en/settings');
  const toggle = page.getByRole('switch', { name: 'Publish events on the 42 intra' });
  await expect(toggle).toBeVisible();
  await atRest(page);
  if ((await toggle.getAttribute('aria-checked')) === String(on)) return;
  await toggle.click();
  await eventsForm(page).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await atRest(page);
}

async function choose(page: Page, label: string) {
  await page
    .locator('label')
    .filter({ hasText: new RegExp(`^${label}$`) })
    .click();
  await expect(page.getByRole('radio', { name: label, exact: true })).toBeChecked();
}

/** Writes and confirms an event with every field of the intra, as a validator, and returns the address of its page. */
async function confirmedEvent(page: Page, title: string, day: string): Promise<string> {
  await page.goto(`/en/events/new?date=${day}`);
  await expect(page.getByRole('heading', { name: 'New event', level: 1 })).toBeVisible();
  await page.getByRole('textbox', { name: 'Title' }).fill(title);
  await page.getByRole('combobox', { name: 'Category' }).selectOption({ label: 'Sport' });
  await page.getByRole('textbox', { name: 'Start' }).fill(`${day}T19:00`);
  await page.getByRole('textbox', { name: 'End' }).fill(`${day}T21:30`);
  await page.getByRole('textbox', { name: 'Location' }).fill('Gymnase');
  await page.getByRole('textbox', { name: 'Description' }).fill('Une **soirée** de jeux.');
  await choose(page, 'Students');
  await page.getByRole('spinbutton', { name: /^Maximum number of people/ }).fill('40');
  await choose(page, 'Yes');
  await page.getByRole('combobox', { name: /^Kind/ }).selectOption('Meet/meet_up');
  await page.getByRole('spinbutton', { name: /^Delay before unsubscribing/ }).fill('12');
  const keywords = page.getByRole('textbox', { name: /^Keywords/ });
  await keywords.fill('jeux');
  await keywords.press('Enter');
  await page.getByRole('combobox', { name: 'Status' }).selectOption('CONFIRMED');
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(page).toHaveURL(EVENT_PAGE);
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  return new URL(page.url()).pathname;
}

const publicationCard = (page: Page) =>
  page
    .locator('section, div')
    .filter({ has: page.getByRole('heading', { name: 'Publication on the intra' }) })
    .last();

test.describe('the publication on the intra', () => {
  test('the staff copies, refuses, publishes and follows a change; the author reads each answer', async ({
    as,
  }, testInfo) => {
    test.slow();
    const title = `PW ${testInfo.project.name} intra circuit ${Date.now()}`;
    const renamed = `${title} (new name)`;
    const owner = await as('owner');
    const author = await as('validator');
    const staff = await as('staff');
    let path = '';
    try {
      await setPublication(owner, true);

      // Confirming an event with its fields sends the request: the author sees it waiting.
      path = await confirmedEvent(author, title, aDayAhead(50));
      await expect(author.getByText('Request sent to the staff by qa-validator')).toBeVisible();

      // The staff finds it, and nothing else of the platform.
      await staff.goto('/en/events/intra');
      await expect(
        staff.getByRole('heading', { name: 'To publish on the intra', level: 1 }),
      ).toBeVisible();
      await staff.getByRole('link', { name: new RegExp(title) }).click();
      await expect(staff.getByRole('heading', { name: title, level: 1 })).toBeVisible();
      await atRest(staff);

      // The fields are in the order of the intra's form, each with its own button.
      const labels = await staff
        .getByRole('button', { name: /^Copy / })
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')));
      expect(labels.slice(0, 8)).toEqual([
        "Copy Organizer's login",
        'Copy Name',
        'Copy Available for',
        'Copy Start date',
        'Copy Start time',
        'Copy End date',
        'Copy End time',
        'Copy Description',
      ]);
      await expect(staff.getByText('Une **soirée** de jeux.')).toBeVisible();

      // Refusing needs a reason; the author reads it on the event and can send the request again.
      await staff.getByRole('button', { name: 'Refuse', exact: true }).click();
      const refusal = staff.getByRole('dialog');
      await expect(refusal.getByRole('button', { name: 'Cancel' })).toBeFocused();
      // no reason, no refusal: the button waits for one
      await expect(refusal.getByRole('button', { name: 'Refuse the request' })).toBeDisabled();
      await refusal.getByRole('textbox', { name: 'Why?' }).fill('The place is not on the intra.');
      await expect(refusal.getByRole('button', { name: 'Refuse the request' })).toBeEnabled();
      await refusal.getByRole('button', { name: 'Refuse the request' }).click();
      // an answer leaves for the list, where the request is now among those already handled, with its reason
      await expect(staff).toHaveURL(/\/en\/events\/intra$/);
      await expect(staff.getByText('The place is not on the intra.').first()).toBeVisible();

      await author.goto(path);
      await expect(author.getByText('Refused by qa-staff.')).toBeVisible();
      await expect(author.getByText('The place is not on the intra.')).toBeVisible();
      await atRest(author);
      await author.getByRole('button', { name: 'Send the request again' }).click();
      await expect(author.getByText('Request sent to the staff by qa-validator')).toBeVisible();

      // Publishing, with the address of the event on the intra.
      await staff.goto('/en/events/intra');
      await staff.getByRole('link', { name: new RegExp(title) }).click();
      await atRest(staff);
      await staff.getByRole('button', { name: 'Published on the intra', exact: true }).click();
      const publishing = staff.getByRole('dialog');
      await publishing
        .getByRole('textbox', { name: /^Address on the intra/ })
        .fill('https://profile.intra.42.fr/events/4242');
      await publishing.getByRole('button', { name: 'Yes, published' }).click();
      await expect(staff).toHaveURL(/\/en\/events\/intra$/);
      await staff.getByRole('link', { name: new RegExp(title) }).click();
      await expect(staff.getByText(/Published on the intra by qa-staff/)).toBeVisible();
      await expect(staff.getByRole('link', { name: 'See it on the intra' })).toHaveAttribute(
        'href',
        'https://profile.intra.42.fr/events/4242',
      );

      await author.goto(path);
      await expect(author.getByText(/Published on the intra by qa-staff/)).toBeVisible();
      await expect(author.getByRole('link', { name: 'See it on the intra' })).toHaveAttribute(
        'rel',
        /noopener/,
      );

      // The event changes: the request goes back to "To update" and the staff reads what the intra holds against what it became.
      await author.getByRole('button', { name: 'Edit', exact: true }).click();
      await author.getByRole('textbox', { name: 'Title' }).fill(renamed);
      await author.getByRole('button', { name: 'Save' }).click();
      await expect(author).toHaveURL(EVENT_PAGE);
      await expect(
        author.getByText(/the event changed since: the staff has to update/),
      ).toBeVisible();

      await staff.goto('/en/events/intra');
      await expect(staff.getByText('To update').first()).toBeVisible();
      await staff.getByRole('link', { name: new RegExp(renamed.replace(/[()]/g, '\\$&')) }).click();
      await atRest(staff);
      await expect(
        staff.getByText('What changed since it was published', { exact: true }),
      ).toBeVisible();
      await expect(staff.getByText('On the intra').first()).toBeVisible();
      await staff.getByRole('button', { name: 'Intra updated', exact: true }).click();
      await staff
        .getByRole('dialog')
        .getByRole('button', { name: 'Yes, the intra is up to date' })
        .click();
      await expect(staff).toHaveURL(/\/en\/events\/intra$/);
      await staff.getByRole('link', { name: new RegExp(renamed.replace(/[()]/g, '\\$&')) }).click();
      await expect(staff.getByText(/Published on the intra by qa-staff/)).toBeVisible();
      await expect(staff.getByText('What changed since it was published')).toHaveCount(0);
    } finally {
      if (path) {
        await author.goto(path);
        await atRest(author);
        await author.getByRole('button', { name: 'Delete event' }).click();
        await author
          .getByRole('dialog')
          .getByRole('button', { name: 'Yes, delete permanently' })
          .click();
        await expect(author).toHaveURL(/\/en\/events(\?|$)/);
      }
      await setPublication(owner, false);
    }
  });

  test('the staff is not shown the rest of the platform, and a member is not shown the requests', async ({
    as,
  }) => {
    const owner = await as('owner');
    try {
      await setPublication(owner, true);
      const staff = await as('staff');
      await staff.goto('/en/events/intra');
      await expect(
        staff.getByRole('heading', { name: 'To publish on the intra', level: 1 }),
      ).toBeVisible();
      await staff.goto('/en/members', { waitUntil: 'commit' });
      await atRest(staff);
      await expect(staff.getByRole('heading', { name: 'Members', level: 1 })).toHaveCount(0);
      await staff.goto('/en/audit-log', { waitUntil: 'commit' });
      await atRest(staff);
      await expect(staff.getByRole('heading', { name: 'Audit log', level: 1 })).toHaveCount(0);

      const member = await as('member');
      await member.goto('/en/events/intra', { waitUntil: 'commit' });
      await atRest(member);
      await expect(
        member.getByRole('heading', { name: 'To publish on the intra', level: 1 }),
      ).toHaveCount(0);
    } finally {
      await setPublication(owner, false);
    }
  });

  test('the list and a request fit a phone without scrolling sideways', async ({ as }) => {
    const owner = await as('owner');
    try {
      await setPublication(owner, true);
      const staff = await as('staff', { viewport: { width: 390, height: 800 } });
      const scrolls = () =>
        staff.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        );
      await staff.goto('/en/events/intra');
      await atRest(staff);
      expect(await scrolls()).toBe(false);
      // a request of the dataset that is waiting: its fields and their buttons fit as well
      await staff.locator('main a[href*="/events/intra/"]').first().click();
      await expect(staff.getByRole('button', { name: /^Copy / }).first()).toBeVisible();
      await atRest(staff);
      expect(await scrolls()).toBe(false);
    } finally {
      await setPublication(owner, false);
    }
  });
});
