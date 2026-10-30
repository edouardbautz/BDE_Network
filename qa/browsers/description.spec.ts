import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { atRest } from './rest';

/**
 * The description of an event, in every engine: a bar of buttons puts the Markdown in for somebody who does not know it, the
 * keyboard does the same (Ctrl or Cmd + B and I), a button's work is taken back by undo (the text is typed into the field, not set), the
 * bar is one stop of the keyboard, and on a phone the targets are 44 px and there is a tab for the preview. The help says nothing of
 * a school or of a format.
 */

const field = (page: Page) => page.getByRole('textbox', { name: /^Description/ });
const bar = (page: Page) => page.getByRole('toolbar', { name: 'Formatting' });
const SELECT_ALL = process.platform === 'darwin' ? 'Meta+a' : 'Control+a';
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const BOLD = process.platform === 'darwin' ? 'Meta+b' : 'Control+b';

async function open(page: Page) {
  await page.goto('/en/events/new');
  await atRest(page);
  await expect(field(page)).toBeVisible();
}

/** Types a text and selects `word` in it. */
async function typeAndSelect(page: Page, text: string, word: string) {
  const area = field(page);
  await area.fill(text);
  await area.evaluate(
    (element: HTMLTextAreaElement, [value, target]) => {
      element.focus();
      const at = value.indexOf(target);
      element.setSelectionRange(at, at + target.length);
    },
    [text, word] as const,
  );
}

test.describe('the description of an event', () => {
  test('has a bar of formatting buttons, named, and a help that names no school and no format', async ({
    as,
  }) => {
    const page = await as('owner');
    await open(page);
    await expect(bar(page)).toBeVisible();
    for (const name of ['Bold', 'Italic', 'Heading', 'Bulleted list', 'Numbered list', 'Link']) {
      await expect(bar(page).getByRole('button', { name })).toBeVisible();
    }
    const help = page.getByText('Formatting is possible: bold, italic, lists, links.');
    await expect(help).toBeVisible();
    await expect(field(page)).toHaveAccessibleDescription(/Formatting is possible/);
    const body = (await help.textContent()) ?? '';
    expect(body).not.toMatch(/intra|markdown|nice|form\b/i);
  });

  test('puts the marks around the selection, and undo takes a button back', async ({ as }) => {
    const page = await as('owner');
    await open(page);
    await typeAndSelect(page, 'Join the great evening', 'great');
    await bar(page).getByRole('button', { name: 'Bold' }).click();
    await expect(field(page)).toHaveValue('Join the **great** evening');
    // the field has the focus again, with the word still selected: the next click takes the marks off
    await expect(field(page)).toBeFocused();
    await bar(page).getByRole('button', { name: 'Bold' }).click();
    await expect(field(page)).toHaveValue('Join the great evening');
    await bar(page).getByRole('button', { name: 'Italic' }).click();
    await expect(field(page)).toHaveValue('Join the *great* evening');
    // undo is the browser's own: it works because the text was typed into the field
    await page.keyboard.press(UNDO);
    await expect(field(page)).toHaveValue('Join the great evening');
    // what is shown beside the field is what the page will show
    await page.keyboard.press(UNDO);
    await expect(field(page)).toHaveValue('Join the **great** evening');
    await expect(page.getByRole('region', { name: 'Preview' }).locator('strong')).toHaveText(
      'great',
    );
  });

  test('makes lists, a heading and a link', async ({ as }) => {
    const page = await as('owner');
    await open(page);
    const area = field(page);
    await area.fill('one\ntwo');
    await area.press(SELECT_ALL);
    await bar(page).getByRole('button', { name: 'Bulleted list' }).click();
    await expect(area).toHaveValue('- one\n- two');
    await bar(page).getByRole('button', { name: 'Numbered list' }).click();
    await expect(area).toHaveValue('1. one\n2. two');
    await expect(page.getByRole('region', { name: 'Preview' }).locator('ol > li')).toHaveCount(2);
    await area.fill('see the site');
    await typeAndSelect(page, 'see the site', 'the site');
    await bar(page).getByRole('button', { name: 'Link' }).click();
    await expect(area).toHaveValue('see [the site](https://)');
    // the address is selected: what is typed replaces it
    await page.keyboard.type('https://example.org');
    await expect(area).toHaveValue('see [the site](https://example.org)');
    await expect(
      page.getByRole('region', { name: 'Preview' }).getByRole('link', { name: 'the site' }),
    ).toHaveAttribute('href', 'https://example.org/');
  });

  test('answers to Ctrl or Cmd + B and I', async ({ as }) => {
    const page = await as('owner');
    await open(page);
    await typeAndSelect(page, 'a word here', 'word');
    await page.keyboard.press(BOLD);
    await expect(field(page)).toHaveValue('a **word** here');
    await typeAndSelect(page, 'a word here', 'here');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+i' : 'Control+i');
    await expect(field(page)).toHaveValue('a word *here*');
  });

  test('is one stop of the keyboard, moved by the arrows', async ({ as }) => {
    const page = await as('owner');
    await open(page);
    const buttons = bar(page).getByRole('button');
    await page.getByRole('textbox', { name: /^Location/ }).focus();
    await page.keyboard.press('Tab');
    // after the location, the next stop is the first button of the bar: Bold
    await expect(buttons.first()).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(buttons.nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(buttons.last()).toBeFocused();
    // Tab leaves the bar for the field: six buttons are not six stops
    await page.keyboard.press('Tab');
    await expect(field(page)).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(buttons.last()).toBeFocused();
  });

  test('on a phone: buttons of 44 px, a tab for the preview, nothing that scrolls sideways', async ({
    as,
  }) => {
    const page = await as('owner');
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    for (const name of ['Bold', 'Italic', 'Heading', 'Bulleted list', 'Numbered list', 'Link']) {
      const box = await bar(page).getByRole('button', { name }).boundingBox();
      expect(box?.width, name).toBeGreaterThanOrEqual(44);
      expect(box?.height, name).toBeGreaterThanOrEqual(44);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await typeAndSelect(page, 'a great night', 'great');
    await bar(page).getByRole('button', { name: 'Bold' }).click();
    await expect(field(page)).toHaveValue('a **great** night');
    // the preview is behind its tab, and the bar goes with the field
    await page.getByRole('tab', { name: 'Preview' }).click();
    await expect(page.getByRole('region', { name: 'Preview' }).locator('strong')).toHaveText(
      'great',
    );
    await expect(bar(page)).toBeHidden();
    await page.getByRole('tab', { name: 'Write' }).click();
    await expect(bar(page)).toBeVisible();
  });
});
