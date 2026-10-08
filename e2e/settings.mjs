// End-to-end test of the settings page, in a real browser, on a platform that the installer has just installed
// (e2e/install.mjs, owner "alice") with e2e/mock-fortytwo.mjs standing in for the 42 API.
//
//   AUTH_SECRET=<the session secret of the platform> node e2e/settings.mjs <address>
//   OWNER=alice MEMBER=carol    the logins of an owner account and of a plain member (both must exist)
//   CHROME_PATH=...  SHOTS=<folder>
//
// Nobody can sign in through 42 here, so the session cookies are forged with the platform's own secret, exactly as
// Auth.js writes them: the page, the actions and the database are the real ones.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { encode } from '@auth/core/jwt';
import puppeteer from 'puppeteer-core';

const [base] = process.argv.slice(2);
const secret = process.env.AUTH_SECRET;
if (!base || !secret) {
  console.error('usage: AUTH_SECRET=... node e2e/settings.mjs <address>');
  process.exit(2);
}
const OWNER = process.env.OWNER ?? 'alice';
const MEMBER = process.env.MEMBER ?? 'carol';

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
const sessionFor = async (login) => encode({ token: { login }, secret, salt: COOKIE });

const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 1400 });
await page.setExtraHTTPHeaders({ 'Accept-Language': 'fr' });
page.setDefaultTimeout(20000);

let count = 0;
const shot = async (name) => {
  if (shots)
    await page.screenshot({
      path: join(shots, `${String(++count).padStart(2, '0')}-${name}.png`),
      fullPage: true,
    });
};
const step = (message) => console.log(`✓ ${message}`);
const fail = (message) => {
  throw new Error(message);
};
const text = () => page.evaluate(() => document.body.innerText);
const waitText = (needle) =>
  page.waitForFunction((value) => document.body.innerText.includes(value), {}, needle);
const signInAs = async (login) => {
  await page.deleteCookie({ name: COOKIE, url: base });
  await page.setCookie({ name: COOKIE, value: await sessionFor(login), url: base, httpOnly: true });
};
const clickButton = async (label, within) => {
  const handle = await page.evaluateHandle(
    (wanted, scope) => {
      const root = scope
        ? (document.querySelector(scope)?.closest('form, section') ?? document)
        : document;
      return [...root.querySelectorAll('button')].find(
        (el) => el.textContent?.trim().startsWith(wanted) && !el.disabled,
      );
    },
    label,
    within,
  );
  const element = handle.asElement();
  if (!element) fail(`no enabled button "${label}"${within ? ` near ${within}` : ''}`);
  await element.click();
};
/** Clicks a save button and waits until the server has answered (a toast of an earlier save may still be there). */
const save = async (label, within) => {
  const answered = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/settings'),
  );
  await clickButton(label, within);
  await answered;
  await page.waitForNetworkIdle({ idleTime: 500 });
};
const clear = async (selector) => {
  await page.focus(selector);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
};

try {
  // A member has no settings: sent back to the dashboard, and the menu does not offer them.
  await signInAs(MEMBER);
  await page.goto(`${base}/fr/settings`, { waitUntil: 'networkidle0' });
  if (page.url().includes('/settings')) fail(`a member reached the settings page: ${page.url()}`);
  if ((await text()).includes('Paramètres')) fail('a member sees "Paramètres"');
  step('a member is sent away from the settings, and the menu does not show them');

  await signInAs(OWNER);
  await page.goto(`${base}/fr/settings`, { waitUntil: 'networkidle0' });
  await waitText('Les réglages de la plateforme');
  await shot('settings');
  const opened = await text();
  for (const expected of [
    'Paramètres',
    'Sauvegardez le volume « secrets »',
    'Votre BDE',
    'Application 42',
    'Propriétaires',
    'Notifications',
  ]) {
    if (!opened.includes(expected)) fail(`the page lacks "${expected}"`);
  }
  const command = await page.$eval('#settings-backup-command', (el) => el.value);
  if (command !== './scripts/backup.sh') fail(`the backup command is "${command}"`);
  step('an owner sees the settings, with the reminder to back up the secrets volume');

  // 1. identity
  await clear('#setup-name');
  await page.type('#setup-name', 'BDE Renommé');
  await save('Enregistrer', '#setup-name');
  await page.reload({ waitUntil: 'networkidle0' });
  const title = await page.title();
  if (!(await text()).includes('BDE Renommé')) fail('the new name is not shown after a reload');
  step(`identity saved and applied at once (title: "${title}")`);

  // 2. owners: unknown login refused, a real one added after a confirmation, then removed
  await page.type('#settings-owner-login', 'nobody');
  await clickButton('Ajouter');
  await waitText("n'existe pas sur l'intra");
  await clear('#settings-owner-login');
  await page.type('#settings-owner-login', 'bob');
  await clickButton('Ajouter');
  await waitText('Ajouter bob comme propriétaire ?');
  await shot('owner-confirm');
  await clickButton('Ajouter comme propriétaire');
  await page.waitForSelector('button[aria-label="Retirer bob"]');
  // the confirmation closes before the page is touched again (its overlay would take the click)
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  step('an owner is added after a confirmation, and appears in the list');

  if (await page.$(`button[aria-label="Retirer ${OWNER}"]`)) fail('one can remove oneself');
  if (!(await text()).includes('Vous ne pouvez pas vous retirer vous-même'))
    fail('no explanation for oneself');
  await page.click('button[aria-label="Retirer bob"]');
  await waitText('Retirer bob des propriétaires ?');
  await clickButton('Retirer', '[role="dialog"]');
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Retirer bob"]'));
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  step('an owner is removed after a confirmation; there is no way to remove oneself');

  // 3. modules
  await page.click('[role="switch"]');
  await save('Enregistrer', '[role="switch"]');
  await page.reload({ waitUntil: 'networkidle0' });
  const eventsOff = await page.$eval('[role="switch"]', (el) => el.getAttribute('aria-checked'));
  if (eventsOff !== 'false') fail('the events module is still on');
  if ((await text()).includes('Événements\n') && (await page.$('a[href$="/events"]')))
    fail('the menu still offers events');
  step('the events module is turned off and the menu follows');
  await page.click('[role="switch"]');
  await save('Enregistrer', '[role="switch"]');

  // 4. the 42 application: a wrong secret is refused, the real one saved without leaving the page
  await clear('#setup-secret');
  await page.type('#setup-secret', 's-s4t2ud-not-the-right-secret');
  await clickButton('Vérifier et enregistrer');
  await waitText('42 refuse ces identifiants');
  await shot('oauth-refused');
  step('a wrong 42 secret is refused before it is saved (it would lock everybody out)');

  // 5. the English page
  await page.goto(`${base}/en/settings`, { waitUntil: 'networkidle0' });
  await waitText('Back up the "secrets" volume');
  await shot('settings-en');
  step('the page exists in English');

  console.log('\nAll good.');
} catch (error) {
  await shot('failure').catch(() => undefined);
  console.error(`\n✗ ${error.message}`);
  console.error(`  page: ${page.url()}`);
  console.error((await text().catch(() => '')).slice(0, 1200));
  process.exitCode = 1;
} finally {
  await browser.close();
}
