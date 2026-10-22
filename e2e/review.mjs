// covers: events.refuseEvent
// End-to-end test of the proposal circuit of the events module, in a real browser, on the real image, in French and in
// English: somebody whose role only proposes events creates one, a validator finds it in "To validate" (counted in the
// menu) and approves it, or refuses it with a comment that its author reads and answers by proposing it again; and
// what a proposer, a member and a validator may NOT see or do.
//
//   AUTH_SECRET=<the session secret of the platform> PSQL="<a psql command on the platform's database>" \
//     node e2e/review.mjs <address>
//   OWNER=alice     the login of an owner account (it must exist): the validator
//   MEMBER=carol    the login of a member who can read events but not create them (it must exist)
//   CHROME_PATH=...  SHOTS=<folder>
//
// The proposer ("dave") is made here, with a role of its own that holds only `events.propose`, and removed with
// everything he wrote when the script ends. Nobody can sign in through 42 here: the session cookies are forged with
// the platform's own secret, exactly as Auth.js writes them, one browser context for each person so that their
// cookies never mix. Every answer waits for the page to CHANGE (see "Navigation" in docs/architecture.md): the
// actions of the circuit answer an address, which the browser loads.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { encode } from '@auth/core/jwt';
import puppeteer from 'puppeteer-core';
import { settled, watchPage } from './watch-page.mjs';
import { sqlRunner } from './sql.mjs';

const [base] = process.argv.slice(2);
const secret = process.env.AUTH_SECRET;
const PSQL = process.env.PSQL;
if (!base || !secret || !PSQL) {
  console.error('usage: AUTH_SECRET=... PSQL="psql ..." node e2e/review.mjs <address>');
  process.exit(2);
}
const OWNER = process.env.OWNER ?? 'alice';
const MEMBER = process.env.MEMBER ?? 'carol';
const PROPOSER = 'dave';

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const executablePath = CANDIDATES.find((path) => existsSync(path));
if (!executablePath) {
  console.error('No Chrome or Edge found: set CHROME_PATH.');
  process.exit(2);
}
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

const COOKIE = 'authjs.session-token';
const tokens = Object.fromEntries(
  await Promise.all(
    [OWNER, MEMBER, PROPOSER].map(async (login) => [
      login,
      await encode({ token: { login }, secret, salt: COOKIE }),
    ]),
  ),
);

const WORDS = {
  fr: {
    create: "Créer l'événement",
    awaiting: 'En attente de validation',
    review: 'À valider',
    nothing: 'Rien à valider',
    approve: 'Approuver',
    refuse: 'Refuser',
    refuseConfirm: 'Refuser la proposition',
    locked: 'Cet événement est publié',
    propose: 'Proposer à la validation',
    withdraw: 'Retirer la proposition',
    remove: "Supprimer l'événement",
    refused: 'Refusé par',
    notFound: 'Page introuvable',
  },
  en: {
    create: 'Create event',
    awaiting: 'Awaiting validation',
    review: 'To validate',
    nothing: 'Nothing to validate',
    approve: 'Approve',
    refuse: 'Refuse',
    refuseConfirm: 'Refuse the proposal',
    locked: 'This event is published',
    propose: 'Propose for validation',
    withdraw: 'Withdraw the proposal',
    remove: 'Delete event',
    refused: 'Refused by',
    notFound: 'Page not found',
  },
};

const sql = sqlRunner(PSQL);
const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;

const ROLE = 'e2e-role-pole';
const cleanUp = () =>
  sql(`
    DELETE FROM "Event" WHERE "authorLogin" = ${quote(PROPOSER)};
    DELETE FROM "User" WHERE login = ${quote(PROPOSER)};
    DELETE FROM "Role" WHERE id = ${quote(ROLE)};
  `);
const setUp = () => {
  cleanUp();
  sql(`
    INSERT INTO "Role" (id, name, permissions, "allPermissions", "isDefault", "updatedAt")
      VALUES (${quote(ROLE)}, 'E2E Pôle Events', ARRAY['events.propose', 'events.view'], false, false, now());
    INSERT INTO "User" (id, login, "fullName", email, campus, status, "roleId", "updatedAt")
      VALUES ('e2e-${PROPOSER}', ${quote(PROPOSER)}, 'Dave Pôle', 'dave@example.org', 'Nice', 'MEMBER', ${quote(ROLE)}, now());
  `);
};
/** A proposal the proposer made, without going through the form. */
const insertProposal = (id, title) =>
  sql(`
    INSERT INTO "Event" (id, title, description, location, "categoryKey", status, "startsAt", "endsAt",
      "schoolYear", "authorLogin", "proposedAt", "updatedAt")
    VALUES (${quote(id)}, ${quote(title)}, 'Proposed in a test', 'Room', 'soiree', 'PROPOSED', now() + interval '12 days',
      now() + interval '12 days 2 hours', '2026-2027', ${quote(PROPOSER)}, now(), now())
  `);
