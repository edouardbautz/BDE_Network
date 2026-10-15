// End-to-end test of the pages' hydration on a slow connection, in a real browser, against the real image.
//
//   AUTH_SECRET=<the session secret of the platform> node e2e/hydration.mjs <address>
//   OWNER=alice       the login of an owner account (it must exist)
//   EVENT=e2e-weekly  the id of an event
//   LOADS=40          how many times each page is loaded
//   PAGES=/en/events,/en/dashboard   the pages to load (by default the events, an event, the dashboard, the members)
//   KBPS=1500 LATENCY_MS=20   the speed of the connection
//   CHROME_PATH=...   SHOTS=<folder>
//
// Why it exists: with Next.js 15.5 (a React from August 2025), a page whose scripts are already in the browser's cache
// and whose HTML arrives in several pieces was hydrated while the end of its HTML was still on its way, and about one
// load in seven failed with "Minified React error #418" (the HTML does not match), followed by a dozen
// "Cannot read properties of null (reading 'parentNode')": React threw the server's HTML away and drew the page again
// (visitors saw a flash and a page that came late; the test only saw errors). It does not happen on a fast local
// connection, which is why it came and went in the other scripts, one load in many. Next.js 16 carries the React
// that fixes it (the hydration cursor that was not rewound, facebook/react #37584, fixed in 19.3): 0 errors in 100
// loads under the same conditions. This script plays those conditions, so that a framework that brings the bug back is
// found here and not by a visitor on a phone. See "A hydration error on a slow connection" in docs/architecture.md.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { encode } from '@auth/core/jwt';
import puppeteer from 'puppeteer-core';
import { watchPage } from './watch-page.mjs';

const [base] = process.argv.slice(2);
const secret = process.env.AUTH_SECRET;
if (!base || !secret) {
  console.error('usage: AUTH_SECRET=... node e2e/hydration.mjs <address>');
  process.exit(2);
}
const OWNER = process.env.OWNER ?? 'alice';
const EVENT = process.env.EVENT ?? 'e2e-weekly';
const LOADS = Number(process.env.LOADS ?? 40);
const KBPS = Number(process.env.KBPS ?? 1500);
const LATENCY_MS = Number(process.env.LATENCY_MS ?? 20);

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

const PAGES = (
  process.env.PAGES ?? `/en/events,/en/events/${EVENT},/en/dashboard,/fr/members`
).split(',');

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox'],
  // A busy runner can take longer than the 30 s allowed by default to start the browser.
  timeout: 120000,
});

let failures = 0;
try {
  for (const path of PAGES) {
    let bad = 0;
    const seen = new Map();
    for (let load = 0; load < LOADS; load++) {
      const page = await browser.newPage();
      await page.setCookie({ name: COOKIE, value: token, url: base, httpOnly: true });
      const watch = await watchPage(page, {
        label: `${path} load ${load}`,
        shots: shots && join(shots, 'errors'),
      });
      // The first load warms the browser's cache, as a returning visitor's browser has it; the others are slow.
      if (load > 0) {
        const session = await page.createCDPSession();
        await session.send('Network.emulateNetworkConditions', {
          offline: false,
          latency: LATENCY_MS,
          downloadThroughput: (KBPS * 1000) / 8,
          uploadThroughput: (KBPS * 1000) / 8,
        });
      }
      await page.goto(`${base}${path}`, { waitUntil: 'networkidle0', timeout: 120000 });
      // Hydration happens after the page is drawn: give it the time it needs on a slow connection.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (watch.errors.length > 0) {
        bad++;
        for (const line of await watch.describe()) {
          const key = line.replace(/\(document.*$/, '').slice(0, 90);
          seen.set(key, (seen.get(key) ?? 0) + 1);
        }
      }
      await page.close();
    }
    const verdict = bad === 0 ? '✓' : '✗';
    console.log(
      `${verdict} ${path}: ${LOADS - bad} of ${LOADS} loads without an error (${KBPS} kbps, ${LATENCY_MS} ms)`,
    );
    for (const [line, count] of seen) console.log(`    ${count} × ${line}`);
    if (bad > 0) failures++;
  }
} finally {
  await browser.close();
}
if (failures > 0) {
  console.error('\n✗ a page raised errors while it was hydrated on a slow connection');
  process.exitCode = 1;
} else {
  console.log('\nAll good.');
}
