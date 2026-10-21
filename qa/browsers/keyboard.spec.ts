import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * What axe cannot judge, played with the keyboard alone, in the three engines (they differ most here: what Tab reaches, where
 * the focus goes after a link to an anchor, what a menu does with the arrow keys): the link that skips the menu, the focus
 * that is always visible, menus and the phone's drawer that open, close and give the focus back, and a form that says what is
 * wrong and puts the focus on it.
 */

/** Is the element that has the focus drawn with something that shows it (an outline, or the ring made with a shadow)? */
async function focusIsVisible(page: Page): Promise<{ ok: boolean; what: string }> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return { ok: true, what: 'body' };
    // The focus inside a date and time field (a part of the date, the button of its calendar) is drawn by the engine itself:
    // the field is the active element, but it is not the one that matches `:focus-visible`.
    if (
      element instanceof HTMLInputElement &&
      /^(date|datetime-local|time|month|week)$/.test(element.type)
    ) {
      return { ok: true, what: `${element.type} field` };
    }
    const style = getComputedStyle(element);
    const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
    const ring = style.boxShadow !== 'none' && style.boxShadow !== '';
    const label =
      element.getAttribute('aria-label') ??
      element.textContent?.trim().slice(0, 30) ??
      element.tagName;
    return { ok: outline || ring, what: `${element.tagName.toLowerCase()} "${label}"` };
  });
}

const focused = (locator: Locator) => expect(locator).toBeFocused();

test.describe('with the keyboard alone', () => {
  test('a link offers to skip the menu, which shows when it has the focus, and leads to the content', async ({
    as,
    browserName,
  }) => {
    const page = await as('member');
    await page.goto('/en/dashboard');
    const skip = page.getByRole('link', { name: 'Skip to the content' });
    if (browserName === 'webkit') {
      // Safari's default is not to stop on links with Tab (Option+Tab does): the link is put under the focus by hand.
      await skip.focus();
    } else {
      await page.keyboard.press('Tab');
    }
    await focused(skip);
    await expect(skip).toBeVisible();
    expect((await focusIsVisible(page)).ok, 'the skip link shows no focus').toBe(true);

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main-content$/);
    // The browser starts the next Tab from the target: the next control reached is in the content, not in the menu.
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
    await expect
      .poll(() => page.evaluate(() => !!document.activeElement?.closest('main')))
      .toBe(true);
  });

  test('the menu of the signed-in person opens with Enter, offers the profile and the sign-out, and closes with Escape', async ({
    as,
  }) => {
    const page = await as('member');
    await page.goto('/en/dashboard');
    const trigger = page.getByRole('button', { name: /QA member/ });
    await trigger.focus();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'My profile' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await focused(trigger);
  });

  // Every control Tab reaches, page after page: the forms are where the native controls (select, checkbox, radio, colour,
  // file) are, and where an engine can draw nothing for the focus of a control the style sheet has taken the outline from.
  for (const [who, path, label] of [
    ['validator', '/en/events', 'the events'],
    ['validator', '/en/events/new', 'the form of an event'],
    ['owner', '/en/roles/new', 'the form of a role'],
    ['owner', '/en/members', 'the members'],
    ['owner', '/en/settings', 'the settings'],
    ['member', '/en/profile', 'the profile'],
  ] as const) {
    test(`every control the Tab key reaches shows where the focus is: ${label}`, async ({ as }) => {
      const page = await as(who);
      await page.goto(path);
      await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();

      const hidden = new Set<string>();
      for (let step = 0; step < 90; step += 1) {
        await page.keyboard.press('Tab');
        const { ok, what } = await focusIsVisible(page);
        if (!ok) hidden.add(what);
      }
      expect([...hidden], 'focused, and nothing shows it').toEqual([]);
    });
  }

  test('the language and theme menus open with Enter, move with the arrows, choose, and close with Escape', async ({
    as,
  }) => {
    const page = await as('member');
    await page.goto('/en/dashboard');

    const theme = page.getByRole('button', { name: 'Light / Dark' });
    await theme.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Dark' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem', { name: 'Dark' })).toBeHidden();
    await focused(theme);

    await theme.press('Enter');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Dark' })).toBeHidden();

    const language = page.getByRole('button', { name: 'Language' });
    await language.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Français' })).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/(fr|en)\/dashboard/);
  });

  test("the phone's drawer opens, keeps the focus inside, closes with Escape, and gives the focus back", async ({
    as,
  }) => {
    const page = await as('member', { viewport: { width: 390, height: 800 } });
    await page.goto('/en/dashboard');
    const open = page.getByRole('button', { name: 'Open navigation menu' });
    await open.focus();
    await page.keyboard.press('Enter');
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect
      .poll(() => drawer.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);
    for (let step = 0; step < 6; step += 1) {
      await page.keyboard.press('Tab');
      await expect
        .poll(() => drawer.evaluate((element) => element.contains(document.activeElement)))
        .toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await focused(open);
  });

  test('a form that is sent with a field missing says so, puts the focus on the first one, and links the message to it', async ({
    as,
  }) => {
    const page = await as('proposer');
    await page.goto('/en/events/new');
    const title = page.getByRole('textbox', { name: 'Title' });
    await title.focus();
    // Enter in a text field sends the form, as it does for a person who never leaves the keyboard.
    await page.keyboard.press('Enter');

    await expect(title).toHaveAttribute('aria-invalid', 'true');
    await focused(title);
    const described = await title.getAttribute('aria-describedby');
    expect(described, 'the field names the message that explains it').toBeTruthy();
    const message = page.locator(`#${described?.split(' ')[0]}`);
    await expect(message).toContainText('This field is required.');
  });
});
