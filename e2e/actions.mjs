// covers: members.approveMember, members.rejectMember, members.removeMember, members.changeMemberRole
// covers: roles.createRole, roles.updateRole, roles.deleteRole, roles.setDefaultRole
// covers: settings.saveIdentity, settings.saveLogo, settings.removeLogo, settings.saveModules, settings.checkOwner, settings.saveUpdates
// covers: settings.addOwner, settings.removeOwner
// covers: profile.regenerateMyCalendarToken
// covers: notifications.saveTemplate, notifications.customizeChannel, notifications.resetTemplate, notifications.resetNotification
// covers: notifications.restoreVersion, notifications.addMention, notifications.removeMention
// covers: shared-calendar.enableSharedCalendar, shared-calendar.regenerateSharedCalendar, shared-calendar.disableSharedCalendar
// covers: intra.requestOnIntra, intra.publishOnIntra, intra.refuseOnIntra, intra.markIntraUpdated
// End-to-end test of what the page shows AFTER an action that stays on it, for every such action of the platform
// (members, roles, settings, profile, shared calendar, language, sign-out), in a real browser, on the real image.
//
//   AUTH_SECRET=<the session secret of the platform> PSQL="<a psql command on the platform's database>" \
//     node e2e/actions.mjs <address>
//   OWNER=alice       the login of an owner account (it must exist)
//   ROUNDS=3          how many times each scenario is played (the defect this test hunts is random: about one click in
//                     two before it was fixed, so one round proves nothing)
//   MEASURE=1         do not fail: print, for each scenario, how many rounds were fine, STALE or FAILED
//   ONLY=members      play only the scenarios whose name contains this (several, separated by |: ONLY='shared|intra')
//   OWNER_CANDIDATE=bob  a login that the platform's 42 (or its stand-in) knows, to add as an owner; by default a made-up
//                     one, which only works when 42 cannot answer (the owner then accepts it unverified)
//   LATENCY_MS=20 KBPS=1500   slow the connection down      CPU_THROTTLE=4   slow the browser's processor down (four times)
//   TIMEZONE=Asia/Kolkata   another time zone for the browser
//   CHROME_PATH=...   SHOTS=<folder>
//
// Why it exists: in the production build, Next.js 15 often does not show the page it fetched after an action that
// stays on the page you are on (the action is done and written to the audit log, the page keeps its old state), and
// `next dev` never does it. Every scenario therefore waits for the page to CHANGE, with no reload, and when it does not
// it reloads once to tell the two failures apart: STALE (the reload shows what was asked, so the action worked and
// the page did not follow) or FAILED (the action itself did not do it). See "Actions that stay on the page" in
// docs/architecture.md.
//
// Nobody can sign in through 42 here: the session cookie is forged with the platform's own secret, exactly as Auth.js
// writes it. Each scenario creates what it needs with SQL (`PSQL` reads the statements on its standard input) and
// removes it afterwards, so it can be played again and again on the same platform.
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { encode } from '@auth/core/jwt';
import puppeteer from 'puppeteer-core';
import { watchNetwork } from './network.mjs';
import { sqlRunner } from './sql.mjs';

const [base] = process.argv.slice(2);
const secret = process.env.AUTH_SECRET;
const PSQL = process.env.PSQL;
if (!base || !secret || !PSQL) {
  console.error('usage: AUTH_SECRET=... PSQL="psql ..." node e2e/actions.mjs <address>');
  process.exit(2);
}
const OWNER = process.env.OWNER ?? 'alice';
const ROUNDS = Number(process.env.ROUNDS ?? 3);
const MEASURE = process.env.MEASURE === '1';
const ONLY = process.env.ONLY ?? '';

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
const token = await encode({ token: { login: OWNER }, secret, salt: COOKIE });

const sql = sqlRunner(PSQL);

/** A real PNG of one colour, made here (no file to ship): the server checks what it receives. */
function makePng(side) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes) => {
    let c = 0xffffffff;
    for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(side * 3, 0x60)]);
  const data = Buffer.concat(Array.from({ length: side }, () => row));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(data)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const logoFile = join(mkdtempSync(join(tmpdir(), 'bde-actions-')), 'logo.png');
writeFileSync(logoFile, makePng(128));

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox'],
  // A busy runner can take longer than the 30 s allowed by default to start the browser.
  timeout: 120000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000 });
page.setDefaultTimeout(15000);
// The connection, the processor and the time zone of the browser can be set (a busy runner, a distant server): what is measured must
// not depend on them.
if (process.env.LATENCY_MS || process.env.KBPS) {
  const session = await page.createCDPSession();
  const kbps = Number(process.env.KBPS ?? 0);
  await session.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: Number(process.env.LATENCY_MS ?? 0),
    downloadThroughput: kbps > 0 ? (kbps * 1000) / 8 : -1,
    uploadThroughput: kbps > 0 ? (kbps * 1000) / 8 : -1,
  });
}
if (process.env.CPU_THROTTLE) await page.emulateCPUThrottling(Number(process.env.CPU_THROTTLE));
if (process.env.TIMEZONE) await page.emulateTimezone(process.env.TIMEZONE);
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
// What the page has on its way, for the waits that name themselves and for the wait for the network to rest. (Not
// `page.waitForNetworkIdle`: it counts for good a request that a navigation cut short, see network.mjs.)
const network = await watchNetwork(page);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const signIn = () => page.setCookie({ name: COOKIE, value: token, url: base, httpOnly: true });
await signIn();

