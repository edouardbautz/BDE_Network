// End-to-end test of the buttons and links of the events page that change only what is asked of the same page
// (the month, calendar or list, a day, one date of a series), in a real browser, on a computer-sized and on a
// phone-sized screen, in French and in English.
//
//   AUTH_SECRET=<the session secret of the platform> node e2e/events.mjs <address>
//   OWNER=alice     the login of an owner account (it must exist)
//   MEMBER=carol    the login of a member who can read events but not create them (it must exist)
//   EVENT=e2e-weekly  the id of a confirmed weekly event that has at least two dates to come
//   CHROME_PATH=...  SHOTS=<folder>
//
// Why it exists: in the production build, Next.js's client router can accept a click on a link that only changes the
// query string of the page you are on, fetch the page, and then never show it (the address does not move either).
// Nothing is logged and the development server does not do it, so a person just sees a button that does nothing.
// Every check below waits for the page to CHANGE, not for a request to leave (see "Navigation" in
// docs/architecture.md). Nobody can sign in through 42 here: the session cookie is forged with the platform's own
// secret, exactly as Auth.js writes it; the pages and the database are the real ones.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { encode } from '@auth/core/jwt';
import puppeteer from 'puppeteer-core';
import { networkRests } from './network.mjs';
import { settled, watchPage } from './watch-page.mjs';

const [base] = process.argv.slice(2);
const secret = process.env.AUTH_SECRET;
if (!base || !secret) {
  console.error('usage: AUTH_SECRET=... node e2e/events.mjs <address>');
  process.exit(2);
}
const OWNER = process.env.OWNER ?? 'alice';
const MEMBER = process.env.MEMBER ?? 'carol'; // an approved member without the right to create events
const EVENT = process.env.EVENT ?? 'e2e-weekly';

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
const memberToken = await encode({ token: { login: MEMBER }, secret, salt: COOKIE });

const SCREENS = {
  computer: { width: 1280, height: 900 },
  phone: { width: 390, height: 800, isMobile: true, hasTouch: true },
};
const WORDS = {
  fr: {
    previous: 'Mois précédent',
    next: 'Mois suivant',
    today: "Aujourd'hui",
    calendar: 'Calendrier',
    list: 'Liste',
    addOnDay: 'Ajouter un événement le',
  },
  en: {
    previous: 'Previous month',
    next: 'Next month',
    today: 'Today',
    calendar: 'Calendar',
    list: 'List',
    addOnDay: 'Add an event on',
  },
};

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

