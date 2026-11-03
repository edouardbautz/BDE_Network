import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { atRest } from './rest';

/**
 * The rows of a list that open a page open it from all of it (docs/design.md, "Rows that open a page"). On "To publish on the intra" and "To
 * validate" there are three ways to open the page of a row, which lead to the same place: the title, anywhere on the row, and a button
 * "View details" (on a computer and on a phone); the list of events has the first two. The row is one link (the title, stretched over the
 * row): one stop of the keyboard, its name the title, a focus ring around the whole row, a hover that can be seen, nothing nested in an
 * anchor, and what else is clickable in the row (the two buttons of a proposal) keeps its own behaviour.
 */

const SIZES = [
  { name: 'a computer', viewport: { width: 1280, height: 900 } },
  { name: 'a phone', viewport: { width: 390, height: 800 } },
];

const firstRow = (page: Page) =>
  page
    .locator('li')
    .filter({ has: page.locator('a[data-row-link]') })
    .first();
/** The box that draws the row (its ground under the pointer, its ring): the first child of the line. */
const surface = (page: Page) => firstRow(page).locator('> div').first();

const destination = async (row: Locator) => {
  const href = (await row.locator('a[data-row-link]').getAttribute('href')) ?? '';
  expect(href).not.toBe('');
  return href;
};

/**
 * A click with the pointer at the middle of something that is under the stretched link: what a person does. (Playwright's own `click` refuses to
 * click an element another element covers, which is the point of the pattern.)
 */
async function pointerAt(target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error('not drawn');
  await target.page().mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

const here = (page: Page) => {
  const url = new URL(page.url());
  return url.pathname + url.search;
};

/** Opens the page by `how`, checks where it went, and comes back to the list. */
async function opensTheSamePage(
  page: Page,
  list: string,
  how: (row: Locator) => Promise<void>,
  expected: string,
) {
  await page.goto(list);
  await atRest(page);
  await how(firstRow(page));
  await expect.poll(() => here(page)).toBe(expected);
}

async function keyboardStops(row: Locator): Promise<number> {
  return row.evaluate((element) => {
    const stops = Array.from(
      element.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]'),
    ).filter((candidate) => candidate.tabIndex >= 0 && !candidate.hasAttribute('disabled'));
    return stops.length;
  });
}

