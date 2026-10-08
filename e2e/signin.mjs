// End-to-end test of the sign-in with 42, in a real browser, on a platform the installer has just installed
// (e2e/install.mjs, owner "alice", who has an account) with e2e/mock-fortytwo.mjs standing in for 42.
//
//   node e2e/signin.mjs <address of the platform> <address of the stand-in 42> [other address of the platform]
//   CHROME_PATH=...  SHOTS=<folder>
//
// The platform runs in its production image: the server listens on 0.0.0.0, and Next.js then builds every
// `request.url` from that. The sign-in used to send 42 `http://0.0.0.0:3000/api/auth/callback/42-school` when
// the code was exchanged, so 42 refused it (invalid_grant) and the visitor landed on `http://0.0.0.0:3000/...`.
// The stand-in refuses a code like the real 42: only for the redirect_uri the authorization was asked with.
//
// <address of the platform> must be the address that was registered (the one the installer proposed, or
// `localhost`: this computer is always written that way).
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const [platform, fortyTwo, other] = process.argv.slice(2);
if (!platform || !fortyTwo) {
  console.error(
    'usage: node e2e/signin.mjs <platform address> <stand-in 42 address> [other address]',
  );
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

const registered = new URL(platform).origin;
const CALLBACK = '/api/auth/callback/42-school';

const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
let count = 0;
const step = (message) => console.log(`✓ ${message}`);
const fail = (message) => {
  throw new Error(message);
};

/** What the stand-in saw: one entry per authorization asked, with the redirect_uri of each leg. */
const signIns = async () => (await fetch(`${fortyTwo}/__sign-ins`)).json();

/** Opens the login page at `address` in a fresh browser (no cookies), clicks "Se connecter avec 42". */
async function signInFrom(address) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'fr' });
  page.setDefaultTimeout(20000);
  const visited = [];
  page.on('response', (response) => {
    if (response.request().isNavigationRequest()) {
      visited.push(response.url());
      const location = response.headers().location;
      if (location) visited.push(location);
    }
  });

  await page.goto(`${address}/fr`, { waitUntil: 'networkidle0' });
  const button = await page.evaluateHandle(() =>
    [...document.querySelectorAll('button')].find((el) => el.textContent?.includes('Se connecter')),
  );
  if (!button.asElement()) fail(`no sign-in button on ${address}/fr`);
  await button.asElement().click();
  // The stand-in sends the browser back to the callback; the platform then answers (dashboard or error page).
  await page
    .waitForFunction(() => /\/fr\/(dashboard|auth-error)/.test(location.pathname), {
      timeout: 20000,
    })
    .catch(() => undefined); // judged by the caller, from where the visitor ended up
  await page.waitForNetworkIdle().catch(() => undefined);
  if (shots) {
    await page.screenshot({ path: join(shots, `${String(++count).padStart(2, '0')}-signin.png`) });
  }
  const result = {
    url: page.url(),
    visited,
    text: await page.evaluate(() => document.body.innerText),
  };
  await context.close();
  return result;
}

try {
  // 1. From the registered address: the whole sign-in works, and 42 is given the same address both times.
  const before = (await signIns()).length;
  const done = await signInFrom(registered);
  const [first] = (await signIns()).slice(before);
  if (!first) fail('the stand-in never saw an authorization request');
  const expected = `${registered}${CALLBACK}`;
  if (first.authorizeRedirectUri !== expected) {
    fail(`authorization redirect_uri is ${first.authorizeRedirectUri}, expected ${expected}`);
  }
  if (first.tokenRedirectUri !== expected) {
    fail(
      `token redirect_uri is ${first.tokenRedirectUri}, expected ${expected} (invalid_grant at the real 42)`,
    );
  }
  if (done.visited.some((address) => address.includes('0.0.0.0'))) {
    fail(`the visitor was sent to 0.0.0.0: ${done.visited.join(' → ')}`);
  }
  if (!new URL(done.url).pathname.endsWith('/fr/dashboard')) {
    fail(`the sign-in did not end on the dashboard: ${done.url}\n${done.text.slice(0, 400)}`);
  }
  step(
    `sign-in from ${registered}: redirect_uri is ${expected} at both legs, ends on the dashboard`,
  );

  // 2. From another name of the same platform (and from 0.0.0.0, which browsers accept and the first try of the
  // report used): 42 is still given the registered address and the visitor is never sent to 0.0.0.0. The
  // cookies of the sign-in belong to the address it started from, so it cannot succeed from here, which is
  // exactly what the installer warns about.
  for (const address of [other, `http://0.0.0.0:${new URL(platform).port || 80}`].filter(Boolean)) {
    const seen = (await signIns()).length;
    let result;
    try {
      result = await signInFrom(address);
    } catch (error) {
      // Windows does not let a browser connect to 0.0.0.0 at all (Linux and macOS do).
      if (!String(error.message).includes('ERR_ADDRESS_INVALID')) throw error;
      console.log(`- ${address}: this system cannot open it, skipped`);
      continue;
    }
    const [entry] = (await signIns()).slice(seen);
    if (!entry) fail(`from ${address}: the stand-in never saw an authorization request`);
    if (entry.authorizeRedirectUri !== expected) {
      fail(
        `from ${address}: authorization redirect_uri is ${entry.authorizeRedirectUri}, expected ${expected}`,
      );
    }
    const trail = result.visited;
    if (trail.some((visited) => visited.includes('0.0.0.0') && !visited.startsWith(address))) {
      fail(`from ${address}: the visitor was sent to 0.0.0.0: ${trail.join(' → ')}`);
    }
    step(`sign-in started from ${address}: 42 is still given ${expected}`);
  }

  console.log('\nAll good.');
} catch (error) {
  console.error(`\n✗ ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