/** The title of a month, written as the page writes it. */
function monthTitle(key, lang) {
  const [year, month] = key.split('-').map(Number);
  const text = new Intl.DateTimeFormat(lang, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
  return text.charAt(0).toLocaleUpperCase(lang) + text.slice(1);
}
function shiftMonth(key, by) {
  const [year, month] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + by, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function run(screen, lang) {
  const label = `${screen} screen, ${lang}`;
  const words = WORDS[lang];
  const page = await browser.newPage();
  await page.setViewport(SCREENS[screen]);
  await page.setExtraHTTPHeaders({ 'Accept-Language': lang });
  await page.setCookie({ name: COOKIE, value: token, url: base, httpOnly: true });
  page.setDefaultTimeout(15000);
  // The browser can be set to another time zone than the server's (TIMEZONE) and slowed down (CPU_THROTTLE: 4 = four
  // times slower), to catch a page that is drawn differently by the server and by the browser, or a click that comes
  // before the page is ready.
  if (process.env.TIMEZONE) await page.emulateTimezone(process.env.TIMEZONE);
  if (process.env.CPU_THROTTLE) await page.emulateCPUThrottling(Number(process.env.CPU_THROTTLE));
  const watch = await watchPage(page, { label, shots: shots && join(shots, 'errors') });
  const step = (message) => console.log(`✓ [${label}] ${message}`);
  const monthShown = () => page.$eval('h2[aria-live]', (el) => el.textContent?.trim());
  /**
   * Waits until `until` is true in the page. The page may be replaced while we wait (a link to the page you are on
   * loads it again), so the question is asked again and again, and a page that is being replaced is not an answer.
   */
  const waitFor = async (until, argument, timeout = 10000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const done = await page.evaluate(until, argument).catch(() => false);
      if (done) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  };
  /** Clicks what a person would click (a link by its name or its address) and waits until `until` is true. */
  const clickAndWait = async (selector, until, description, argument) => {
    const element = await page.waitForSelector(selector, { visible: true });
    await element.click();
    if (!(await waitFor(until, argument))) {
      if (shots)
        await page.screenshot({ path: join(shots, `${lang}-${screen}-stuck.png`), fullPage: true });
      fail(`[${label}] clicked ${selector}, but ${description} (still on ${page.url()})`);
    }
  };
  const link = (name) => `a[aria-label="${name}"]`;
  const tab = (name) => `nav a::-p-text("${name}")`;

  // Nothing chosen: the screen decides (the calendar on a computer, the list on a phone).
  await page.goto(`${base}/${lang}/events`, { waitUntil: 'networkidle0' });
  // The view is asked for in the address, so that the month buttons are there on a phone too.
  await clickAndWait(
    tab(words.calendar),
    () => location.search.includes('view=calendar') && document.querySelector('table') !== null,
    'the calendar did not appear',
  );
  const start = await page.$eval('input[name="month"]', (el) => el.value);
  if (!/^\d{4}-\d{2}$/.test(start)) fail(`[${label}] no month in the filter form: "${start}"`);
  const titleOf = (key) => monthTitle(key, lang);
  if ((await monthShown()) !== titleOf(start))
    fail(`[${label}] the month shown is not ${titleOf(start)}`);
  step(`calendar view: ${titleOf(start)}`);

  // 1. next month, previous month twice, today
  // (sent to the page as it is: it can only use its argument)
  const showsMonth = (title) =>
    document.querySelector('h2[aria-live]')?.textContent?.trim() === title;
  await clickAndWait(
    link(words.next),
    showsMonth,
    'the next month did not show',
    titleOf(shiftMonth(start, 1)),
  );
  if (!page.url().includes(`month=${shiftMonth(start, 1)}`))
    fail(`[${label}] the address does not carry the next month`);
  step('"next month" shows the next month');
  await clickAndWait(
    link(words.previous),
    showsMonth,
    'the month before did not show',
    titleOf(start),
  );
  await clickAndWait(
    link(words.previous),
    showsMonth,
    'the month before did not show',
    titleOf(shiftMonth(start, -1)),
  );
  step('"previous month" shows the month before, twice');
  await clickAndWait(
    `a::-p-text("${words.today}")`,
    showsMonth,
    '"today" did not come back to the current month',
    titleOf(start),
  );
  step('"today" comes back to the current month');

  // 2. a day of the grid (the phone shows the events of the chosen day under the grid)
  await page.waitForSelector('table');
  const before = await page.$eval('#selected-day-heading', (el) => el.textContent?.trim());
  const pick = new Date().getUTCDate() === 20 ? 21 : 20; // not the day that is selected to begin with
  const dayKey = `${start}-${pick}`;
  await clickAndWait(
    `table a[href*="day=${dayKey}"]`,
    (previous) =>
      location.search.includes('day=') &&
      document.querySelector('#selected-day-heading')?.textContent?.trim() !== previous,
    'the day of the grid was not selected',
    before,
  );
  step('a day of the grid selects that day');

  // 2b. add an event on a day: the "+" in the corner of the cell (computer), the button of the day panel (phone), for
  // whoever can create events; the form opens on that day, at 18:00–20:00 in the BDE's time zone
  const addAddress = `/${lang}/events/new?date=${dayKey}`;
  const addLink = `table a[href="${addAddress}"]`;
  const dayLink = `table a[href*="day=${dayKey}"]`;
  const opacityOf = (selector) =>
    page.$eval(selector, (el) => getComputedStyle(el).opacity).catch(() => null);
  // (sent to the page as it is: it can only use its argument)
  const isOn = (address) => location.pathname + location.search === address;
  const formStartsOn = async () => {
    await page.waitForSelector('#startsAt');
    const [startsAt, endsAt] = await page.$$eval('#startsAt, #endsAt', (els) =>
      els.map((el) => el.value),
    );
    if (startsAt !== `${dayKey}T18:00` || endsAt !== `${dayKey}T20:00`)
      fail(`[${label}] the form starts ${startsAt} – ${endsAt}, not ${dayKey} 18:00 – 20:00`);
  };
  const cancelBackToTheDay = async () => {
    await clickAndWait(
      `main a[href*="view=calendar"][href*="day=${dayKey}"]`,
      () => location.pathname.endsWith('/events') && document.querySelector('table') !== null,
      'cancelling the form did not come back to the calendar',
    );
    await settled(page);
  };
  await settled(page);
  if (screen === 'computer') {
    if ((await opacityOf(addLink)) !== '0')
      fail(`[${label}] the "+" of a day shows without being asked`);
    // (The Chrome of the CI has no pointing device: `@media (hover: hover)` does not match there, which is where Tailwind
    // puts its `hover:` variants. The "+" must appear on hover without it: it is how this check found out.)
    await page.hover(dayLink);
    const shown = (selector) => getComputedStyle(document.querySelector(selector)).opacity === '1';
    if (!(await waitFor(shown, addLink)))
      fail(`[${label}] the "+" did not appear when the day was hovered`);
    const name = await page.$eval(addLink, (el) => el.getAttribute('aria-label'));
    if (!name?.startsWith(words.addOnDay) || !name.includes(String(pick)))
      fail(`[${label}] the "+" is named "${name}"`);
    step('the "+" of a day appears when the day is hovered, and says which day');

    // the keyboard: the day, then its "+", which shows itself when it has the focus
    await page.mouse.move(0, 0);
    await page.focus(dayLink);
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('href'));
    if (focused !== addAddress)
      fail(`[${label}] Tab from the day went to ${focused}, not to its "+"`);
    if (!(await waitFor(shown, addLink)))
      fail(`[${label}] the "+" stays invisible with the keyboard focus`);
    step('the "+" is the next stop of the keyboard after the day, and shows itself there');

    await clickAndWait(addLink, isOn, 'the "+" did not open the form on that day', addAddress);
  } else {
    // a phone has no hover: no "+" in the cells, a button under the grid for the day that is selected
    const display = await page.$eval(addLink, (el) => getComputedStyle(el).display);
    if (display !== 'none') fail(`[${label}] the "+" of the cells shows on a phone (${display})`);
    await clickAndWait(
      '#add-on-selected-day',
      isOn,
      'the button of the day did not open the form',
      addAddress,
    );
  }
  await formStartsOn();
  step('the form opens on that day, 18:00–20:00');
  await settled(page);
  await cancelBackToTheDay();
  step('cancelling comes back to that day of the calendar');

  // 3. the list, then the calendar again
  await clickAndWait(
    tab(words.list),
    () => location.search.includes('view=list') && document.querySelector('table') === null,
    'the list did not replace the calendar',
  );
  if (!(await waitFor(() => document.body.innerText.includes('E2E weekly'))))
    fail(`[${label}] the list does not show the event`);
  step('the "list" button shows the list');
  await clickAndWait(
    tab(words.calendar),
    () => location.search.includes('view=calendar') && document.querySelector('table') !== null,
    'the calendar did not come back',
  );
  step('the "calendar" button shows the calendar again');

  // 4. one date of a series, on the page of the event (the selected one is the bold link of the list: the buttons
  // of the page, such as "Edit", carry the date too and are bold as well)
  await page.goto(`${base}/${lang}/events/${EVENT}`, { waitUntil: 'networkidle0' });
  const dates = await page.$$eval(`a[href^="/${lang}/events/${EVENT}?occ="]`, (links) =>
    links.map((el) => ({ href: el.getAttribute('href'), text: el.textContent?.trim() })),
  );
  if (dates.length < 2)
    fail(`[${label}] the event has ${dates.length} dates to come, 2 are needed`);
  const wanted = dates[1];
  await clickAndWait(
    `a[href="${wanted.href}"]`,
    (text) =>
      document
        .querySelector('li a[href*="/events/"][href*="occ="].font-bold')
        ?.textContent?.trim() === text,
    'the other date of the series was not selected',
    wanted.text,
  );
  step('another date of a series is selected');

  // 5. the menu, from the page you are on and from the others (only the computer shows it open)
  if (screen === 'computer') {
    await page.goto(`${base}/${lang}/events?view=list`, { waitUntil: 'networkidle0' });
    const entry = (name) => `aside a[href="/${lang}/${name}"]`;
    await clickAndWait(
      entry('events'),
      () => !location.search.includes('view=list') && document.querySelector('table') !== null,
      'the menu entry of the page you are on did not bring the calendar back',
    );
    // Let the page finish loading before leaving it: leaving a page that is still hydrating raises errors that are
    // the test's own doing, not the page's.
    await networkRests(page, { idleTime: 500 }).catch(() => undefined);
    await clickAndWait(
      entry('dashboard'),
      () => location.pathname.endsWith('/dashboard'),
      'the menu did not open the dashboard',
    );
    // Let the page finish loading before leaving it: leaving a page that is still hydrating raises errors that are
    // the test's own doing, not the page's.
    await networkRests(page, { idleTime: 500 }).catch(() => undefined);
    await clickAndWait(
      entry('events'),
      () => location.pathname.endsWith('/events') && document.querySelector('table') !== null,
      'the menu did not open the events',
    );
    // Let the page finish loading before leaving it: leaving a page that is still hydrating raises errors that are
    // the test's own doing, not the page's.
    await networkRests(page, { idleTime: 500 }).catch(() => undefined);
    step('the menu opens the events page, from itself and from the dashboard');
  }

  if (screen === 'computer') {
    // Somebody who can read events but not create them: no "+", no button, and the form sends them back to the list.
    const member = await browser.newPage();
    await member.setViewport(SCREENS.computer);
    await member.setExtraHTTPHeaders({ 'Accept-Language': lang });
    await member.setCookie({ name: COOKIE, value: memberToken, url: base, httpOnly: true });
    await member.goto(`${base}/${lang}/events?view=calendar`, { waitUntil: 'networkidle0' });
    const calendar = await member.$('table');
    if (!calendar)
      fail(`[${label}] the member ${MEMBER} cannot read the calendar (is the account there?)`);
    const offered = await member.$$eval(
      'a[href*="/events/new"], #add-on-selected-day',
      (els) => els.length,
    );
    if (offered !== 0)
      fail(`[${label}] ${offered} way(s) to create an event are offered to a member`);
    await member.goto(`${base}/${lang}/events/new?date=${dayKey}`, { waitUntil: 'networkidle0' });
    if (new URL(member.url()).pathname !== `/${lang}/events`)
      fail(`[${label}] a member reached ${member.url()} with the address of the form`);
    await member.close();
    step('a member sees no way to create an event, and the form sends them back to the list');
  }

  if (watch.errors.length > 0) {
    fail(`[${label}] the page raised errors: ${(await watch.describe()).join(' | ')}`);
  }
  await page.close();
}

try {
  for (const screen of Object.keys(SCREENS)) {
    for (const lang of ['fr', 'en']) await run(screen, lang);
  }
  console.log('\nAll good.');
} catch (error) {
  console.error(`\n✗ ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
