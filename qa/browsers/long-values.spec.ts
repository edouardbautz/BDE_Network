import type { Page } from '@playwright/test';
import { Client } from 'pg';
import { resetDatabase } from '../reset';
import { expect, test } from './fixtures';
import { atRest } from './rest';

/**
 * A long value with no space never leaves its container (docs/design.md, "Long values"). A login, an e-mail address, a name, the
 * title of an event, a place or the name of a role can be 150 characters without a space; the browser cannot break it, so a grid
 * column or a flex item sized by it grew past its card, or the page scrolled sideways. The rule is written once, in the base layer of
 * `globals.css` (`overflow-wrap: anywhere`, which also lowers the minimum width of a grid or flex item), and this file holds it on the
 * screens that show such values.
 *
 * The values are put in the database (the way a member would have typed them), every one starting with `LNG`, then each screen is
 * read on a computer and on a phone, in the light and in the dark theme, in the three engines. Two things are measured: the page
 * does not scroll sideways, and no piece of text that holds a long value sticks out of a box that contains it. A box that scrolls by
 * itself (a table) is a way to read it; a box that clips it is a link (the page it opens shows the value whole) or says the whole value in a `title`.
 */

/** Puts a long value in every text a member types and a page shows. The persona logins stay: the cookies are forged from them. */
async function stretchTheDataset(db: Client) {
  const personas = ['qa-%'];
  await db.query(
    `UPDATE "User" SET "fullName" = 'LNGname' || md5(login) || repeat('b3c4', 30),
       "email" = 'LNGmail.' || repeat('x1y2z3', 20) || md5(login) || '@' || repeat('long-domain', 6) || '.example'`,
  );
  await db.query(
    `UPDATE "User" SET login = 'LNGlogin' || md5(login) || repeat('q9w8', 30) WHERE login NOT LIKE ANY($1)`,
    [personas],
  );
  await db.query(
    `UPDATE "Event" SET title = 'LNGtitle' || md5(id) || repeat('t5r4', 30),
       location = 'LNGplace' || repeat('p0o9', 40),
       description = 'LNGdescription' || repeat('d7s6', 40)`,
  );
  await db.query(
    `UPDATE "Role" SET name = name || '-LNGrole' || repeat('r2e3', 30), description = 'LNGroledescription' || repeat('w1q2', 30)`,
  );
  await db.query(
    `UPDATE "AuditLog" SET "actorLogin" = 'LNGactor' || repeat('a8s7', 30), "targetLabel" = 'LNGtarget' || repeat('g6h5', 30)`,
  );
  await db.query(`UPDATE "NotificationMention" SET label = 'LNGmention' || repeat('m3n4', 20)`);
}

const SCREENS: Array<{ name: string; path: string; as: 'owner' | 'member' }> = [
  { name: 'the dashboard', path: '/en/dashboard', as: 'owner' },
  { name: 'the settings', path: '/en/settings', as: 'owner' },
  { name: 'the profile', path: '/en/profile', as: 'owner' },
  { name: 'the members', path: '/en/members', as: 'owner' },
  { name: 'the roles', path: '/en/roles', as: 'owner' },
  { name: 'the audit log', path: '/en/audit-log', as: 'owner' },
  { name: 'the shared calendar', path: '/en/events/shared-calendar', as: 'owner' },
  { name: 'the list of events', path: '/en/events?view=list', as: 'owner' },
  { name: 'the calendar of events', path: '/en/events', as: 'owner' },
  { name: 'the proposals to validate', path: '/en/events/review', as: 'owner' },
  { name: 'the notifications', path: '/en/notifications', as: 'owner' },
];

const SIZES = [
  { name: 'a computer', viewport: { width: 1280, height: 900 } },
  { name: 'a phone', viewport: { width: 390, height: 800 } },
];

const THEMES = ['light', 'dark'] as const;

/** Lists what sticks out of its container, among the texts that hold a long value. */
async function findOverflow(page: Page): Promise<{ problems: string[]; seen: number }> {
  return page.evaluate(() => {
    const root = document.querySelector('main') ?? document.body;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const problems: string[] = [];
    let seen = 0;

    const sideways = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    if (sideways > 0) problems.push(`the page scrolls sideways by ${sideways}px`);

    const describe = (element: Element) =>
      `${element.tagName.toLowerCase()}${typeof element.className === 'string' && element.className ? `.${element.className.split(/\s+/).slice(0, 3).join('.')}` : ''}`;

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const holder = node.parentElement;
      const content = node.textContent ?? '';
      if (!holder || !content.includes('LNG')) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const text = range.getBoundingClientRect();
      if (text.width < 2) continue;
      // outside the flow (a menu, a toast) or clipped on purpose (sr-only): not measured
      let outside = false;
      for (let a: Element | null = holder; a && a !== document.body; a = a.parentElement) {
        const style = getComputedStyle(a);
        if (style.position === 'fixed' || style.position === 'absolute' || style.clip !== 'auto') {
          outside = true;
          break;
        }
      }
      if (outside) continue;
      seen += 1;
      const label = `"${content.trim().slice(0, 16)}…" in ${describe(holder)}`;
      for (let a: Element | null = holder; a && a !== document.body; a = a.parentElement) {
        const style = getComputedStyle(a);
        const box = a.getBoundingClientRect();
        if (style.overflowX !== 'visible') {
          // a box that scrolls is a way to read it; one that clips is allowed in a link (the page it opens shows the whole value) or with a title
          if (style.overflowX === 'auto' || style.overflowX === 'scroll') break;
          if (text.right > box.right + 1 && !holder.closest('a, [title*="LNG"]')) {
            problems.push(`${label} is clipped by ${describe(a)} and says nothing of the rest`);
          }
          break;
        }
        if (box.width < 2) continue;
        if (text.right > box.right + 1 || text.left < box.left - 1) {
          problems.push(
            `${label} sticks out of ${describe(a)} by ${Math.round(Math.max(text.right - box.right, box.left - text.left))}px`,
          );
          break;
        }
      }
    }
    return { problems, seen };
  });
}

let db: Client;

test.beforeAll(async () => {
  db = new Client({ connectionString: process.env.QA_DATABASE_URL });
  await db.connect();
  await stretchTheDataset(db);
});

test.afterAll(async () => {
  try {
    await resetDatabase(db);
  } finally {
    await db.end();
  }
});

for (const screen of SCREENS) {
  for (const size of SIZES) {
    for (const theme of THEMES) {
      test(`${screen.name} holds very long values on ${size.name}, ${theme}`, async ({ as }) => {
        const page = await as(screen.as, { viewport: size.viewport, colorScheme: theme });
        await page.goto(screen.path);
        await atRest(page);
        const { problems } = await findOverflow(page);
        expect(problems, problems.join('\n')).toEqual([]);
      });
    }
  }
}

test('the long values are really on the screens that are meant to show them', async ({ as }) => {
  // a check that cannot fail proves nothing: the members page, the audit log and the list of events must hold some
  for (const path of ['/en/members', '/en/audit-log', '/en/events?view=list', '/en/roles']) {
    const page = await as('owner', { viewport: { width: 1280, height: 900 } });
    await page.goto(path);
    await atRest(page);
    const { seen } = await findOverflow(page);
    expect(seen, `${path} shows no long value`).toBeGreaterThan(0);
  }
});
