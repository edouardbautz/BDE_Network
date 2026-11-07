import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { atRest } from './rest';

/**
 * The rows that carry actions (docs/design.md, "Tables and rows"): on a computer the menu of the role and the two buttons of a
 * request are on one line, aligned to the right of the column of actions, the menu as wide as its longest role and not as the whole
 * line (a native menu fills its line by default: the buttons went under it); on a phone they stack, the menu on its own line and the
 * two buttons side by side, each one 44 px high at least, with nothing that scrolls sideways.
 */

const box = async (locator: Locator) => {
  const found = await locator.boundingBox();
  if (!found) throw new Error('not drawn');
  return found;
};
const middle = (found: { y: number; height: number }) => found.y + found.height / 2;

async function noSideways(page: Page, name: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${name} scrolls sideways`).toBeLessThanOrEqual(0);
}

const request = (page: Page) =>
  page
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name: 'Approve', exact: true }) })
    .first();

test.describe('a request waiting for approval', () => {
  test('is one line on a computer: the menu, then Approve and Refuse, to the right', async ({
    as,
  }) => {
    const page = await as('owner');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/en/members');
    await atRest(page);
    const row = request(page);
    await expect(row).toBeVisible();
    const menu = await box(row.getByRole('combobox'));
    const approve = await box(row.getByRole('button', { name: 'Approve', exact: true }));
    const reject = await box(row.getByRole('button', { name: /^Reject/ }));
    const line = await box(row);

    // one line: the three controls share their middle
    expect(Math.abs(middle(menu) - middle(approve))).toBeLessThanOrEqual(3);
    expect(Math.abs(middle(reject) - middle(approve))).toBeLessThanOrEqual(3);
    // in the order of the screen, nothing on another line
    expect(menu.x + menu.width).toBeLessThanOrEqual(approve.x);
    expect(approve.x + approve.width).toBeLessThanOrEqual(reject.x);
    // the menu is as wide as its content, not as the room there is
    expect(menu.width).toBeLessThan(260);
    expect(menu.width).toBeLessThan(line.width / 3);
    // aligned to the right of the row
    expect(line.x + line.width - (reject.x + reject.width)).toBeLessThan(40);
    // and the row is one line high
    expect(line.height).toBeLessThan(80);
    await noSideways(page, 'the members page');
  });

  test('stacks on a phone: the menu across, the two buttons side by side, 44 px at least', async ({
    as,
  }) => {
    const page = await as('owner');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/en/members');
    await atRest(page);
    const row = request(page);
    await expect(row).toBeVisible();
    const menu = await box(row.getByRole('combobox'));
    const approve = await box(row.getByRole('button', { name: 'Approve', exact: true }));
    const reject = await box(row.getByRole('button', { name: /^Reject/ }));

    // the menu above the buttons, and as wide as both of them together
    expect(menu.y + menu.height).toBeLessThanOrEqual(approve.y + 1);
    expect(menu.width).toBeGreaterThanOrEqual(approve.width + reject.width);
    // the buttons on one line, equal, filling the width of the menu
    expect(Math.abs(middle(approve) - middle(reject))).toBeLessThanOrEqual(2);
    expect(Math.abs(approve.width - reject.width)).toBeLessThanOrEqual(2);
    expect(reject.x + reject.width).toBeLessThanOrEqual(menu.x + menu.width + 1);
    // targets of 44 px
    for (const control of [menu, approve, reject])
      expect(control.height).toBeGreaterThanOrEqual(44);
    await noSideways(page, 'the members page');
  });
});

test.describe('an approved member', () => {
  test('has a menu of the width of its roles on a computer, and across the line on a phone', async ({
    as,
  }) => {
    const page = await as('owner');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/en/members');
    await atRest(page);
    const approved = page
      .getByRole('row')
      .filter({ has: page.getByRole('button', { name: /^Remove/ }) })
      .first();
    const menu = await box(approved.getByRole('combobox'));
    expect(menu.width).toBeLessThan(260);

    await page.setViewportSize({ width: 390, height: 844 });
    await atRest(page);
    const small = await box(approved.getByRole('combobox'));
    expect(small.width).toBeGreaterThan(menu.width);
    expect(small.height).toBeGreaterThanOrEqual(44);
    await noSideways(page, 'the members page');
  });
});

test.describe('a proposal to validate', () => {
  test('has its two buttons side by side, 44 px high, across the line on a phone', async ({
    as,
  }) => {
    const page = await as('validator');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/en/events/review');
    await atRest(page);
    const proposal = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('button', { name: /Validate/ }) })
      .first();
    const approve = await box(proposal.getByRole('button', { name: /Validate/ }));
    const refuse = await box(proposal.getByRole('button', { name: /Refuse/ }));
    expect(Math.abs(middle(approve) - middle(refuse))).toBeLessThanOrEqual(2);
    expect(approve.height).toBeGreaterThanOrEqual(44);
    expect(refuse.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(approve.width - refuse.width)).toBeLessThanOrEqual(2);
    await noSideways(page, 'the proposals page');
  });
});

test.describe('the actions of a role', () => {
  // Edit, Make default and Delete: a role that is the default has no "Make default" nor "Delete", and the buttons that remain must not
  // move to fill the gap (the "Edit" of the default role used to sit to the right of the others').
  const actionsOf = async (page: Page) => {
    const rows = page
      .getByRole('row')
      .filter({ has: page.getByRole('button', { name: /^Edit the role/ }) });
    const count = await rows.count();
    const found: { edit: Box; makeDefault?: Box; remove?: Box }[] = [];
    for (let index = 0; index < count; index++) {
      const row = rows.nth(index);
      const makeDefault = row.getByRole('button', { name: /^Make default/ });
      const remove = row.getByRole('button', { name: /^Delete/ });
      found.push({
        edit: await box(row.getByRole('button', { name: /^Edit the role/ })),
        makeDefault: (await makeDefault.count()) ? await box(makeDefault) : undefined,
        remove: (await remove.count()) ? await box(remove) : undefined,
      });
    }
    return found;
  };
  type Box = { x: number; y: number; width: number; height: number };

  test('are in fixed columns on a computer, whatever the role lacks', async ({ as }) => {
    const page = await as('owner');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/en/roles');
    await atRest(page);
    const rows = await actionsOf(page);
    expect(rows.length).toBeGreaterThan(2);
    // the dataset has a default role (no second and third action) and roles that have all three
    expect(rows.some((row) => !row.makeDefault)).toBe(true);
    expect(rows.some((row) => row.makeDefault && row.remove)).toBe(true);
    for (const key of ['edit', 'makeDefault', 'remove'] as const) {
      const xs = rows.flatMap((row) => (row[key] ? [row[key]!.x] : []));
      expect(
        Math.max(...xs) - Math.min(...xs),
        `the "${key}" button moves from a row to another`,
      ).toBeLessThanOrEqual(1);
    }
    const full = rows.find((row) => row.makeDefault && row.remove)!;
    expect(full.edit.x + full.edit.width).toBeLessThanOrEqual(full.makeDefault!.x);
    expect(full.makeDefault!.x + full.makeDefault!.width).toBeLessThanOrEqual(full.remove!.x);
    await noSideways(page, 'the roles page');
  });

  test('stack on a phone, each across the line and 44 px high', async ({ as }) => {
    const page = await as('owner');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/en/roles');
    await atRest(page);
    const rows = await actionsOf(page);
    expect(rows.length).toBeGreaterThan(2);
    for (const row of rows) {
      const buttons = [row.edit, row.makeDefault, row.remove].filter((b): b is Box => !!b);
      for (const button of buttons) expect(button.height).toBeGreaterThanOrEqual(44);
      // one under the other, same left edge and same width: a clean column
      for (const button of buttons) {
        expect(Math.abs(button.x - row.edit.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(button.width - row.edit.width)).toBeLessThanOrEqual(1);
      }
    }
    await noSideways(page, 'the roles page');
  });
});
