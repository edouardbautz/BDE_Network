// covers: events.updateEvent, events.setEventStatus, events.cancelOccurrence, events.restoreOccurrence
// covers: events.deleteFollowingDates
// End-to-end test of the dialogs of a series of events (one date, or this date and the following), in a real
// browser, against the real image: edit, put back to draft, confirm, cancel, restore and delete, in French and in
// English. The unit tests run the same operations on an in-memory database; this one proves the buttons, the
// dialog, the forms and the redirects work once built (a series is cut in two rows: the page after the action must
// be the one that holds the date).
//
//   AUTH_SECRET=<the session secret of the platform> node e2e/series.mjs <address>
//   OWNER=alice          the login of an owner account (it must exist)
//   EVENT=e2e-series     prefix of the events to use: `<prefix>-fr` and `<prefix>-en` must be confirmed weekly
//                        events with at least six dates to come (they are changed by the test)
//   LANGS=fr,en          the languages to run
//   CHROME_PATH=...  SHOTS=<folder>
//
// Nobody can sign in through 42 here: the session cookie is forged with the platform's own secret, exactly as
// Auth.js writes it; the pages and the database are the real ones.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { encode } from '@auth/core/jwt';
import puppeteer from 'puppeteer-core';
import { watchPage } from './watch-page.mjs';

