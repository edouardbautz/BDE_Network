// End-to-end test of the installer, in a real browser (puppeteer-core drives the Chrome or Edge that is already
// installed: nothing is downloaded).
//
//   node e2e/install.mjs <platform address> <setup code>
//   CHROME_PATH=...        which browser (default: the usual places)
//   SHOTS=<folder>         where to save a screenshot of every step (optional)
//
// The platform must be a fresh one, started with FORTYTWO_API_URL pointing at e2e/mock-fortytwo.mjs.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { CLIENT_ID, CLIENT_SECRET } from './mock-fortytwo.mjs';

const [base, code] = process.argv.slice(2);
if (!base || !code) {
  console.error('usage: node e2e/install.mjs <address> <setup code>');
  process.exit(2);
}

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
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

const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 1000 });
await page.setExtraHTTPHeaders({ 'Accept-Language': 'fr' });
page.setDefaultTimeout(20000);

let count = 0;
const shot = async (name) => {
  if (shots)
    await page.screenshot({ path: join(shots, `${String(++count).padStart(2, '0')}-${name}.png`) });
};
const step = (message) => console.log(`✓ ${message}`);
const fail = (message) => {
  throw new Error(message);
};
const text = () => page.evaluate(() => document.body.innerText);
const clickButton = async (label) => {
  const handle = await page.evaluateHandle(
    (wanted) =>
      [...document.querySelectorAll('button, a')].find((el) =>
        el.textContent?.trim().startsWith(wanted),
      ),
    label,
  );
  const element = handle.asElement();
  if (!element) fail(`no button "${label}"`);
  await element.click();
};
/** Empties a field the way a person does: select everything, delete. */
const clear = async (selector) => {
  await page.focus(selector);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
};
const waitText = (needle) =>
  page.waitForFunction((value) => document.body.innerText.includes(value), {}, needle);

try {
  // Before the code, nothing of the platform shows, whatever address is asked.
  await page.goto(`${base}/fr`, { waitUntil: 'networkidle0' });
  if (!page.url().endsWith('/fr/setup')) fail(`/fr did not go to the installer: ${page.url()}`);
  await page.waitForSelector('#setup-code');
  await shot('code');
  step('visitors are sent to the installer, which asks for the code');

  await page.type('#setup-code', 'AAAA-AAAA');
  await clickButton('Continuer');
  await waitText("Ce code n'est pas le bon");
  step('a wrong code is refused');

  await page.type('#setup-code', code);
  await clickButton('Continuer');
  await page.waitForSelector('#setup-name');
  await shot('identity');
  step('the right code opens the installer');

  // 1. the BDE
  await page.type('#setup-name', 'BDE Test');
  await clickButton('Continuer');
  await page.waitForSelector('#setup-address');
  step('1. identity');

  // 2. the address (the one the browser used is proposed; this computer is always written localhost)
  await shot('address');
  const proposed = await page.$eval('#setup-address', (input) => input.value);
  const browserAddress = new URL(base);
  const wanted = `${browserAddress.protocol}//${/^127\./.test(browserAddress.hostname) ? 'localhost' : browserAddress.hostname}:${browserAddress.port}`;
  if (proposed !== wanted) fail(`the address proposed is ${proposed}, expected ${wanted}`);
  // The browser is on another name than the proposed one (CI opens 127.0.0.1): the person is warned, not blocked.
  if (wanted !== browserAddress.origin) await waitText("Ce n'est pas l'adresse de ce navigateur");
  // 0.0.0.0 is where the server listens, never an address: refused, with a reason, whatever the browser is on.
  await clear('#setup-address');
  await page.type('#setup-address', `http://0.0.0.0:${browserAddress.port}`);
  await clickButton('Continuer');
  await waitText("0.0.0.0 n'est pas une adresse de site");
  await clear('#setup-address');
  await page.type('#setup-address', proposed);
  await clickButton('Continuer');
  await page.waitForSelector('#setup-uid');
  step('2. address (never 0.0.0.0, a different browser address is flagged)');

  // 3. the 42 application: a wrong pair first
  await page.type('#setup-uid', CLIENT_ID);
  await page.type('#setup-secret', 's-s4t2ud-not-the-right-secret');
  await clickButton('Vérifier avec 42');
  await waitText('42 refuse ces identifiants');
  await shot('42-refused');
  step('3. a wrong 42 secret is refused');
  await clear('#setup-secret');
  await page.type('#setup-secret', CLIENT_SECRET);
  await clickButton('Vérifier avec 42');
  await page.waitForSelector('#setup-campus-search');
  step('3. the right pair is accepted');

  // 4. campuses, from the list
  await page.type('#setup-campus-search', 'nic');
  await waitText('France');
  await shot('campuses');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#setup-main-campus')?.value === 'Nice');
  await clickButton('Continuer');
  await page.waitForSelector('#setup-login');
  step('4. campuses (searched in the list, main campus and time zone chosen)');

  // 5. owners: an unknown login first
  await page.type('#setup-login', 'nobody');
  await clickButton('Ajouter');
  await waitText("n'existe pas sur l'intra");
  await clear('#setup-login');
  await page.type('#setup-login', 'alice');
  await clickButton('Ajouter');
  await page.waitForFunction(
    () =>
      document.body.innerText.includes('alice') &&
      !document.body.innerText.includes('Aucun propriétaire'),
  );
  await shot('owners');
  await clickButton('Continuer');
  step('5. owners (an unknown login is refused, a real one added)');

  // 6. modules, 7. notifications
  await waitText('Événements');
  await clickButton('Continuer');
  await waitText('Aucune pour l');
  await shot('notifications');
  await clickButton('Continuer');
  step('6-7. modules and notifications');

  // 8. summary, then install
  await waitText('Récapitulatif');
  const summary = await text();
  for (const expected of ['BDE Test', 'Nice', 'alice', 'vérifiée par 42']) {
    if (!summary.includes(expected)) fail(`the summary lacks "${expected}"`);
  }
  if (summary.includes(CLIENT_SECRET)) fail('the summary shows the 42 secret');
  await shot('summary');
  await clickButton('Installer la plateforme');
  await waitText('Plateforme installée');
  await shot('done');
  step('8. installed (and the secret never appeared in the page)');

  // The installer is gone for good, and the platform is there.
  const gone = await page.goto(`${base}/fr/setup`, { waitUntil: 'networkidle0' });
  if (gone?.status() !== 404) fail(`/fr/setup answers ${gone?.status()} after the installation`);
  await page.goto(`${base}/fr`, { waitUntil: 'networkidle0' });
  await waitText('Se connecter avec 42');
  await shot('login');
  // The 42 application is accepted (the stand-in server says so): the login page warns of nothing.
  if ((await page.$$('[role="alert"]')).length > 0) fail('the login page shows a warning');
  const title = await page.title();
  if (!title.includes('BDE Test')) fail(`the login page does not carry the new name: "${title}"`);
  step('the installer answers 404 now, and the login page carries the name of the BDE');

  console.log('\nAll good.');
} catch (error) {
  await shot('failure').catch(() => undefined);
  console.error(`\n✗ ${error.message}`);
  console.error(`  page: ${page.url()}`);
  console.error((await text().catch(() => '')).slice(0, 800));
  process.exitCode = 1;
} finally {
  await browser.close();
}
