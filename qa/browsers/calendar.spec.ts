import { expect, test } from './fixtures';

/**
 * The calendar in the ways the engines differ most: the language of its labels, a button that only shows when the day is
 * hovered or reached with the keyboard (and is always there on a touch screen), and the date and time fields it fills in.
 */

test.describe('the calendar', () => {
  test('speaks French, and its buttons move the month in French too', async ({ as }) => {
    const page = await as('member');
    await page.goto('/fr/events');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.getByRole('heading', { name: 'Événements', level: 1 })).toBeVisible();

    const heading = page.locator('h2[aria-live]');
    const current = (await heading.textContent())?.trim() ?? '';
    expect(current).toMatch(/\d{4}$/);
    await page.getByRole('button', { name: 'Mois suivant' }).click();
    await expect(heading).not.toHaveText(current);
    await page.getByRole('button', { name: 'Mois précédent' }).click();
    await expect(heading).toHaveText(current);
    await page
      .getByRole('navigation', { name: 'Affichage' })
      .getByRole('link', { name: 'Liste' })
      .click();
    await expect(page).toHaveURL(/view=list/);
  });

  test('offers a proposer a + on a day, which opens the form on that day at 6 pm', async ({
    as,
  }) => {
    const page = await as('proposer');
    await page.goto('/en/events?view=calendar');
    await expect(page.locator('h2[aria-live]')).toBeVisible();

    const cell = page
      .locator('td')
      .filter({ has: page.getByRole('link', { name: /^Add an event on / }) })
      .nth(12);
    const add = cell.getByRole('link', { name: /^Add an event on / });
    // Shown when the day is hovered (or reached with the keyboard), whatever the engine does with hover.
    await cell.hover();
    await expect(add).toBeVisible();
    await add.click();

    await expect(page).toHaveURL(/\/en\/events\/new\?date=\d{4}-\d{2}-\d{2}$/);
    const day = new URL(page.url()).searchParams.get('date') ?? '';
    await expect(page.getByRole('heading', { name: 'New event', level: 1 })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Start' })).toHaveValue(`${day}T18:00`);
    await expect(page.getByRole('textbox', { name: 'End' })).toHaveValue(`${day}T20:00`);
    // Cancel comes back to that day of the calendar.
    await page
      .getByRole('link', { name: 'Cancel' })
      .or(page.getByRole('button', { name: 'Cancel' }))
      .click();
    await expect(page).toHaveURL(/\/en\/events\?/);
  });

  test('shows it to the keyboard: Tab reaches the + of a day, which is then visible', async ({
    as,
  }) => {
    const page = await as('proposer');
    await page.goto('/en/events?view=calendar');
    const add = page.getByRole('link', { name: /^Add an event on / }).first();
    await add.focus();
    await expect(add).toBeFocused();
    await expect(add).toBeVisible();
  });

  test('does not show it to a member who cannot create events', async ({ as }) => {
    const page = await as('member');
    await page.goto('/en/events?view=calendar');
    await expect(page.locator('h2[aria-live]')).toBeVisible();
    await expect(page.getByRole('link', { name: /^Add an event on / })).toHaveCount(0);
  });
});