const [base] = process.argv.slice(2);
const secret = process.env.AUTH_SECRET;
if (!base || !secret) {
  console.error('usage: AUTH_SECRET=... node e2e/series.mjs <address>');
  process.exit(2);
}
const OWNER = process.env.OWNER ?? 'alice';
const PREFIX = process.env.EVENT ?? 'e2e-series';
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
    edit: 'Modifier',
    save: 'Enregistrer',
    only: 'Seulement celui-ci',
    following: 'Celui-ci et les suivants',
    draftButton: 'Repasser en brouillon',
    confirmButton: 'Confirmer',
    deleteButton: 'Supprimer',
    restore: 'Rétablir',
    edited: 'Modifiée',
    draft: 'Brouillon',
    canceled: 'Annulé',
  },
  en: {
    edit: 'Edit',
    save: 'Save',
    only: 'Only this one',
    following: 'This one and the following',
    draftButton: 'Back to draft',
    confirmButton: 'Confirm',
    deleteButton: 'Delete',
    restore: 'Restore',
    edited: 'Edited',
    draft: 'Draft',
    canceled: 'Cancelled',
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

async function run(lang) {
  const words = WORDS[lang];
  const id = `${PREFIX}-${lang}`;
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1000 });
  await page.setExtraHTTPHeaders({ 'Accept-Language': lang });
  await page.setCookie({ name: COOKIE, value: token, url: base, httpOnly: true });
  page.setDefaultTimeout(15000);
  const watch = await watchPage(page, {
    label: `series ${lang}`,
    shots: shots && join(shots, 'errors'),
  });
  const step = (message) => console.log(`✓ [${lang}] ${message}`);
  /** Runs a question to the page again when the page was being replaced while it was asked (a hard load is on its way). */
  const whenSettled = async (ask) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await ask();
      } catch (error) {
        if (
          attempt >= 6 ||
          !/context was destroyed|Cannot find context|Execution context/.test(error.message)
        ) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
  };
  const text = () => whenSettled(() => page.evaluate(() => document.body.innerText));

  /** Waits until `until` is true in the page (which may be replaced while we wait: a failing query is "not yet"). */
  const waitFor = async (until, argument, timeout = 12000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await page.evaluate(until, argument).catch(() => false)) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  };
  const expectText = async (needle, description) => {
    const ok = await waitFor((value) => document.body.innerText.includes(value), needle);
    if (!ok) {
      if (shots) await page.screenshot({ path: join(shots, `series-${lang}-fail.png`) });
      fail(
        `[${lang}] ${description}: "${needle}" never showed. Page: ${(await text()).slice(0, 400)}`,
      );
    }
  };
  const expectNoText = async (needle, description) => {
    if ((await text()).includes(needle)) fail(`[${lang}] ${description}: "${needle}" is there`);
  };
  /** The dates of the series, as listed on the page: [{ occ, label }] in order. */
  const dates = () =>
    whenSettled(() =>
      page.$$eval('a[href*="occ="]:not([href^="/api/"])', (links) =>
        links
          .filter((link) => link.closest('li'))
          .map((link) => ({
            occ: new URL(link.href).searchParams.get('occ'),
            label: link.closest('li')?.innerText.replace(/\s+/g, ' ').trim() ?? '',
          })),
      ),
    );
  const goTo = async (path) => {
    await page.goto(`${base}/${lang}${path}`, { waitUntil: 'networkidle0' });
  };
  /** A button or link, by the beginning of its text, inside `scope` (the dialog, or the whole page). */
  const clickText = async (label, scope = 'body') => {
    const found = await waitFor(
      ([where, wanted]) =>
        [...document.querySelectorAll(`${where} button, ${where} a`)].some(
          (el) => el.textContent?.trim().startsWith(wanted) && !el.disabled,
        ),
      [scope, label],
    );
    if (!found)
      fail(`[${lang}] no button "${label}" in ${scope}. Page: ${(await text()).slice(0, 300)}`);
    const handle = await page.evaluateHandle(
      ([where, wanted]) =>
        [...document.querySelectorAll(`${where} button, ${where} a`)].find(
          (el) => el.textContent?.trim().startsWith(wanted) && !el.disabled,
        ),
      [scope, label],
    );
    await handle.asElement().click();
  };
  const dialog = '[role="dialog"]';
  /** Clicks something that makes the browser load a page, and waits until the page has loaded. */
  const clickAndLoad = async (label, scope = 'body') => {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
      clickText(label, scope),
    ]);
  };
  /** In the open dialog: the choice that is selected, and a choice picked by its label. */
  const selectedChoice = () =>
    page.evaluate(() => {
      const radio = document.querySelector('[role="dialog"] input[type="radio"]:checked');
      return radio?.closest('label')?.querySelector('span span')?.textContent?.trim() ?? null;
    });
  const pickChoice = async (label) => {
    const handle = await page.evaluateHandle(
      (wanted) =>
        [...document.querySelectorAll('[role="dialog"] label')].find((el) =>
          el.textContent?.trim().startsWith(wanted),
        ),
      label,
    );
    if (!handle.asElement()) fail(`[${lang}] no choice "${label}" in the dialog`);
    await handle.asElement().click();
  };
  const eventIdOfUrl = () => new URL(page.url()).pathname.split('/')[3];
  /** Opens the date at `index` of the dates listed on the page, in the row of the event being looked at. */
  const openDate = async (index) => {
    const row = eventIdOfUrl();
    const list = await dates();
    const date = list[index];
    if (!date) fail(`[${lang}] the series has only ${list.length} dates, wanted index ${index}`);
    await goTo(`/events/${row}?occ=${date.occ}`);
    return date;
  };

  await goTo(`/events/${id}`);
  const first = await dates();
  if (first.length < 6)
    fail(`[${lang}] the series needs six dates to come, it has ${first.length}`);
  step(`the series page lists ${first.length} dates`);

  // ---- edit: only this one --------------------------------------------------------------------------------------
  await openDate(1);
  await clickText(words.edit);
  await page.waitForSelector('#location');
  await page.$eval('#location', (el) => (el.value = ''));
  await page.type('#location', 'Room ONLY');
  await clickText(words.save, 'form');
  await page.waitForSelector(dialog);
  if ((await selectedChoice()) !== words.only)
    fail(`[${lang}] the narrowest choice is not selected first`);
  step('saving a date asks "only this one or the following", with "only this one" selected');
  await clickText(words.save, dialog);
  await expectText('Room ONLY', 'the date shows its own place');
  await expectText(words.edited, 'the date says it was edited');
  if (eventIdOfUrl() !== id) fail(`[${lang}] editing only one date must not move to another row`);
  await openDate(0);
  await expectNoText('Room ONLY', 'the other dates keep the series place');
  await openDate(2);
  await expectNoText('Room ONLY', 'the other dates keep the series place');
  step('only this date changed');

  // ---- edit: this one and the following (cuts the series) ---------------------------------------------------------
  const third = await openDate(2);
  await clickText(words.edit);
  await page.waitForSelector('#location');
  await page.$eval('#location', (el) => (el.value = ''));
  await page.type('#location', 'Room FOLLOWING');
  await clickText(words.save, 'form');
  await page.waitForSelector(dialog);
  await pickChoice(words.following);
  await clickText(words.save, dialog);
  await expectText('Room FOLLOWING', 'the date shows the new place');
  const tailId = eventIdOfUrl();
  if (tailId === id)
    fail(`[${lang}] "this one and the following" on a later date must cut the series`);
  if (!page.url().includes(`occ=${third.occ}`))
    fail(`[${lang}] the page after the cut shows another date`);
  const tailDates = await dates();
  if (tailDates.length !== first.length - 2) {
    fail(
      `[${lang}] the second part should hold ${first.length - 2} dates, it holds ${tailDates.length}`,
    );
  }
  step('this date and the following moved to a second row, with the new place');
  await goTo(`/events/${id}`);
  const headDates = await dates();
  if (headDates.length !== 2)
    fail(`[${lang}] the first part should hold 2 dates, it holds ${headDates.length}`);
  await openDate(0);
  await expectNoText('Room FOLLOWING', 'the first part keeps its place');
  step('the first part stops before the cut date and keeps its place');

  // ---- back to draft: only this one, then confirm it again -------------------------------------------------------
  await goTo(`/events/${tailId}`);
  const tailFirst = (await dates())[1];
  await goTo(`/events/${tailId}?occ=${tailFirst.occ}`);
  await clickText(words.draftButton);
  await page.waitForSelector(dialog);
  if ((await selectedChoice()) !== words.only) fail(`[${lang}] draft dialog: wrong default choice`);
  await clickAndLoad(words.draftButton, dialog);
  await expectText(words.draft, 'the date is a draft');
  if (eventIdOfUrl() !== tailId) fail(`[${lang}] one date to draft must not cut the series`);
  const listed = await dates();
  const drafts = listed.filter((date) => date.label.includes(words.draft));
  if (drafts.length !== 1)
    fail(`[${lang}] exactly one date should be a draft, ${drafts.length} are`);
  step('one date went back to draft alone');
  await clickText(words.confirmButton);
  await page.waitForSelector(dialog);
  await clickAndLoad(words.confirmButton, dialog);
  await waitFor(
    () =>
      !document.body.innerText.includes('Brouillon') && !document.body.innerText.includes('Draft'),
  );
  const after = (await dates()).filter((date) => date.label.includes(words.draft));
  if (after.length !== 0) fail(`[${lang}] confirming the date again left a draft`);
  step('and was confirmed again');

  // ---- cancel one date and restore it ------------------------------------------------------------------------------
  await goTo(`/events/${tailId}?occ=${tailFirst.occ}`);
  await clickText(words.deleteButton);
  await page.waitForSelector(dialog);
  if ((await selectedChoice()) !== words.only)
    fail(`[${lang}] delete dialog: wrong default choice`);
  await clickAndLoad(words.deleteButton, dialog);
  await expectText(words.canceled, 'the date is canceled, not deleted');
  await clickAndLoad(words.restore);
  await expectNoText(words.canceled, 'the date is restored');
  step('one date canceled with "only this one", then restored');

  // ---- delete this one and the following ---------------------------------------------------------------------------
  const before = (await dates()).length;
  const cutAt = await openDate(2);
  await clickText(words.deleteButton);
  await page.waitForSelector(dialog);
  await pickChoice(words.following);
  await clickAndLoad(words.deleteButton, dialog);
  await goTo(`/events/${tailId}`);
  const left = await dates();
  if (left.length !== 2)
    fail(
      `[${lang}] deleting the following should leave 2 dates, ${left.length} of ${before} are left`,
    );
  if (left.some((date) => date.occ === cutAt.occ))
    fail(`[${lang}] the date that was cut is still there`);
  step('"this one and the following" deleted the end of the series');

  // ---- back to the first date of the second part: that is the whole part ---------------------------------------
  await openDate(0);
  await clickText(words.deleteButton);
  await page.waitForSelector(dialog);
  await pickChoice(words.following);
  await clickAndLoad(words.deleteButton, dialog);
  const backToList = await waitFor((path) => location.pathname === path, `/${lang}/events`, 5000);
  if (!backToList) {
    if (shots) await page.screenshot({ path: join(shots, `series-${lang}-fail.png`) });
    fail(
      `[${lang}] deleting from the first date should go back to the list, but the page is on ${page.url()}: ${(await text()).slice(0, 300)}`,
    );
  }
  // (The page itself answers 200 with its "not found" content: the response is streamed before the page knows.)
  // Asked from the page that is open: leaving it for another page while it is still hydrating raises errors that are
  // the test's own doing.
  await page.waitForNetworkIdle({ idleTime: 500 }).catch(() => undefined);
  const goneStatus = await page.evaluate(
    (address) => fetch(address).then((response) => response.status),
    `/api/events/${tailId}/ics`,
  );
  if (goneStatus !== 404) fail(`[${lang}] the deleted event still answers ${goneStatus}`);
  step('"this one and the following" on the first date deleted the whole event');

  if (watch.errors.length > 0) {
    fail(`[${lang}] errors in the page: ${(await watch.describe()).join(' | ')}`);
  }
  await page.close();
}

let failed = false;
for (const lang of LANGS) {
  try {
    await run(lang);
  } catch (error) {
    failed = true;
    console.error(`✗ ${error.message}`);
  }
}
await browser.close();
if (failed) process.exit(1);
console.log('Series dialogs: all good.');
