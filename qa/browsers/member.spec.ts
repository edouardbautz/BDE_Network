import { expect, test } from './fixtures';
import { atRest } from './rest';

/**
 * An ordinary member, in every engine: the dashboard, the calendar and the list of events (the buttons that change only the
 * query of the page you are on, which the production router once answered with nothing: see "Navigation" in
 * docs/architecture.md), an event and its calendar file, the theme, the phone-sized menu, and what a member is never shown.
 */

const monthName = (month: Date) =>
  new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(month);

test.describe('a member', () => {
  test('finds the next events on the dashboard, opens one, and downloads it for a calendar', async ({
    as,
  }) => {
    const page = await as('member');
    await page.goto('/en/dashboard');
    await expect(page.getByRole('heading', { name: 'Hello QA', level: 1 })).toBeVisible();

    // The next event is the one filled with the accent: its title is a heading, and one button opens it.
    const next = page.getByRole('article');
    const title = (await next.getByRole('heading', { level: 2 }).textContent())?.trim() ?? '';
    expect(title).not.toBe('');
    await next.getByRole('link', { name: 'View the event' }).click();
    await expect(page).toHaveURL(/\/en\/events\/[^/?]+/);
    await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByText('Add to my calendar', { exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.ics$/);
    const { createReadStream } = await import('node:fs');
    const chunks: Buffer[] = [];
    for await (const chunk of createReadStream((await download.path()) as string))
      chunks.push(chunk as Buffer);
    const file = Buffer.concat(chunks).toString('utf8');
    expect(file).toMatch(/^BEGIN:VCALENDAR/);
    expect(file).toContain(`SUMMARY:${title}`);
  });

  test('moves through the months of the calendar and between the calendar and the list', async ({
    as,
  }) => {
    const page = await as('member');
    await page.goto('/en/events');
    const heading = page.locator('h2[aria-live]');
    await expect(heading).toBeVisible();
    const current = (await heading.textContent())?.trim() ?? '';

    const [monthText, year] = [current.split(' ')[0], Number(current.split(' ')[1])];
    const first = new Date(Date.UTC(year, new Date(`${monthText} 1, ${year}`).getMonth(), 1));
    const next = monthName(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1)));
    const previous = monthName(
      new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() - 1, 1)),
    );

    await page.getByRole('button', { name: 'Next month' }).click();
    await expect(heading).toHaveText(next);
    await expect(page).toHaveURL(/month=\d{4}-\d{2}/);
    await page.getByRole('button', { name: 'Previous month' }).click();
    await expect(heading).toHaveText(current);
    await page.getByRole('button', { name: 'Previous month' }).click();
    await expect(heading).toHaveText(previous);
    await page.getByRole('button', { name: 'Today' }).click();
    await expect(heading).toHaveText(current);

    await page
      .getByRole('navigation', { name: 'View' })
      .getByRole('link', { name: 'List' })
      .click();
    await expect(page).toHaveURL(/view=list/);
    await expect(heading).toHaveCount(0);
    await page
      .getByRole('navigation', { name: 'View' })
      .getByRole('link', { name: 'Calendar' })
      .click();
    await expect(page).toHaveURL(/view=calendar/);
    await expect(heading).toHaveText(current);
  });

  test('filters the list by category, and the filter shows in the address', async ({ as }) => {
    const page = await as('member');
    await page.goto('/en/events?view=list');
    const category = page.getByRole('combobox', { name: 'Category' });
    await category.selectOption({ label: 'Sport' });
    await page.getByRole('button', { name: 'Filter' }).click();
    await expect(page).toHaveURL(/category=/);
    await expect(page.getByRole('combobox', { name: 'Category' })).toHaveValue(/.+/);
    for (const label of await page
      .getByRole('main')
      .getByRole('list')
      .getByRole('link')
      .allTextContents()) {
      expect(label.trim()).not.toBe('');
    }
  });

  test('changes the theme from the menu of the account, and keeps it from one page to the next and after a reload', async ({
    as,
  }) => {
    const page = await as('member');
    await page.goto('/en/dashboard');
    await page.getByRole('button', { name: /QA member/ }).click();
    await page.getByRole('menuitemradio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    await page
      .getByRole('navigation', { name: 'Navigation' })
      .getByRole('link', { name: 'Events' })
      .click();
    await expect(page).toHaveURL(/\/en\/events/);
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);

    await page.getByRole('button', { name: /QA member/ }).click();
    await page.getByRole('menuitemradio', { name: 'Light' }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });

  test('opens the menu of their name, reaches their profile, and signs out', async ({ as }) => {
    const page = await as('member');
    await page.goto('/en/dashboard');

    await page.getByRole('button', { name: /QA member/ }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu).toContainText('qa-member');
    await menu.getByRole('menuitem', { name: 'My profile' }).click();
    await expect(page).toHaveURL(/\/en\/profile$/);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();

    await page.getByRole('button', { name: /QA member/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(
      page.getByRole('button', { name: /Sign in with 42|Se connecter avec 42/ }),
    ).toBeVisible();
    // The login page finishes loading before the next address is asked for: leaving it with a script still on its way is the
    // test's own doing (Firefox words the cancelled script as a ChunkLoadError), not something to let the watcher through.
    await atRest(page);
    // The session is gone: the application sends the visitor back to the login page.
    await page.goto('/en/dashboard');
    await expect(page).toHaveURL(/\/(en|fr)$/);
  });

  test('is shown no way to create an event, nor any page of the board', async ({ as }) => {
    const page = await as('member');
    await page.goto('/en/events');
    await expect(page.getByRole('heading', { name: 'Events', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New event' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'To validate' })).toHaveCount(0);

    await page.goto('/en/events/new');
    await expect(page).not.toHaveURL(/\/new/);
    for (const path of [
      '/en/members',
      '/en/roles',
      '/en/settings',
      '/en/audit-log',
      '/en/events/review',
    ]) {
      await page.goto(path);
      // Refused by a redirect or by the not-found page, depending on the page: either way nothing of the board is shown.
      await expect
        .poll(
          async () =>
            !page.url().endsWith(path) || (await page.getByText('Page not found').isVisible()),
          { message: path },
        )
        .toBe(true);
      await expect(
        page.getByRole('heading', {
          name: /Members|Roles|Settings|Audit log|To validate/,
          level: 1,
        }),
        path,
      ).toHaveCount(0);
    }
  });

  test('reads the whole application on a phone, through the tab bar', async ({ as }) => {
    const page = await as('member', { viewport: { width: 390, height: 800 } });
    await page.goto('/en/dashboard');
    const tabs = page.getByRole('navigation', { name: 'Navigation' });
    await expect(tabs.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    await tabs.getByRole('link', { name: 'Events' }).click();
    await expect(page).toHaveURL(/\/en\/events/);
    // the rest of the platform, and the account, are one tap away: behind "More"
    await tabs.getByRole('button', { name: 'More' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('link', { name: 'My profile' })).toBeVisible();
    await expect(sheet.getByRole('radio', { name: 'Dark' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    // With no choice made, a phone starts on the list; the calendar is one tap away and shows the day under the grid.
    await expect(page.getByRole('main').getByRole('link', { name: /.+/ }).first()).toBeVisible();
    await page
      .getByRole('navigation', { name: 'View' })
      .getByRole('link', { name: 'Calendar' })
      .click();
    await expect(page).toHaveURL(/view=calendar/);
    await expect(page.locator('h2[aria-live]')).toBeVisible();
    await expect(page.locator('#selected-day-heading')).toBeVisible();

    const horizontal = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(horizontal, 'the page scrolls sideways on a phone').toBe(false);
  });
});
