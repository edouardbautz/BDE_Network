// covers: events.createEvent
// End-to-end test of the repeat rules of the events module, in a real browser, on the real image, in French and in
// English: the usual choices of the list, "Custom" (every 2 weeks on Monday and Wednesday, 10 times), the preview the
// form shows before anything is saved, a first date that moves to the first one that fits the rule, the limit of an
// event, a series cut in two (the number of dates is shared), and a series whose rule is edited. The unit tests run the
// same rules on an in-memory database; this one proves the form, the preview and the pages once built.
//
//   AUTH_SECRET=<the session secret of the platform> PSQL="<a psql command on the platform's database>" \
//     node e2e/repeat.mjs <address>
//   OWNER=alice     the login of an owner account (it must exist)
//   LANGS=fr,en     the languages to run
//   CHROME_PATH=...  SHOTS=<folder>
//
// Nobody can sign in through 42 here: the session cookie is forged with the platform's own secret, exactly as Auth.js
// writes it. What the script creates is removed when it ends. The dates are typed on the wall clock of the BDE, which
// is what the form does whatever the time zone of the browser.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { encode } from '@auth/core/jwt';
import puppeteer from 'puppeteer-core';
import { settled, watchPage } from './watch-page.mjs';

const [base] = process.argv.slice(2);
const secret = process.env.AUTH_SECRET;
const PSQL = process.env.PSQL;
if (!base || !secret || !PSQL) {
  console.error('usage: AUTH_SECRET=... PSQL="psql ..." node e2e/repeat.mjs <address>');
  process.exit(2);
}
const OWNER = process.env.OWNER ?? 'alice';
const LANGS = (process.env.LANGS ?? 'fr,en').split(',');

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

const WORDS = {
  fr: {
    create: "Créer l'événement",
    save: 'Enregistrer',
    edit: 'Modifier',
    following: 'Celui-ci et les suivants',
    weekly: 'Toutes les semaines le lundi',
    custom: /^Toutes les 2 semaines le lundi et le mercredi, 10 fois$/,
    everyWeek: /^Toutes les semaines le lundi, jusqu'au /,
    total: (count) => `${count} dates au total`,
    moved: 'La première date devient le lundi',
    tooMany: 'Cette série contient trop de dates (400 au maximum)',
    monday: 'lundi',
    countRadio: 'Après',
  },
  en: {
    create: 'Create event',
    save: 'Save',
    edit: 'Edit',
    following: 'This one and the following',
    weekly: 'Every week on Monday',
    custom: /^Every 2 weeks on Monday and Wednesday, 10 times$/,
    everyWeek: /^Every week on Monday, until /,
    total: (count) => `${count} dates in total`,
    moved: 'The first date becomes Monday',
    tooMany: 'This series has too many dates (400 at most)',
    monday: 'Monday',
    countRadio: 'After',
  },
};

const sql = (statements) =>
  execSync(`${PSQL} -v ON_ERROR_STOP=1 -q -tA`, { input: statements }).toString().trim();
const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
const PREFIX = 'E2E repeat';
const cleanUp = () =>
  sql(
    `DELETE FROM "Event" WHERE title LIKE ${quote(`${PREFIX}%`)} OR "seriesId" IN (SELECT id FROM "Event" WHERE title LIKE ${quote(`${PREFIX}%`)})`,
  );
const repeatOf = (id) => JSON.parse(sql(`SELECT repeat FROM "Event" WHERE id = ${quote(id)}`));
const endOf = (id) =>
  sql(
    `SELECT to_char("recurrenceUntil" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI') FROM "Event" WHERE id = ${quote(id)}`,
  );

/** A day, as the form wants it. */
const dayKey = (date) => date.toISOString().slice(0, 10);
const addDays = (date, days) => new Date(date.getTime() + days * 86_400_000);
/** The first Monday at least two weeks from now, in UTC (the form's wall clock only needs a day). */
const monday = (() => {
  const day = addDays(new Date(), 14);
  day.setUTCHours(0, 0, 0, 0);
  return addDays(day, (8 - day.getUTCDay()) % 7);
})();

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