const eventRow = (id) =>
  sql(
    `SELECT status::text || '|' || coalesce("refusalComment", '') FROM "Event" WHERE id = ${quote(id)}`,
  );
const auditActions = (id) =>
  sql(`SELECT action FROM "AuditLog" WHERE "targetId" = ${quote(id)} ORDER BY action`)
    .split('\n')
    .filter(Boolean);

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox'],
  // A busy runner can take longer than the 30 s allowed by default to start the browser.
  timeout: 120000,
});
const fail = (message) => {
  throw new Error(message);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One person, in a browser context of their own, with the language of the round. */
async function person(login, lang, label) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setExtraHTTPHeaders({ 'Accept-Language': lang });
  await page.setCookie({ name: COOKIE, value: tokens[login], url: base, httpOnly: true });
  page.setDefaultTimeout(15000);
  if (process.env.TIMEZONE) await page.emulateTimezone(process.env.TIMEZONE);
  const watch = await watchPage(page, {
    label: `${label} ${login}`,
    shots: shots && join(shots, 'errors'),
  });
  const open = async (path) => {
    const response = await page.goto(`${base}/${lang}${path}`, { waitUntil: 'networkidle0' });
    await settled(page).catch(() => undefined);
    return response;
  };
  const text = () => page.evaluate(() => document.body.innerText);
  /** True when `until` becomes true in the page within `timeout`; a page being replaced is "not yet". */
  const waitFor = async (until, argument, timeout = 10000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await page.evaluate(until, argument).catch(() => false)) return true;
      await sleep(100);
    }
    return false;
  };
  const has = (wanted, timeout) =>
    waitFor((value) => document.body.innerText.includes(value), wanted, timeout);
  /** The first enabled button or link of `scope` that starts with `wanted`. */
  const find = async (wanted, scope = 'body') => {
    const handle = await page
      .waitForFunction(
        ([where, label]) =>
          [...document.querySelectorAll(`${where} button, ${where} a`)].find(
            (el) =>
              el.textContent?.trim().startsWith(label) &&
              !el.disabled &&
              el.getAttribute('aria-disabled') !== 'true',
          ),
        { timeout: 7000 },
        [scope, wanted],
      )
      .catch(() => null);
    if (!handle) fail(`[${label}] ${login}: no button "${wanted}" in ${scope} on ${page.url()}`);
    return handle.asElement();
  };
  /** Clicks something that makes the browser LOAD a page (an action answering an address) and waits for it. */
  const clickAndLoad = async (wanted, scope) => {
    const element = await find(wanted, scope);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), element.click()]);
    await settled(page).catch(() => undefined);
  };
  /** Clicks something that goes to another page through the router (no page load) and waits for `until`. */
  const clickAndWait = async (wanted, scope, until, argument, what) => {
    await (await find(wanted, scope)).click();
    if (!(await waitFor(until, argument, 15000))) {
      fail(`[${label}] ${login}: clicked "${wanted}", but ${what} (still on ${page.url()})`);
    }
    await settled(page).catch(() => undefined);
  };
  const close = async () => {
    if (watch.errors.length > 0) {
      fail(`[${label}] ${login}: the page raised errors: ${(await watch.describe()).join(' | ')}`);
    }
    await context.close();
  };
  return { page, open, text, has, find, waitFor, clickAndLoad, clickAndWait, close };
}