/** True when `until` becomes true in the page within `timeout`; a page being replaced is "not yet", not an error. */
async function waitFor(until, argument, timeout = 7000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.evaluate(until, argument).catch(() => false)) return true;
    await sleep(100);
  }
  return false;
}
const goto = (path) => page.goto(`${base}/fr${path}`, { waitUntil: 'networkidle0' });

/** The first button or link of the page (or of `scope`) that starts with `label`, waited for. */
async function find(label, scope = 'body') {
  try {
    const handle = await page.waitForFunction(
      ([where, wanted]) =>
        [
          ...document.querySelectorAll(`${where} button, ${where} a, ${where} [role="menuitem"]`),
        ].find((el) => el.textContent?.trim().startsWith(wanted) && !el.disabled),
      { timeout: 7000 },
      [scope, label],
    );
    return handle.asElement();
  } catch {
    throw new Error(`no button "${label}" in ${scope}`);
  }
}
const click = async (label, scope) => {
  // A page that has just loaded may still be settling (hydration, an animation): try again before giving up.
  for (let attempt = 1; ; attempt++) {
    try {
      await (await find(label, scope)).click();
      return;
    } catch (error) {
      if (attempt >= 4) throw new Error(`${error.message} (clicking "${label}")`);
      await sleep(250);
    }
  }
};
const dialog = '[role="dialog"]';
/** Clicks something that makes the browser LOAD a page (an action that answers an address) and waits for the load. */
const clickAndLoad = (label, scope) =>
  Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), click(label, scope)]);

/** A button inside the table row (or list item) that holds `text`. */
async function clickInRow(text, label) {
  try {
    const handle = await page.waitForFunction(
      ([wanted, name]) => {
        const row = [...document.querySelectorAll('tr, li')].find(
          (el) => el.innerText.includes(wanted) && el.querySelector('button, a'),
        );
        return row
          ? [...row.querySelectorAll('button, a')].find((el) =>
              el.textContent?.trim().startsWith(name),
            )
          : null;
      },
      { timeout: 7000 },
      [text, label],
    );
    await handle.asElement().click();
  } catch {
    throw new Error(`no "${label}" in the row of "${text}"`);
  }
}

/**
 * What the page must show after the action. Waits for it with no reload; when it does not come, reloads once: if the
 * reload shows it, the action worked and the page did not follow (STALE), else the action did not do it (FAILED).
 */
async function expectPage(until, argument, what) {
  if (await waitFor(until, argument)) return 'ok';
  await page.reload({ waitUntil: 'networkidle0' });
  const afterReload = await waitFor(until, argument, 2500);
  if (shots)
    await page.screenshot({ path: join(shots, `actions-${what.replace(/\W+/g, '-')}.png`) });
  return afterReload ? 'STALE' : 'FAILED';
}

/** Says what waited, and what the page still had on its way, when something did not come: "Timed out after waiting 15000ms" alone does not say. */
async function during(what, promise) {
  try {
    return await promise;
  } catch (error) {
    throw new Error(`${what}: ${error.message.split('\n')[0]} [${network.describe()}]`);
  }
}