async function run(lang) {
  const words = WORDS[lang];
  const step = (message) => console.log(`✓ [${lang}] ${message}`);
  const stamp = Date.now().toString(36);

  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1280, height: 1100 });
  await page.setExtraHTTPHeaders({ 'Accept-Language': lang });
  await page.setCookie({ name: COOKIE, value: token, url: base, httpOnly: true });
  page.setDefaultTimeout(15000);
  if (process.env.TIMEZONE) await page.emulateTimezone(process.env.TIMEZONE);
  const watch = await watchPage(page, {
    label: `repeat ${lang}`,
    shots: shots && join(shots, 'errors'),
  });

  const waitFor = async (until, argument, timeout = 12000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await page.evaluate(until, argument).catch(() => false)) return true;
      await sleep(100);
    }
    return false;
  };
  const text = () => page.evaluate(() => document.body.innerText);
  const expectText = async (needle, description) => {
    if (!(await waitFor((value) => document.body.innerText.includes(value), needle))) {
      if (shots) await page.screenshot({ path: join(shots, `repeat-${lang}-fail.png`) });
      fail(
        `[${lang}] ${description}: "${needle}" never showed. Page: ${(await text()).slice(0, 500)}`,
      );
    }
  };
  const goTo = async (path) => {
    await page.goto(`${base}/${lang}${path}`, { waitUntil: 'networkidle0' });
    await settled(page).catch(() => undefined);
  };
  const clickText = async (label, scope = 'body') => {
    const handle = await page
      .waitForFunction(
        ([where, wanted]) =>
          [...document.querySelectorAll(`${where} button, ${where} a`)].find(
            (el) => el.textContent?.trim().startsWith(wanted) && !el.disabled,
          ),
        { timeout: 8000 },
        [scope, label],
      )
      .catch(() => null);
    if (!handle)
      fail(`[${lang}] no button "${label}" in ${scope}. Page: ${(await text()).slice(0, 300)}`);
    await handle.asElement().click();
  };
  /** Types into a field of the form the way a person does, so that the form (a React component) notices. */
  const setValue = (selector, value) =>
    page.$eval(
      selector,
      (el, wanted) => {
        const prototype =
          el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, wanted);
        el.dispatchEvent(
          new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }),
        );
      },
      value,
    );
  /** Clicks a checkbox or a radio (the checkboxes of the days are visually hidden: the click is the label's). */
  const click = (selector) => page.$eval(selector, (el) => el.click());
  const preview = () =>
    page.evaluate(
      () =>
        document.querySelector('form [role="status"]')?.innerText.replace(/\s+/g, ' ').trim() ?? '',
    );
  const waitForPreview = async (needle, description) => {
    if (
      !(await waitFor(
        (value) =>
          (document.querySelector('form [role="status"]')?.innerText ?? '').includes(value),
        needle,
      ))
    ) {
      if (shots) await page.screenshot({ path: join(shots, `repeat-${lang}-preview-fail.png`) });
      fail(`[${lang}] ${description}: the preview says "${await preview()}", expected "${needle}"`);
    }
  };
  /** The dates of the series, as listed on the page of an event. */
  const dates = () =>
    page.$$eval('a[href*="occ="]:not([href^="/api/"])', (links) =>
      links
        .filter((link) => link.closest('li'))
        .map((link) => ({
          occ: new URL(link.href).searchParams.get('occ'),
          label: link.closest('li')?.innerText.replace(/\s+/g, ' ').trim() ?? '',
        })),
    );
  const eventId = () => new URL(page.url()).pathname.split('/')[3];

  /** Opens the form, fills what every event needs, and starts on `start` (a Date: its day) at 18:00. */
  const newEvent = async (title, start) => {
    await goTo('/events/new');
    await page.type('#title', title);
    await page.type('#description', 'Written by a test');
    await page.type('#location', 'Room');
    await setValue('#startsAt', `${dayKey(start)}T18:00`);
    await setValue('#endsAt', `${dayKey(start)}T20:00`);
  };
  /** Sends the form and waits for the page of the event it leads to. */
  const send = async () => {
    await clickText(words.create, 'form');
    const left = await waitFor(
      () => /\/events\/[^/]+$/.test(location.pathname) && !location.pathname.endsWith('/new'),
    );
    if (!left)
      fail(
        `[${lang}] the form did not lead to the new event (${page.url()}): ${(await text()).slice(0, 300)}`,
      );
    await settled(page).catch(() => undefined);
    return eventId();
  };

  try {
    // ---- a usual choice of the list ----------------------------------------------------------------------------------
    const weeklyTitle = `${PREFIX} weekly ${lang} ${stamp}`;
    await newEvent(weeklyTitle, monday);
    const options = await page.$$eval('#repeat option', (els) => els.map((el) => el.textContent));
    if (!options.includes(words.weekly)) {
      fail(
        `[${lang}] the list says ${JSON.stringify(options)}: expected "${words.weekly}" worded from the first date`,
      );
    }
    if (await page.$('form [role="status"]'))
      fail(`[${lang}] a preview shows before a repetition is chosen`);
    await setValue('#repeat', 'WEEKLY');
    await setValue('#recurrenceUntil', dayKey(addDays(monday, 21)));
    await waitForPreview(words.total(4), 'every Monday for four weeks');
    if (!words.everyWeek.test(await preview()))
      fail(`[${lang}] the preview says "${await preview()}"`);
    const weeklyId = await send();
    const weekly = await dates();
    if (weekly.length !== 4) fail(`[${lang}] the series lists ${weekly.length} dates, expected 4`);
    if (JSON.stringify(repeatOf(weeklyId)) !== JSON.stringify({ freq: 'WEEKLY', interval: 1 })) {
      fail(`[${lang}] the rule stored is ${JSON.stringify(repeatOf(weeklyId))}`);
    }
    if (
      !words.everyWeek.test(
        await page.evaluate(
          () =>
            document.body.innerText.split('\n').find((line) => /^(Toutes|Every)/.test(line)) ?? '',
        ),
      )
    ) {
      fail(`[${lang}] the page of the event does not say how it repeats`);
    }
    step(
      'a usual choice: worded from the first date, previewed, saved as a rule, listed as four dates',
    );

    // ---- custom: every 2 weeks on Monday and Wednesday, 10 times --------------------------------------------------------
    const customTitle = `${PREFIX} custom ${lang} ${stamp}`;
    await newEvent(customTitle, monday);
    await setValue('#repeat', 'CUSTOM');
    await page.waitForSelector('#repeatInterval');
    // the panel starts from the weekday of the first date: Monday is checked
    if (!(await page.$eval('input[name="repeatWeekdays"][value="MO"]', (el) => el.checked))) {
      fail(`[${lang}] the custom panel does not start from the weekday of the first date`);
    }
    await setValue('#repeatInterval', '2');
    await click('input[name="repeatWeekdays"][value="WE"]');
    await click('input[name="repeatEnd"][value="count"]');
    await setValue('#repeatCount', '10');
    await waitForPreview(words.total(10), 'ten dates');
    const sentence = (await preview()).split(/(?<=times|fois) /)[0];
    if (!words.custom.test(sentence)) fail(`[${lang}] the preview says "${await preview()}"`);
    const customId = await send();
    const customDates = await dates();
    if (customDates.length !== 10)
      fail(`[${lang}] the series lists ${customDates.length} dates, expected 10`);
    const customRule = repeatOf(customId);
    if (
      JSON.stringify(customRule) !==
      JSON.stringify({ freq: 'WEEKLY', interval: 2, weekdays: ['MO', 'WE'], count: 10 })
    ) {
      fail(`[${lang}] the rule stored is ${JSON.stringify(customRule)}`);
    }
    // a series that ends after 10 dates ends where its last one starts
    if (!endOf(customId).endsWith('T17:00') && !endOf(customId).endsWith('T16:00')) {
      fail(`[${lang}] the series ends at ${endOf(customId)}: expected the start of its last date`);
    }
    step('custom: every 2 weeks on Monday and Wednesday, 10 times: previewed, saved and listed');

    // ---- a first date that does not fit moves to the first that does ---------------------------------------------------
    const movedTitle = `${PREFIX} moved ${lang} ${stamp}`;
    await newEvent(movedTitle, addDays(monday, 5)); // a Saturday
    await setValue('#repeat', 'CUSTOM');
    await page.waitForSelector('#repeatInterval');
    await click('input[name="repeatWeekdays"][value="SA"]'); // off: it was the weekday of the first date
    await click('input[name="repeatWeekdays"][value="MO"]');
    await setValue('#recurrenceUntil', dayKey(addDays(monday, 40)));
    await waitForPreview(words.moved, 'a Saturday with "Monday"');
    const movedId = await send();
    const moved = await dates();
    if (!moved[0]?.label.includes(words.monday))
      fail(`[${lang}] the first date is "${moved[0]?.label}", expected a Monday`);
    if (moved[0].label.includes(String(addDays(monday, 5).getUTCDate()).padStart(2, '0') + ' ')) {
      fail(`[${lang}] the first date did not move`);
    }
    if (!movedId) fail(`[${lang}] no event`);
    step(
      'a first date that does not fit moves to the first one that does, and the preview says so',
    );

    // ---- the limit of an event -----------------------------------------------------------------------------------------
    await newEvent(`${PREFIX} long ${lang} ${stamp}`, monday);
    await setValue('#repeat', 'DAILY');
    await setValue('#recurrenceUntil', dayKey(addDays(monday, 500)));
    await waitForPreview('400', 'more than 400 days');
    await clickText(words.create, 'form');
    await expectText(
      words.tooMany,
      'the server refuses a series with more dates than an event holds',
    );
    if (new URL(page.url()).pathname.endsWith('/events/new') === false)
      fail(`[${lang}] the form left for ${page.url()}`);
    step('a series of more than 400 dates is told at once and refused on sending');

    // ---- cutting a series: the number of dates is shared -----------------------------------------------------------------
    await goTo(`/events/${customId}`);
    const fifth = (await dates())[4];
    await goTo(`/events/${customId}?occ=${fifth.occ}`);
    await clickText(words.edit);
    await page.waitForSelector('#location');
    await page.$eval('#location', (el) => (el.value = ''));
    await page.type('#location', 'Room CUT');
    await clickText(words.save, 'form');
    await page.waitForSelector('[role="dialog"]');
    await page.evaluate((wanted) => {
      [...document.querySelectorAll('[role="dialog"] label')]
        .find((el) => el.textContent?.trim().startsWith(wanted))
        ?.click();
    }, words.following);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => undefined),
      clickText(words.save, '[role="dialog"]'),
    ]);
    await expectText('Room CUT', 'the date shows the new place');
    const tailId = eventId();
    if (tailId === customId) fail(`[${lang}] a change from the 5th date did not cut the series`);
    const tailDates = await dates();
    if (tailDates.length !== 6)
      fail(`[${lang}] the second part lists ${tailDates.length} dates, expected 6`);
    await goTo(`/events/${customId}`);
    const headDates = await dates();
    if (headDates.length !== 4)
      fail(`[${lang}] the first part lists ${headDates.length} dates, expected 4`);
    const head = repeatOf(customId);
    const tail = repeatOf(tailId);
    if (head.count !== 4 || tail.count !== 6 || head.interval !== 2 || tail.interval !== 2) {
      fail(
        `[${lang}] the rules after the cut are ${JSON.stringify(head)} and ${JSON.stringify(tail)}`,
      );
    }
    step('a cut shares the number of dates: 4 before, 6 after, the same rule');

    // ---- editing the rule of a series ------------------------------------------------------------------------------------
    await goTo(`/events/${weeklyId}/edit`);
    await page.waitForSelector('#repeat');
    if ((await page.$eval('#repeat', (el) => el.value)) !== 'WEEKLY')
      fail(`[${lang}] the edit form does not start from the rule of the series`);
    if ((await page.$eval('#recurrenceUntil', (el) => el.value)) !== dayKey(addDays(monday, 21))) {
      fail(`[${lang}] the edit form does not start from the end of the series`);
    }
    await click('input[name="repeatEnd"][value="count"]');
    await setValue('#repeatCount', '2');
    await waitForPreview(words.total(2), 'two dates');
    await clickText(words.save, 'form');
    await page.waitForSelector('[role="dialog"]');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => undefined),
      clickText(words.save, '[role="dialog"]'),
    ]);
    await goTo(`/events/${weeklyId}`);
    const shortened = await dates();
    if (shortened.length !== 2)
      fail(`[${lang}] the shortened series lists ${shortened.length} dates, expected 2`);
    if (repeatOf(weeklyId).count !== 2)
      fail(`[${lang}] the rule stored is ${JSON.stringify(repeatOf(weeklyId))}`);
    step('the form of a series starts from its rule and its end, and a new end is applied');
  } finally {
    if (watch.errors.length > 0) {
      const lines = (await watch.describe()).join(' | ');
      await context.close();
      fail(`[${lang}] the page raised errors: ${lines}`);
    }
    await context.close();
  }
}

try {
  cleanUp();
  for (const lang of LANGS) await run(lang);
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