async function round(lang) {
  const label = lang;
  const words = WORDS[lang];
  const step = (message) => console.log(`✓ [${label}] ${message}`);
  const title = `E2E proposal ${lang} ${Date.now().toString(36)}`;
  const second = `e2e-proposal-${lang}-${Date.now().toString(36)}`;
  const secondTitle = `${title} (refused)`;
  setUp();

  const dave = await person(PROPOSER, lang, label);
  const alice = await person(OWNER, lang, label);
  const carol = await person(MEMBER, lang, label);
  let id = '';
  try {
    // ---- the proposer creates an event: it is a proposal, not a published event ------------------------------------
    await dave.open('/events/new');
    const status = await dave.page.$eval('#status', (el) => ({
      value: el.value,
      options: [...el.options].map((option) => option.value),
    }));
    if (status.value !== 'PROPOSED' || status.options.includes('CONFIRMED')) {
      fail(
        `[${label}] the proposer's form offers ${JSON.stringify(status)}: expected a proposal, and no confirmation`,
      );
    }
    await dave.page.type('#title', title);
    await dave.page.type('#description', 'Proposed in a test');
    await dave.page.type('#location', 'Room');
    // The form leaves for the page of the new event (another pathname, which the router shows).
    await dave.clickAndWait(
      words.create,
      'form',
      () => /\/events\/[^/]+$/.test(location.pathname) && !location.pathname.endsWith('/new'),
      undefined,
      'the form did not lead to the new event',
    );
    id = new URL(dave.page.url()).pathname.split('/').pop();
    if (!(await dave.has(words.awaiting)))
      fail(`[${label}] the proposer is not told the event waits (${dave.page.url()})`);
    const own = await dave.text();
    if (own.includes(words.approve) || own.includes(words.refuse)) {
      fail(`[${label}] the author of a proposal can answer it`);
    }
    if (eventRow(id) !== 'PROPOSED|')
      fail(`[${label}] the event is ${eventRow(id)}, expected a proposal`);
    step('a proposer creates a proposal, and is told it waits for a validator');

    // ---- nobody else can see it ---------------------------------------------------------------------------------
    // (The response is streamed before the page knows: it answers 200 with its "not found" content.)
    const missing = async (who, path, what) => {
      await who.open(path);
      const text = await who.text();
      if (!text.includes(words.notFound) || text.includes(title)) {
        fail(`[${label}] ${what}: expected the page not found, got ${text.slice(0, 120)}`);
      }
    };
    await missing(carol, `/events/${id}`, 'a member opened a proposal');
    await carol.open('/events?view=list');
    if ((await carol.text()).includes(title))
      fail(`[${label}] a member sees a proposal in the list`);
    await missing(carol, '/events/review', 'a member reached the list to validate');
    await missing(dave, '/events/review', 'a proposer reached the list to validate');
    step(
      'a member sees neither the proposal nor the list to validate; the proposer does not reach it',
    );

    // ---- the validator finds it, counted in the menu ---------------------------------------------------------------
    await alice.open('/events?view=list');
    const counter = await alice.page.$eval('nav a[href$="/events/review"]', (el) =>
      el.innerText.trim(),
    );
    if (!counter.includes(words.review) || !/\b1\b/.test(counter)) {
      fail(
        `[${label}] the menu says "${counter.replace(/\n/g, ' ')}": expected "${words.review}" and 1`,
      );
    }
    await alice.clickAndWait(
      words.review,
      'nav',
      () => location.pathname.endsWith('/events/review'),
      undefined,
      'the menu did not lead to the list to validate',
    );
    const listed = await alice.text();
    if (!listed.includes(title) || !listed.includes('Dave Pôle')) {
      fail(`[${label}] the proposal and its author are not in the list to validate`);
    }
    const highlighted = await alice.page.$$eval('nav a[aria-current="page"]', (els) =>
      els.map((el) => el.getAttribute('href')),
    );
    if (highlighted.length !== 1 || !highlighted[0].endsWith('/events/review')) {
      fail(`[${label}] the menu highlights ${JSON.stringify(highlighted)} on the list to validate`);
    }
    step('the validator sees the proposal counted in the menu, and in the list to validate');

    // ---- approving it ---------------------------------------------------------------------------------------------
    await (await alice.find(words.approve, '#main-content')).click();
    await alice.page.waitForSelector('[role="dialog"]');
    await alice.clickAndLoad(words.approve, '[role="dialog"]');
    if (!(await alice.has(words.nothing)))
      fail(`[${label}] the list still shows the approved proposal`);
    if ((await alice.page.$('nav a[href$="/events/review"] span[aria-hidden]')) !== null) {
      fail(`[${label}] the menu still counts a proposal after the last one was approved`);
    }
    if (eventRow(id) !== 'CONFIRMED|')
      fail(`[${label}] the event is ${eventRow(id)} after its approval`);
    const trail = auditActions(id).join(',');
    // (the three entries of one transaction share their time: they are told apart by name)
    if (trail !== 'event.approve,event.create,event.propose')
      fail(`[${label}] the audit log says ${trail}`);
    step('approving publishes the event, and the audit log records the proposal and its approval');

    const visible = await carol.open(`/events/${id}`);
    if (visible.status() !== 200 || !(await carol.text()).includes(title)) {
      fail(`[${label}] a member cannot read the approved event`);
    }
    step('a member now reads the event');

    // ---- the author of a published event cannot change it ---------------------------------------------------------
    await dave.open(`/events/${id}`);
    if (!(await dave.has(words.locked)))
      fail(`[${label}] nothing explains to the author why a published event cannot be changed`);
    const controls = await dave.page.$$eval('a[href$="/edit"], button', (els) =>
      els.map((el) => el.textContent.trim()).filter(Boolean),
    );
    if (controls.some((name) => name.startsWith(words.remove) || name.startsWith(words.propose))) {
      fail(`[${label}] the author of a published event is offered ${JSON.stringify(controls)}`);
    }
    if ((await dave.page.$('a[href$="/edit"]')) !== null)
      fail(`[${label}] a published event has an edit link for its proposer`);
    await dave.open(`/events/${id}/edit`);
    if (!new URL(dave.page.url()).pathname.endsWith(`/events/${id}`)) {
      fail(
        `[${label}] the proposer opened ${dave.page.url()}: expected to be sent back to the event`,
      );
    }
    step(
      'the author of a published event is told why there is no edit button, and the form sends them back',
    );

    // ---- refusing a proposal, with a comment the author reads ---------------------------------------------------------
    insertProposal(second, secondTitle);
    await alice.open('/events/review');
    if (!(await alice.has(secondTitle))) fail(`[${label}] the second proposal is not listed`);
    await (await alice.find(words.refuse, '#main-content')).click();
    await alice.page.waitForSelector('[role="dialog"]');
    // A refusal always says why: the button waits for a comment.
    const confirm = await alice.page.waitForFunction(
      (name) =>
        [...document.querySelectorAll('[role="dialog"] button')].find((el) =>
          el.textContent.trim().startsWith(name),
        ),
      {},
      words.refuseConfirm,
    );
    const blocked = await confirm.evaluate(
      (el) => el.disabled || el.getAttribute('aria-disabled') === 'true',
    );
    if (!blocked) fail(`[${label}] a proposal can be refused without a comment`);
    const comment =
      lang === 'fr' ? 'Cette date tombe pendant les examens.' : 'This date falls during the exams.';
    await alice.page.type('[role="dialog"] textarea', comment);
    await alice.clickAndLoad(words.refuseConfirm, '[role="dialog"]');
    if ((await alice.text()).includes(secondTitle))
      fail(`[${label}] the list still shows the refused proposal`);
    if (eventRow(second) !== `DRAFT|${comment}`)
      fail(`[${label}] the refused event is ${eventRow(second)}`);
    if (!auditActions(second).includes('event.refuse'))
      fail(`[${label}] the refusal is not in the audit log`);
    step(
      'a validator refuses a proposal with a comment: it leaves the list and goes back to draft',
    );

    await dave.open(`/events/${second}`);
    if (!(await dave.has(comment)) || !(await dave.has(words.refused))) {
      fail(`[${label}] the author does not read the refusal and its comment`);
    }
    if ((await dave.page.$('a[href$="/edit"]')) === null)
      fail(`[${label}] the author cannot edit a refused event`);
    step('the author reads the comment on the event, and can edit it');

    // ---- proposing again, then withdrawing ------------------------------------------------------------------------
    await dave.clickAndLoad(words.propose);
    if (!(await dave.has(words.awaiting)) || (await dave.text()).includes(comment)) {
      fail(`[${label}] the event does not wait for validation again, or still carries the refusal`);
    }
    if (eventRow(second) !== 'PROPOSED|')
      fail(`[${label}] the event is ${eventRow(second)} after being proposed again`);
    await alice.open('/events/review');
    if (!(await alice.has(secondTitle)))
      fail(`[${label}] the proposal made again is not in the list`);
    step('the author proposes it again: the refusal is over and the validator finds it again');

    await dave.clickAndLoad(words.withdraw);
    if (eventRow(second) !== 'DRAFT|')
      fail(`[${label}] the event is ${eventRow(second)} after the proposal was withdrawn`);
    await alice.open('/events/review');
    if ((await alice.text()).includes(secondTitle))
      fail(`[${label}] a withdrawn proposal is still listed`);
    step('the author withdraws the proposal: it leaves the list to validate');
  } finally {
    for (const who of [dave, alice, carol]) {
      await who.close().catch((error) => {
        if (!process.exitCode) console.error(`✗ ${error.message}`);
        process.exitCode = 1;
      });
    }
  }
}

try {
  for (const lang of ['fr', 'en']) await round(lang);
  console.log('\nAll good.');
} catch (error) {
  console.error(`\n✗ ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  try {
    cleanUp();
  } catch {
    /* the platform is thrown away anyway */
  }
}