const suffix = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e3).toString(36)}`;
const createPending = (login) =>
  sql(
    `INSERT INTO "User" (id, login, "fullName", email, campus, status, "updatedAt") VALUES ('u-${login}', '${login}', 'Person ${login}', '${login}@example.org', 'Nice', 'PENDING', now())`,
  );
const createMember = (login) =>
  sql(
    `INSERT INTO "User" (id, login, "fullName", email, campus, status, "roleId", "updatedAt") SELECT 'u-${login}', '${login}', 'Person ${login}', '${login}@example.org', 'Nice', 'MEMBER', id, now() FROM "Role" WHERE "isDefault"`,
  );
const deleteUser = (login) => sql(`DELETE FROM "User" WHERE login = '${login}'`);
const createRole = (name) =>
  sql(
    `INSERT INTO "Role" (id, name, permissions, "allPermissions", "isDefault", "updatedAt") VALUES ('r-${name.replace(/\W+/g, '-')}', '${name}', ARRAY[]::text[], false, false, now())`,
  );
const deleteRole = (name) => sql(`DELETE FROM "Role" WHERE name = '${name}'`);
const defaultRole = () => sql(`SELECT name FROM "Role" WHERE "isDefault"`);
const setDefaultRoleByName = (name) =>
  sql(
    `UPDATE "Role" SET "isDefault" = false WHERE "isDefault"; UPDATE "Role" SET "isDefault" = true WHERE name = '${name}'`,
  );

// ---------------------------------------------------------------------------------------------------------------------
// The scenarios: each one performs an action and returns what `expectPage` says. `ctx.id` is unique to the round.

// The language is chosen in the menu of the account, at the foot of the rail.
async function chooseLanguage(name) {
  await page.click('aside button[aria-haspopup="menu"]');
  await page.waitForSelector('[role="menuitemradio"]');
  await page.evaluate((wanted) => {
    [...document.querySelectorAll('[role="menuitemradio"]')]
      .find((item) => item.textContent.includes(wanted))
      .click();
  }, name);
}

// Publishing the events on the intra is a setting of the platform: turned on and off with the switch of the settings page.
async function setIntraPublication(on) {
  await goto('/settings');
  const selector = '[role="switch"][aria-labelledby="settings-events-intra-title"]';
  await during('the switch of the intra on the settings page', page.waitForSelector(selector));
  if ((await page.$eval(selector, (el) => el.ariaChecked === 'true')) === on) return;
  const answered = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/settings'),
  );
  await page.click(selector);
  const save = await page.evaluateHandle(
    (where) => document.querySelector(where).closest('form').querySelector('button[type="submit"]'),
    selector,
  );
  await save.asElement().click();
  await during('the answer of the settings page to its save', answered);
  await during('the network at rest after the save', network.rests({ idleTime: 500 }));
}

// A confirmed event with every field of the intra, ten days from now, written with SQL as the form would; `waitingRequest` also gives it
// the request that the staff finds in its list (what is on the page is computed from the event: the hash stored with it is not read).
function createIntraEvent(eventId, title, waitingRequest = false) {
  sql(
    `INSERT INTO "Event" (id, title, "categoryKey", status, "startsAt", "endsAt", "schoolYear", "authorLogin", "updatedAt", "intraOrganizerLogin", "intraAudience", "intraMaxPeople", "intraWaitingList", "intraKind", "intraUnsubscribeHours", "intraKeywords") VALUES ('${eventId}', '${title}', 'soiree', 'CONFIRMED', (now() at time zone 'utc') + interval '10 days', (now() at time zone 'utc') + interval '10 days 2 hours', '2026-2027', '${OWNER}', now(), '${OWNER}', 'BOTH', 30, false, 'Association', 0, ARRAY['bde']::text[])`,
  );
  if (waitingRequest) {
    sql(
      `INSERT INTO "IntraRequest" (id, "eventId", status, "contentHash", "requestedAt", "requestedByLogin", "updatedAt") VALUES ('ir-${eventId}', '${eventId}', 'PENDING', repeat('0', 64), now(), '${OWNER}', now())`,
    );
  }
}

// The templates of the notifications: written with SQL, as the page would, and always put back to none.
const clearTemplates = () =>
  sql(
    `DELETE FROM "NotificationTemplateVersion"; DELETE FROM "NotificationTemplate"; DELETE FROM "NotificationMention"`,
  );
const putTemplate = (scope, content, version = 1) =>
  sql(
    `INSERT INTO "NotificationTemplate" (id, type, scope, content, version, "basedOnRevision", "updatedAt", "updatedByLogin") VALUES ('qa-tpl-${scope}', 'memberPending', '${scope}', '${content}'::jsonb, ${version}, 1, now(), '${OWNER}')`,
  );
const putVersion = (scope, version, content, action = 'save') =>
  sql(
    `INSERT INTO "NotificationTemplateVersion" (id, type, scope, version, content, "basedOnRevision", action, "authorLogin") VALUES ('qa-ver-${scope}-${version}', 'memberPending', '${scope}', ${version}, '${content}'::jsonb, 1, '${action}', '${OWNER}')`,
  );
/** Clicks a button of the dialog on top (a confirmation opened from another dialog is the last one in the page). */
async function clickInTopDialog(label) {
  const handle = await page.waitForFunction(
    (wanted) => {
      const dialogs = [...document.querySelectorAll('[role="dialog"]')];
      return [...(dialogs.at(-1)?.querySelectorAll('button') ?? [])].find(
        (el) => el.textContent?.trim().startsWith(wanted) && !el.disabled,
      );
    },
    { timeout: 7000 },
    label,
  );
  await handle.asElement().click();
}

const SCENARIOS = [
  {
    name: 'members: approve a request',
    async run({ id }) {
      const login = `pend-${id}`;
      createPending(login);
      try {
        await goto('/members');
        await clickInRow(login, 'Approuver');
        // The request leaves the "awaiting" table: its row no longer has an Approve button.
        return await expectPage(
          (who) => {
            const row = [...document.querySelectorAll('tr')].find((el) =>
              el.innerText.includes(who),
            );
            return (
              Boolean(row) &&
              ![...row.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Approuver')
            );
          },
          login,
          'approve',
        );
      } finally {
        deleteUser(login);
      }
    },
  },
  {
    name: 'members: refuse a request',
    async run({ id }) {
      const login = `pend-${id}`;
      createPending(login);
      try {
        await goto('/members');
        await clickInRow(login, 'Refuser');
        await page.waitForSelector(dialog);
        await click('Refuser définitivement', dialog);
        return await expectPage((who) => !document.body.innerText.includes(who), login, 'refuse');
      } finally {
        deleteUser(login);
      }
    },
  },
  {
    name: 'members: remove a member',
    async run({ id }) {
      const login = `mem-${id}`;
      createMember(login);
      try {
        await goto('/members');
        await clickInRow(login, 'Retirer du BDE');
        await page.waitForSelector(dialog);
        await click('Retirer définitivement', dialog);
        return await expectPage(
          (who) => !document.body.innerText.includes(who) || location.search.includes('removed='),
          login,
          'remove-member',
        );
      } finally {
        deleteUser(login);
      }
    },
  },
  {
    name: 'members: change a role',
    async run({ id }) {
      const login = `mem-${id}`;
      const other = `Autre ${id}`;
      createMember(login);
      createRole(other);
      try {
        await goto('/members');
        const rowSelect = ([who]) => {
          const row = [...document.querySelectorAll('tr')].find((el) => el.innerText.includes(who));
          return row?.querySelector('select');
        };
        await page.waitForFunction(
          ([who]) =>
            Boolean(
              [...document.querySelectorAll('tr')]
                .find((el) => el.innerText.includes(who))
                ?.querySelector('select'),
            ),
          {},
          [login],
        );
        const select = await page.evaluateHandle(rowSelect, [login]);
        const roleId = `r-${other.replace(/\W+/g, '-')}`;
        await select.asElement().select(roleId);
        await page.waitForSelector(dialog);
        await click('Changer le rôle', dialog);
        // The menu shows the new role, then the same page loaded again must say the same.
        const first = await expectPage(
          ([who, wanted]) => {
            const row = [...document.querySelectorAll('tr')].find((el) =>
              el.innerText.includes(who),
            );
            const select = row?.querySelector('select');
            return select?.selectedOptions[0]?.textContent === wanted;
          },
          [login, other],
          'change-role',
        );
        return first;
      } finally {
        deleteUser(login);
        deleteRole(other);
      }
    },
  },
  {
    name: 'roles: make a role the default',
    async run({ id }) {
      const name = `Defaut ${id}`;
      const original = defaultRole();
      createRole(name);
      try {
        await goto('/roles');
        await clickInRow(name, 'Définir par défaut');
        return await expectPage(
          (wanted) => {
            const row = [...document.querySelectorAll('tr')].find((el) =>
              el.innerText.includes(wanted),
            );
            return Boolean(row) && row.innerText.includes('Par défaut');
          },
          name,
          'default-role',
        );
      } finally {
        setDefaultRoleByName(original);
        deleteRole(name);
      }
    },
  },
  {
    name: 'roles: delete a role',
    async run({ id }) {
      const name = `Supprime ${id}`;
      createRole(name);
      try {
        await goto('/roles');
        await clickInRow(name, 'Supprimer');
        await page.waitForSelector(dialog);
        await click('Supprimer définitivement', dialog);
        return await expectPage(
          (wanted) => !document.body.innerText.includes(wanted),
          name,
          'delete-role',
        );
      } finally {
        deleteRole(name);
      }
    },
  },
  {
    name: 'roles: create a role (the form leaves the page)',
    async run({ id }) {
      const name = `Cree ${id}`;
      try {
        await goto('/roles/new');
        await page.type('#name', name);
        await click('Créer le rôle');
        return await expectPage(
          (wanted) =>
            location.pathname.endsWith('/roles') && document.body.innerText.includes(wanted),
          name,
          'create-role',
        );
      } finally {
        deleteRole(name);
      }
    },
  },
  {
    name: 'roles: edit a role (the form leaves the page)',
    async run({ id }) {
      const name = `Edite ${id}`;
      const renamed = `Renomme ${id}`;
      createRole(name);
      try {
        await goto('/roles');
        await clickInRow(name, 'Modifier');
        await page.waitForSelector('#name');
        await page.$eval('#name', (el) => (el.value = ''));
        await page.type('#name', renamed);
        await click('Enregistrer');
        return await expectPage(
          (wanted) =>
            location.pathname.endsWith('/roles') && document.body.innerText.includes(wanted),
          renamed,
          'edit-role',
        );
      } finally {
        deleteRole(name);
        deleteRole(renamed);
      }
    },
  },
  {
    name: 'settings: save the identity (the menu follows)',
    async run({ id }) {
      const name = `BDE ${id}`;
      await goto('/settings');
      const original = await page.$eval('#setup-name', (el) => el.value);
      try {
        await page.$eval('#setup-name', (el) => (el.value = ''));
        await page.type('#setup-name', name);
        const save = await page.evaluateHandle(() =>
          document
            .querySelector('#setup-name')
            .closest('form')
            .querySelector('button[type="submit"]'),
        );
        await save.asElement().click();
        return await expectPage(
          // the name of the BDE is the hidden text of the logo link at the head of the rail (the rail itself prints initials)
          (wanted) =>
            [...document.querySelectorAll('aside a')].some(
              (a) => a.querySelector('.sr-only')?.textContent === wanted,
            ),
          name,
          'identity',
        );
      } finally {
        await goto('/settings');
        await page.$eval('#setup-name', (el) => (el.value = ''));
        await page.type('#setup-name', original);
        const save = await page.evaluateHandle(() =>
          document
            .querySelector('#setup-name')
            .closest('form')
            .querySelector('button[type="submit"]'),
        );
        await save.asElement().click();
        await sleep(1500);
      }
    },
  },
  {
    name: 'settings: add then remove an owner',
    async run({ id }) {
      const login = process.env.OWNER_CANDIDATE ?? `own${id}`.slice(0, 20);
      await goto('/settings');
      try {
        await page.type('#settings-owner-login', login);
        await click('Ajouter', 'section[aria-labelledby="settings-owners"]');
        await page.waitForSelector(dialog);
        await click('Ajouter', dialog);
        const added = await expectPage(
          (who) => Boolean(document.querySelector(`button[aria-label="Retirer ${who}"]`)),
          login,
          'owner-add',
        );
        if (added !== 'ok') return added;
        // The dialog of the addition may still be closing: wait for it before opening the next one.
        await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
        await page.click(`button[aria-label="Retirer ${login}"]`);
        await page.waitForSelector(dialog);
        await click('Retirer', dialog);
        return await expectPage(
          (who) => !document.querySelector(`button[aria-label="Retirer ${who}"]`),
          login,
          'owner-remove',
        );
      } finally {
        sql(
          `UPDATE "PlatformSettings" SET config = jsonb_set(config, '{auth,owners}', (SELECT jsonb_agg(o) FROM jsonb_array_elements(config->'auth'->'owners') o WHERE o <> to_jsonb('${login}'::text))) WHERE id = 'platform'`,
        );
        sql(
          `UPDATE "User" SET status = 'MEMBER', "roleId" = (SELECT id FROM "Role" WHERE "isDefault") WHERE login = '${login}' AND status = 'OWNER'`,
        );
        deleteUser(login);
      }
    },
  },
  {
    name: 'settings: upload a logo, then go back to the default one',
    async run() {
      await goto('/settings');
      const input = await page.waitForSelector('#settings-logo-file');
      await input.uploadFile(logoFile);
      await click('Enregistrer le logo', 'section[aria-labelledby="settings-logo"]');
      const uploaded = await expectPage(
        () =>
          [...document.querySelectorAll('aside img')].some((img) => img.src.includes('/api/logo')),
        undefined,
        'logo-upload',
      );
      await click('Revenir au logo par défaut', 'section[aria-labelledby="settings-logo"]');
      await page.waitForSelector(dialog);
      await click('Revenir au logo par défaut', dialog);
      const removed = await expectPage(
        () =>
          ![...document.querySelectorAll('aside img')].some((img) => img.src.includes('/api/logo')),
        undefined,
        'logo-remove',
      );
      return uploaded === 'ok' ? removed : uploaded;
    },
  },
  {
    name: 'settings: turn the events module off and on (the menu follows)',
    async run() {
      await goto('/settings');
      const events = () =>
        page.$eval(
          '[role="switch"][aria-labelledby="setup-events-title"]',
          (el) => el.ariaChecked === 'true',
        );
      const wasOn = await events();
      const toggle = async () => {
        const handle = await page.evaluateHandle(() =>
          document.querySelector('[role="switch"][aria-labelledby="setup-events-title"]'),
        );
        await handle.asElement().click();
        const save = await page.evaluateHandle(() =>
          document
            .querySelector('[role="switch"][aria-labelledby="setup-events-title"]')
            .closest('form')
            .querySelector('button[type="submit"]'),
        );
        await save.asElement().click();
      };
      // (the predicates run in the page: each carries what it needs)
      const withEntry = () =>
        [...document.querySelectorAll('aside a')].some((a) =>
          a.getAttribute('href')?.endsWith('/events'),
        );
      const withoutEntry = () =>
        ![...document.querySelectorAll('aside a')].some((a) =>
          a.getAttribute('href')?.endsWith('/events'),
        );
      await toggle();
      const off = await expectPage(wasOn ? withoutEntry : withEntry, undefined, 'modules-first');
      await goto('/settings');
      await toggle();
      const on = await expectPage(wasOn ? withEntry : withoutEntry, undefined, 'modules-back');
      return off === 'ok' ? on : off;
    },
  },
  {
    name: 'settings: turn the notice of new versions off and on',
    async run() {
      // The platform is started with RELEASES_API_URL pointing at the stand-in, which publishes a version newer than
      // any real one (MOCK_LATEST_RELEASE): the notice is there until an owner turns it off.
      await goto('/settings');
      const banner = () => Boolean(document.querySelector('#update-banner'));
      const noBanner = () => !document.querySelector('#update-banner');
      const first = await expectPage(banner, undefined, 'updates-shown');
      if (first !== 'ok') return first;
      const toggleAndSave = async () => {
        const handle = await page.evaluateHandle(() =>
          document.querySelector('[role="switch"][aria-labelledby="settings-updates-title"]'),
        );
        await handle.asElement().click();
        const save = await page.evaluateHandle(() =>
          document
            .querySelector('[role="switch"][aria-labelledby="settings-updates-title"]')
            .closest('form')
            .querySelector('button[type="submit"]'),
        );
        await save.asElement().click();
      };
      try {
        await toggleAndSave();
        const off = await expectPage(noBanner, undefined, 'updates-off');
        if (off !== 'ok') return off;
        // the dashboard follows (the notice is asked after the page is shown: give it the time it needs to appear)
        await goto('/dashboard');
        await sleep(2500);
        if (!(await page.evaluate(noBanner))) return 'FAILED';
        await goto('/settings');
        await toggleAndSave();
        return await expectPage(banner, undefined, 'updates-on');
      } finally {
        sql(
          `UPDATE "PlatformSettings" SET config = jsonb_set(config, '{updates,check}', 'true'::jsonb, true) WHERE id = 'platform'`,
        );
      }
    },
  },
  {
    name: 'profile: regenerate the personal calendar link',
    async run() {
      await goto('/profile');
      const link = () => page.$eval('input[value*="/api/calendar/"]', (el) => el.value);
      const before = await link();
      await click('Générer un nouveau lien');
      await page.waitForSelector(dialog);
      await clickAndLoad('Générer un nouveau lien', dialog);
      return await expectPage(
        (old) => {
          const field = document.querySelector('input[value*="/api/calendar/"]');
          return Boolean(field) && field.value !== old;
        },
        before,
        'profile-token',
      );
    },
  },
  {
    name: 'shared calendar: turn the BDE link on, regenerate it, turn it off',
    async run() {
      sql(`UPDATE "BdeCalendarFeed" SET token = NULL WHERE id = 'bde'`);
      await goto('/events/shared-calendar');
      const active = () => Boolean(document.querySelector('input[value*="/api/calendar/bde/"]'));
      await clickAndLoad('Activer le lien du BDE');
      const enabled = await expectPage(active, undefined, 'bde-enable');
      if (enabled !== 'ok') return enabled;
      const before = await page.$eval('input[value*="/api/calendar/bde/"]', (el) => el.value);
      await click('Générer un nouveau lien');
      await page.waitForSelector(dialog);
      await clickAndLoad('Générer un nouveau lien', dialog);
      const regenerated = await expectPage(
        (old) =>
          document.querySelector('input[value*="/api/calendar/bde/"]')?.value !== old &&
          Boolean(document.querySelector('input[value*="/api/calendar/bde/"]')),
        before,
        'bde-regenerate',
      );
      await click('Désactiver le lien');
      await page.waitForSelector(dialog);
      await clickAndLoad('Désactiver le lien', dialog);
      const disabled = await expectPage(
        () => !document.querySelector('input[value*="/api/calendar/bde/"]'),
        undefined,
        'bde-disable',
      );
      return [enabled, regenerated, disabled].find((state) => state !== 'ok') ?? 'ok';
    },
  },
  {
    name: 'intra: send a refused request again (the event page then says that it waits)',
    async run({ id }) {
      const eventId = `e2e-intra-${id}`;
      try {
        await setIntraPublication(true);
        createIntraEvent(eventId, `Intra ${id}`);
        sql(
          `INSERT INTO "IntraRequest" (id, "eventId", status, "contentHash", "refusalComment", "requestedAt", "requestedByLogin", "answeredAt", "answeredByLogin", "updatedAt") VALUES ('e2e-ir-${id}', '${eventId}', 'REFUSED', repeat('0', 64), 'Salle indisponible ce jour-là.', now(), '${OWNER}', now(), 'staff-e2e', now())`,
        );
        await goto(`/events/${eventId}`);
        await page.waitForFunction(() => document.body.innerText.includes('Salle indisponible'));
        await clickAndLoad('Renvoyer la demande');
        const shown = await expectPage(
          () =>
            document.body.innerText.includes('Demande envoyée au staff') &&
            !document.body.innerText.includes('Salle indisponible'),
          undefined,
          'intra-send-again',
        );
        const status = sql(`SELECT status FROM "IntraRequest" WHERE "eventId" = '${eventId}'`);
        if (shown === 'ok' && status !== 'PENDING') {
          console.error(`  the request is "${status}" in the database, not PENDING`);
          return 'FAILED';
        }
        return shown;
      } finally {
        sql(`DELETE FROM "Event" WHERE id = '${eventId}'`);
        await setIntraPublication(false);
      }
    },
  },
  {
    name: 'intra: answer "published" (the list of requests then holds it as handled)',
    async run({ id }) {
      const eventId = `e2e-intra-publish-${id}`;
      const title = `Publie ${id}`;
      try {
        await setIntraPublication(true);
        createIntraEvent(eventId, title, true);
        await goto(`/events/intra/${eventId}`);
        await click("Publié sur l'intra");
        await page.waitForSelector(dialog);
        await clickAndLoad('Oui, publié', dialog);
        const shown = await expectPage(
          (name) =>
            location.pathname === '/fr/events/intra' && document.body.innerText.includes(name),
          title,
          'intra-publish',
        );
        const status = sql(`SELECT status FROM "IntraRequest" WHERE "eventId" = '${eventId}'`);
        return shown === 'ok' && status !== 'PUBLISHED' ? 'FAILED' : shown;
      } finally {
        sql(`DELETE FROM "Event" WHERE id = '${eventId}'`);
        await setIntraPublication(false);
      }
    },
  },
  {
    name: 'intra: answer "refused" with a reason (the list of requests then says why)',
    async run({ id }) {
      const eventId = `e2e-intra-refuse-${id}`;
      try {
        await setIntraPublication(true);
        createIntraEvent(eventId, `Refuse ${id}`, true);
        await goto(`/events/intra/${eventId}`);
        await click('Refuser');
        await page.waitForSelector(dialog);
        await page.type(`${dialog} textarea, ${dialog} input[type="text"]`, 'Salle indisponible');
        await clickAndLoad('Refuser la demande', dialog);
        const shown = await expectPage(
          () =>
            location.pathname === '/fr/events/intra' &&
            document.body.innerText.includes('Salle indisponible'),
          undefined,
          'intra-refuse',
        );
        const status = sql(`SELECT status FROM "IntraRequest" WHERE "eventId" = '${eventId}'`);
        return shown === 'ok' && status !== 'REFUSED' ? 'FAILED' : shown;
      } finally {
        sql(`DELETE FROM "Event" WHERE id = '${eventId}'`);
        await setIntraPublication(false);
      }
    },
  },
  {
    name: 'intra: answer "intra updated" (the request is no longer to update)',
    async run({ id }) {
      const eventId = `e2e-intra-updated-${id}`;
      try {
        await setIntraPublication(true);
        createIntraEvent(eventId, `Maj ${id}`, true);
        // published through the page, as the staff does: the copy of what the intra holds is then the event as it is
        await goto(`/events/intra/${eventId}`);
        await click("Publié sur l'intra");
        await page.waitForSelector(dialog);
        await clickAndLoad('Oui, publié', dialog);
        // the event changes afterwards, which is what puts a request back to "to update"
        sql(
          `UPDATE "Event" SET title = title || ' modifié', "updatedAt" = now() WHERE id = '${eventId}'; UPDATE "IntraRequest" SET status = 'OUTDATED' WHERE "eventId" = '${eventId}'`,
        );
        await goto(`/events/intra/${eventId}`);
        await click('Intra mis à jour');
        await page.waitForSelector(dialog);
        await clickAndLoad("Oui, l'intra est à jour", dialog);
        const shown = await expectPage(
          () => location.pathname === '/fr/events/intra',
          undefined,
          'intra-updated',
        );
        const status = sql(`SELECT status FROM "IntraRequest" WHERE "eventId" = '${eventId}'`);
        return shown === 'ok' && status !== 'PUBLISHED' ? 'FAILED' : shown;
      } finally {
        sql(`DELETE FROM "Event" WHERE id = '${eventId}'`);
        await setIntraPublication(false);
      }
    },
  },
  {
    name: 'notifications: save a template (the page keeps what was saved)',
    async run({ id }) {
      const words = `Bienvenue ${id}`;
      clearTemplates();
      try {
        await goto('/notifications?type=memberPending');
        await page.waitForSelector('#memberPending-all-eyebrow');
        // the whole text is selected by the field itself (a triple click does not select it everywhere)
        await page.$eval('#memberPending-all-eyebrow', (el) => {
          el.focus();
          el.select();
        });
        await page.type('#memberPending-all-eyebrow', words);
        await click('Enregistrer', 'section[aria-labelledby="template-heading"]');
        const saved = await expectPage(
          () => !document.body.innerText.includes('Modifications non enregistrées'),
          undefined,
          'template-save',
        );
        if (saved !== 'ok') return saved;
        // what is shown after loading the page again is what was written to the database
        await goto('/notifications?type=memberPending');
        const kept = await page.$eval('#memberPending-all-eyebrow', (el) => el.value);
        const written = sql(
          `SELECT count(*) FROM "NotificationTemplate" WHERE type = 'memberPending' AND scope = 'all'`,
        );
        if (kept !== words || written !== '1') {
          console.error(
            `  template saved? the page shows "${kept}" (wanted "${words}"), ${written} row(s)`,
          );
          return 'FAILED';
        }
        return 'ok';
      } finally {
        clearTemplates();
      }
    },
  },
  {
    name: 'notifications: customise a channel, then go back to the common template (the page loads again)',
    async run() {
      clearTemplates();
      try {
        await goto('/notifications?type=memberPending&scope=slack');
        await click('Personnaliser ce canal', 'section[aria-labelledby="template-heading"]');
        await page.waitForSelector(dialog);
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle0' }),
          clickInTopDialog('Personnaliser ce canal'),
        ]);
        const customised = await expectPage(
          () =>
            document.body.innerText.includes('Ce canal a maintenant son propre modèle.') &&
            document.body.innerText.includes('Slack a son propre modèle'),
          undefined,
          'template-customise',
        );
        if (customised !== 'ok') return customised;
        await click('Revenir au modèle commun', 'section[aria-labelledby="template-heading"]');
        await page.waitForSelector(dialog);
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle0' }),
          clickInTopDialog('Revenir au modèle commun'),
        ]);
        return await expectPage(
          () => document.body.innerText.includes('Slack suit le modèle commun'),
          undefined,
          'template-back-to-common',
        );
      } finally {
        clearTemplates();
      }
    },
  },
  {
    name: 'notifications: put every channel back as the platform writes it',
    async run() {
      clearTemplates();
      putTemplate('all', '{"eyebrow":"Hello"}');
      putTemplate('discord', '{"footer":"Merci"}');
      try {
        await goto('/notifications?type=memberPending');
        await click('Plus', 'section[aria-labelledby="template-heading"]');
        await click('Tout remettre comme la plateforme');
        await page.waitForSelector(dialog);
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle0' }),
          clickInTopDialog('Revenir au défaut'),
        ]);
        const shown = await expectPage(
          () => document.body.innerText.includes('Tous les canaux sont revenus'),
          undefined,
          'template-reset-all',
        );
        const left = sql(`SELECT count(*) FROM "NotificationTemplate"`);
        return shown === 'ok' && left === '0' ? 'ok' : shown === 'ok' ? 'FAILED' : shown;
      } finally {
        clearTemplates();
      }
    },
  },
  {
    name: 'notifications: restore an older version from the history',
    async run() {
      clearTemplates();
      putTemplate('all', '{"eyebrow":"Deux"}', 2);
      putVersion('all', 1, '{"eyebrow":"Un"}');
      putVersion('all', 2, '{"eyebrow":"Deux"}');
      try {
        await goto('/notifications?type=memberPending');
        await click('Plus', 'section[aria-labelledby="template-heading"]');
        await click('Historique des versions');
        await page.waitForSelector(dialog);
        await click('Restaurer', dialog);
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle0' }),
          clickInTopDialog('Restaurer'),
        ]);
        const shown = await expectPage(
          () =>
            document.body.innerText.includes('Version restaurée.') &&
            document.querySelector('#memberPending-all-eyebrow')?.value === 'Un',
          undefined,
          'template-restore',
        );
        const now = sql(
          `SELECT version || ':' || (content->>'eyebrow') FROM "NotificationTemplate" WHERE scope = 'all'`,
        );
        return shown === 'ok' && now === '3:Un' ? 'ok' : shown === 'ok' ? 'FAILED' : shown;
      } finally {
        clearTemplates();
      }
    },
  },
  {
    name: 'notifications: add then remove somebody to mention (the list follows)',
    async run({ id }) {
      const name = `Equipe ${id}`;
      clearTemplates();
      putTemplate('discord', '{}');
      try {
        await goto('/notifications?type=memberPending&scope=discord');
        await click('Mentionner', 'section[aria-labelledby="template-heading"]');
        await click('Gérer les personnes et rôles');
        await page.waitForSelector(dialog);
        await page.type('#mention-label', name);
        await page.type('#mention-id', '123456789012345678');
        await click('Ajouter', dialog);
        const added = await expectPage(
          (who) => Boolean(document.querySelector(`button[aria-label="Retirer ${who}"]`)),
          name,
          'mention-add',
        );
        if (added !== 'ok') return added;
        await page.click(`button[aria-label="Retirer ${name}"]`);
        return await expectPage(
          (who) => !document.querySelector(`button[aria-label="Retirer ${who}"]`),
          name,
          'mention-remove',
        );
      } finally {
        clearTemplates();
      }
    },
  },
  {
    name: 'language: switch to English and back',
    async run() {
      await goto('/members');
      await chooseLanguage('English');
      const english = await expectPage(
        () => location.pathname === '/en/members' && document.body.innerText.includes('Member'),
        undefined,
        'language-en',
      );
      await chooseLanguage('Français');
      const french = await expectPage(
        () => location.pathname === '/fr/members',
        undefined,
        'language-fr',
      );
      return english === 'ok' ? french : english;
    },
  },
];

// ---------------------------------------------------------------------------------------------------------------------

const results = [];
for (const scenario of SCENARIOS.filter((s) =>
  ONLY.split('|').some((part) => s.name.includes(part)),
)) {
  const counts = { ok: 0, STALE: 0, FAILED: 0, ERROR: 0 };
  const notes = [];
  for (let round = 1; round <= ROUNDS; round++) {
    let state;
    try {
      state = await scenario.run({ id: suffix() });
    } catch (error) {
      state = 'ERROR';
      // The first line of the message and where it was thrown from: "Timed out after waiting 15000ms" alone does not say what waited.
      const where = (error.stack ?? '').split('\n').find((line) => /actions\.mjs:\d+/.test(line));
      notes.push(`${error.message.split('\n')[0]}${where ? `  ${where.trim()}` : ''}`);
      await signIn().catch(() => undefined);
    }
    counts[state] += 1;
  }
  results.push({ name: scenario.name, counts, notes });
  const bad = counts.STALE + counts.FAILED + counts.ERROR;
  console.log(
    `${bad === 0 ? '✓' : '✗'} ${scenario.name}: ${counts.ok}/${ROUNDS} fine` +
      (bad ? ` (STALE ${counts.STALE}, FAILED ${counts.FAILED}, ERROR ${counts.ERROR})` : ''),
  );
  for (const note of new Set(notes)) console.log(`    ${note}`);
}

if (pageErrors.length > 0)
  console.log(`(page errors: ${[...new Set(pageErrors)].slice(0, 3).join(' | ')})`);
await browser.close();

const total = results.length * ROUNDS;
const stale = results.reduce((sum, r) => sum + r.counts.STALE, 0);
const broken = results.reduce((sum, r) => sum + r.counts.FAILED + r.counts.ERROR, 0);
console.log(`\n${total} runs: ${stale} stale, ${broken} failed.`);
if (!MEASURE && stale + broken > 0) process.exit(1);
if (!MEASURE) console.log('All good.');