async function checkRows(
  page: Page,
  list: string,
  options: { details: boolean; actions: string[] },
) {
  await page.goto(list);
  await atRest(page);
  const row = firstRow(page);
  await expect(row).toBeVisible();
  const href = await destination(row);
  const expected = new URL(href, page.url());
  const where = expected.pathname + expected.search;
  const title = ((await row.locator('a[data-row-link]').innerText()) ?? '').trim();

  // The structure: ONE link, nothing interactive nested in it or around it, one stop for the row plus its own actions.
  await expect(row.locator('a[href]')).toHaveCount(1);
  expect(
    await row.evaluate(
      (element) =>
        element.querySelectorAll(
          'a a, a button, button a, a input, a select, a textarea, a [tabindex]:not([tabindex="-1"])',
        ).length,
    ),
    'interactive elements nested in one another',
  ).toBe(0);
  expect(await keyboardStops(row), 'keyboard stops of the row').toBe(1 + options.actions.length);
  // its name is the title
  await expect(page.getByRole('link', { name: title, exact: true }).first()).toHaveAttribute(
    'href',
    href,
  );

  // The explicit button: there, visible on this screen, inside it, and a picture only (it is not a second stop).
  const details = row.getByText('View details', { exact: true });
  if (options.details) {
    await expect(details).toBeVisible();
    const box = await details.boundingBox();
    const viewport = page.viewportSize()!;
    expect(
      box && box.x >= 0 && box.x + box.width <= viewport.width,
      'View details is on the screen',
    ).toBe(true);
    await expect(details).toHaveAttribute('aria-hidden', 'true');
  } else {
    await expect(details).toHaveCount(0);
  }

  // 1. the title
  await opensTheSamePage(page, list, (r) => r.locator('a[data-row-link]').click(), where);
  // 2. anywhere on the row: its text, and its padding at the corner
  await opensTheSamePage(
    page,
    list,
    (r) => pointerAt(r.locator('.text-muted-foreground').first()),
    where,
  );
  await opensTheSamePage(
    page,
    list,
    (r) => r.click({ position: { x: 3, y: 3 }, force: true }),
    where,
  );
  // 3. the button
  if (options.details) {
    await opensTheSamePage(
      page,
      list,
      (r) => pointerAt(r.getByText('View details', { exact: true })),
      where,
    );
  }

  // The keyboard: Tab reaches the link (the first stop of the row), Enter opens the page.
  await page.goto(list);
  await atRest(page);
  const link = firstRow(page).locator('a[data-row-link]');
  if (test.info().project.name === 'webkit') {
    // WebKit's Tab does not stop on links (its default): a key pressed puts the page in keyboard mode, and the link is put under the focus,
    // which is what `keyboard.spec.ts` does for the skip link.
    await page.keyboard.press('Tab');
    await link.focus();
  } else {
    for (let presses = 0; presses < 90; presses += 1) {
      await page.keyboard.press('Tab');
      if (await link.evaluate((element) => element === document.activeElement)) break;
    }
  }
  await expect(link).toBeFocused();
  // the ring is drawn around the whole row (the link draws none), and the row is wider than the title
  const ring = await surface(page).evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      width: style.outlineWidth,
      style: style.outlineStyle,
      box: element.getBoundingClientRect().width,
    };
  });
  expect(ring.width, 'the ring of the row').toBe('3px');
  expect(ring.style).toBe('solid');
  expect(await link.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe('0px');
  expect(ring.box).toBeGreaterThan((await link.boundingBox())!.width);
  await page.keyboard.press('Enter');
  await expect.poll(() => here(page)).toBe(where);

  // What else is in the row keeps its own behaviour, and never opens the row.
  for (const action of options.actions) {
    await page.goto(list);
    await atRest(page);
    await firstRow(page).getByRole('button', { name: action, exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(here(page), `${action} opened the row`).toBe(new URL(list, page.url()).pathname);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  }

  // The pointer is seen: the ground of the row changes under it (a computer; a phone has no pointer to hover with).
  if (page.viewportSize()!.width >= 1000) {
    await page.goto(list);
    await atRest(page);
    const target = surface(page);
    await page.mouse.move(2, 2);
    const before = await target.evaluate((element) => getComputedStyle(element).backgroundColor);
    const text = (await target.locator('.text-muted-foreground').first().boundingBox())!;
    await page.mouse.move(text.x + text.width / 2, text.y + text.height / 2);
    await expect
      .poll(() => target.evaluate((element) => getComputedStyle(element).backgroundColor))
      .not.toBe(before);
  }

  // Nothing scrolls sideways
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
}

for (const size of SIZES) {
  test.describe(`a row that opens a page, on ${size.name}`, () => {
    test('the list of events: the title and the whole line', async ({ as }) => {
      const page = await as('member', { viewport: size.viewport });
      await checkRows(page, '/en/events?view=list', { details: false, actions: [] });
    });

    test('"To validate": title, the whole row and "View details"; Refuse and Validate stay their own', async ({
      as,
    }) => {
      const page = await as('validator', { viewport: size.viewport });
      await checkRows(page, '/en/events/review', {
        details: true,
        actions: ['Refuse', 'Validate'],
      });
    });

    test('"To publish on the intra": title, the whole row and "View details"', async ({ as }) => {
      const owner = await as('owner');
      await owner.goto('/en/settings');
      const toggle = owner.getByRole('switch', { name: 'Publish events on the 42 intra' });
      await expect(toggle).toBeVisible();
      await atRest(owner);
      const wasOn = (await toggle.getAttribute('aria-checked')) === 'true';
      if (!wasOn) {
        await toggle.click();
        await owner
          .locator('form', { has: owner.getByLabel('Reminder hour') })
          .getByRole('button', { name: 'Save' })
          .click();
        await expect(owner.getByText('Saved', { exact: true })).toBeVisible();
        await atRest(owner);
      }
      try {
        const page = await as('staff', { viewport: size.viewport });
        await checkRows(page, '/en/events/intra', { details: true, actions: [] });
      } finally {
        if (!wasOn) {
          await owner.goto('/en/settings');
          const back = owner.getByRole('switch', { name: 'Publish events on the 42 intra' });
          await expect(back).toBeVisible();
          await atRest(owner);
          await back.click();
          await owner
            .locator('form', { has: owner.getByLabel('Reminder hour') })
            .getByRole('button', { name: 'Save' })
            .click();
          await expect(owner.getByText('Saved', { exact: true })).toBeVisible();
        }
      }
    });
  });
}
