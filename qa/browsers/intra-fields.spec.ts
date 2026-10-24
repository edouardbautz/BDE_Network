import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { atRest } from './rest';

/**
 * The fields of the intra's form, in every engine, as an owner: the setting that turns the publication on, the form that then asks
 * for all of them (refused when empty, a Markdown description with its preview, keywords as chips), the page of the event that
 * shows them, and an event written before them, which cannot be confirmed until it is edited. The journeys leave the platform as
 * they found it: the setting off, their events deleted.
 */

const aDayAhead = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** The form of the events section of the settings page (the one with the hour of the reminder). */
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

async function fillBasics(page: Page, title: string, day: string) {
  await page.getByRole('textbox', { name: 'Title' }).fill(title);
  await page.getByRole('combobox', { name: 'Category' }).selectOption({ label: 'Sport' });
  await page.getByRole('textbox', { name: 'Start' }).fill(`${day}T19:00`);
  await page.getByRole('textbox', { name: 'End' }).fill(`${day}T21:30`);
  await page.getByRole('textbox', { name: 'Location' }).fill('Gymnase');
}

async function deleteEvent(page: Page, path: string) {
  await page.goto(path);
  await page.getByRole('button', { name: 'Delete event' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Yes, delete permanently' }).click();
  await expect(page).toHaveURL(/\/en\/events(\?|$)/);
}

test.describe('the intra fields', () => {
  test('are asked once the setting is on, refused when missing, and shown on the event', async ({
    as,
  }, testInfo) => {
    const title = `PW ${testInfo.project.name} intra ${Date.now()}`;
    const page = await as('owner');
    let path = '';
    try {
      await setPublication(page, true);

      await page.goto(`/en/events/new?date=${aDayAhead(60)}`);
      await expect(page.getByRole('heading', { name: 'New event', level: 1 })).toBeVisible();
      await expect(
        page.getByRole('heading', { name: 'Publication on the 42 intra' }),
      ).toBeVisible();
      // the author is the organizer to begin with
      await expect(page.getByRole('textbox', { name: /^Organizer's login/ })).toHaveValue(
        'qa-owner',
      );

      // Nothing is sent while the intra fields are missing: each says what is wrong.
      await fillBasics(page, title, aDayAhead(60));
      await page.getByRole('textbox', { name: 'Description' }).fill('## Titre\n\nUn **mot** gras');
      const preview = page.getByRole('region', { name: 'Preview' });
      await expect(preview.getByRole('heading', { name: 'Titre' })).toBeVisible();
      await expect(preview.locator('strong')).toHaveText('mot');
      await page.getByRole('button', { name: 'Create event' }).click();
      await expect(page.getByText('This field is required.').first()).toBeVisible();
      await expect(page).toHaveURL(/\/events\/new/);

      await page.getByRole('radio', { name: 'Students' }).check({ force: true });
      await page.getByRole('spinbutton', { name: /^Maximum number of people/ }).fill('40');
      await page.getByRole('radio', { name: 'No', exact: true }).check({ force: true });
      await page.getByRole('combobox', { name: /^Kind/ }).selectOption('Meet/meet_up');
      await page.getByRole('spinbutton', { name: /^Delay before unsubscribing/ }).fill('12');
      const keywords = page.getByRole('textbox', { name: /^Keywords/ });
      await keywords.fill('jeux');
      await keywords.press('Enter');
      await keywords.fill('soirée, bde');
      await keywords.press('Enter');
      await expect(page.getByRole('button', { name: 'Remove the keyword jeux' })).toBeVisible();

      await page.getByRole('button', { name: 'Create event' }).click();
      await expect(page).toHaveURL(/\/en\/events\/[^/?]+/);
      path = new URL(page.url()).pathname;
      await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();

      // The event shows the Markdown as drawn text, and what the staff will copy.
      await expect(page.getByRole('heading', { name: 'Titre', level: 3 })).toBeVisible();
      const card = page.locator('section, div', {
        has: page.getByText('42 intra', { exact: true }),
      });
      await expect(card.getByText('qa-owner').first()).toBeVisible();
      await expect(card.getByText('Meet/meet_up').first()).toBeVisible();
      await expect(card.getByText('12 hours before the start').first()).toBeVisible();
      await expect(card.getByText('jeux, soirée, bde').first()).toBeVisible();
    } finally {
      if (path) await deleteEvent(page, path);
      await setPublication(page, false);
    }
  });

  test('keep an event written before them from being confirmed, until it is edited with them', async ({
    as,
  }, testInfo) => {
    const title = `PW ${testInfo.project.name} legacy ${Date.now()}`;
    const page = await as('owner');
    let path = '';
    try {
      // written while the platform did not publish on the intra: no intra field
      await setPublication(page, false);
      await page.goto(`/en/events/new?date=${aDayAhead(61)}`);
      await expect(page.getByRole('heading', { name: 'New event', level: 1 })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Publication on the 42 intra' })).toHaveCount(
        0,
      );
      await fillBasics(page, title, aDayAhead(61));
      await page.getByRole('textbox', { name: 'Description' }).fill('Written before.');
      await page.getByRole('button', { name: 'Create event' }).click();
      await expect(page).toHaveURL(/\/en\/events\/[^/?]+/);
      path = new URL(page.url()).pathname;

      await setPublication(page, true);
      await page.goto(path);
      await expect(page.getByText('The intra fields are not filled in.')).toBeVisible();

      // Confirming says no, and says why.
      await page.getByRole('button', { name: 'Confirm', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Confirm the event' }).click();
      await expect(page.getByText('This event cannot be confirmed')).toBeVisible();
      await expect(page.getByText('Draft').first()).toBeVisible();

      // Editing asks for the fields (and says why), and then it can be confirmed.
      await page.getByRole('link', { name: 'Edit' }).click();
      await expect(page.getByText('This event predates publication on the intra.')).toBeVisible();
      await page.getByRole('radio', { name: 'Both' }).check({ force: true });
      await page.getByRole('spinbutton', { name: /^Maximum number of people/ }).fill('25');
      await page.getByRole('radio', { name: 'Yes', exact: true }).check({ force: true });
      await page.getByRole('combobox', { name: /^Kind/ }).selectOption('Association');
      await page.getByRole('spinbutton', { name: /^Delay before unsubscribing/ }).fill('0');
      const keywords = page.getByRole('textbox', { name: /^Keywords/ });
      await keywords.fill('bde');
      await keywords.press('Enter');
      await page.getByRole('combobox', { name: 'Status' }).selectOption('CONFIRMED');
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page).toHaveURL(/\/en\/events\/[^/?]+$/);
      await expect(page.getByText('Confirmed').first()).toBeVisible();
      await expect(page.getByText('Association').first()).toBeVisible();
    } finally {
      if (path) await deleteEvent(page, path);
      await setPublication(page, false);
    }
  });
});
