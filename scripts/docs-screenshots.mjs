// Takes the screenshots of the documentation (docs/images/{fr,en}/*.webp) from the real application: the
// production image, installed through its own installer with demo data, light theme, in French and in English.
//
//   npm install --no-save puppeteer-core@25.12.0      (once: a browser driver, nothing is downloaded)
//   node scripts/docs-screenshots.mjs [fr] [en]       (default: both languages)
//
//   CHROME_PATH=...   the Chrome or Edge to drive (default: the usual places)
//   APP_PORT=3010     the port the throwaway platform listens on (default 3010)
//   KEEP=1            leave the throwaway platform running at the end (and its volumes)
//
// What it needs: Docker, a Chrome or Edge, and `npm install` done (the demo data are written by prisma/seed.ts).
// For each language it starts a platform of its own (the Docker Compose project `bdeshots-<lang>`, which never
// touches your own installation), installs it with the stand-in 42 API of e2e/mock-fortytwo.mjs, writes the demo
// data in that language (SEED_LOCALE), signs in as demo accounts by forging their session cookie, takes the
// pictures, and removes everything. The installer is a real run of the installer, in the language asked.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encode } from '@auth/core/jwt';
import puppeteer from 'puppeteer-core';
import { CLIENT_ID, CLIENT_SECRET, startMock } from '../e2e/mock-fortytwo.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'images');
const PORT = process.env.APP_PORT ?? '3010';
const MOCK_PORT = 4242;
const DB_PORT = 55432;
const LANGUAGES = process.argv.slice(2).filter((arg) => arg === 'fr' || arg === 'en');
if (LANGUAGES.length === 0) LANGUAGES.push('fr', 'en');

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
if (!executablePath) throw new Error('No Chrome or Edge found: set CHROME_PATH.');

const messages = {
  fr: JSON.parse(readFileSync(join(ROOT, 'messages', 'fr.json'), 'utf8')),
  en: JSON.parse(readFileSync(join(ROOT, 'messages', 'en.json'), 'utf8')),
};
const BDE_NAME = 'BDE Exemple';
const COOKIE = 'authjs.session-token';

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });

/** `docker compose` for the throwaway platform of one language. */
function compose(project, override, ...args) {
  return run(
    'docker',
    [
      'compose',
      '-p',
      project,
      '-f',
      'docker-compose.yml',
      '-f',
      'docker-compose.build.yml',
      '-f',
      override,
      ...args,
    ],
    {
      env: { ...process.env, APP_PORT: PORT, APP_BIND: '127.0.0.1' },
    },
  );
}

async function waitFor(check, what, seconds = 180) {
  for (let i = 0; i < seconds; i++) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function shootLanguage(browser, lang) {
  const t = messages[lang];
  const project = `bdeshots-${lang}`;
  const work = mkdtempSync(join(tmpdir(), 'bde-shots-'));
  const override = join(work, 'override.yml');
  writeFileSync(
    override,
    [
      'services:',
      '  app:',
      '    environment:',
      `      FORTYTWO_API_URL: http://host.docker.internal:${MOCK_PORT}`,
      '    extra_hosts:',
      "      - 'host.docker.internal:host-gateway'",
      '  postgres:',
      '    ports:',
      `      - '127.0.0.1:${DB_PORT}:5432'`,
      '',
    ].join('\n'),
  );
  const out = join(OUT, lang);
  mkdirSync(out, { recursive: true });
  const base = `http://localhost:${PORT}`;
  const log = (message) => console.log(`[${lang}] ${message}`);

  try {
    compose(project, override, 'down', '-v');
    log('starting the platform (the image is built the first time)…');
    compose(project, override, 'up', '--build', '-d');

    const code = await waitFor(() => {
      const logs = compose(project, override, 'logs', 'app');
      return /Code : ([A-Z0-9-]+)/.exec(logs)?.[1];
    }, 'the setup code');

    // ---- the installer, in this language -------------------------------------------------------------------------
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
    await page.setExtraHTTPHeaders({ 'Accept-Language': lang });
    await page.evaluateOnNewDocument(() => localStorage.setItem('theme', 'light'));
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await page.setViewport({ width: 1280, height: 800 });

    const text = () => page.evaluate(() => document.body.innerText);
    const waitText = (needle) =>
      page.waitForFunction((value) => document.body.innerText.includes(value), {}, needle);
    /** The card that holds the heading `title` of the settings page. */
    const shootSection = async (title, name) => {
      const handle = await page.evaluateHandle((wanted) => {
        const heading = [...document.querySelectorAll('h2, h3')].find(
          (el) => el.textContent?.trim() === wanted,
        );
        let node = heading;
        while (node && node.parentElement && node.getBoundingClientRect().height < 160)
          node = node.parentElement;
        return node?.closest('[data-slot="card"], section, form') ?? node;
      }, title);
      const element = handle.asElement();
      if (!element) throw new Error(`no section "${title}"`);
      await element.screenshot({ path: join(out, name), type: 'webp', quality: 86 });
      log(name);
    };

    const click = async (label) => {
      const find = (wanted) =>
        [...document.querySelectorAll('button, a')].find((el) =>
          el.textContent?.trim().startsWith(wanted),
        );
      // A step's title is also in the progress line, so it shows before the step's own buttons: wait for them.
      await page.waitForFunction(find, { timeout: 15_000 }, label).catch(async () => {
        throw new Error(`no button "${label}" (${(await text()).slice(0, 200)})`);
      });
      const handle = await page.evaluateHandle(find, label);
      await handle.asElement().click();
    };
    const save = (name, options = {}) =>
      page.screenshot({ path: join(out, name), type: 'webp', quality: 86, ...options });

    await page.goto(`${base}/${lang}/setup`, { waitUntil: 'networkidle0' });
    await page.type('#setup-code', code);
    await click(t.setup.nav.next);
    await page.waitForSelector('#setup-name');
    await page.type('#setup-name', BDE_NAME);
    await page.select('#setup-locale', lang).catch(() => undefined);
    await click(t.setup.nav.next);
    await page.waitForSelector('#setup-address');
    await click(t.setup.nav.next);
    await page.waitForSelector('#setup-uid');
    await page.type('#setup-uid', CLIENT_ID);
    await page.type('#setup-secret', CLIENT_SECRET);
    await click(t.setup.fortyTwo.verify);
    await page.waitForSelector('#setup-campus-search');
    await page.type('#setup-campus-search', 'nic');
    await waitText('France');
    await new Promise((resolve) => setTimeout(resolve, 600));
    await save('installer.webp');
    log('installer.webp');
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () => document.querySelector('#setup-main-campus')?.value === 'Nice',
    );
    await click(t.setup.nav.next);
    await page.waitForSelector('#setup-login');
    await page.type('#setup-login', 'demo-owner');
    await click(t.setup.owners.add);
    await page.waitForFunction(() => document.body.innerText.includes('demo-owner'));
    await click(t.setup.nav.next);
    await waitText(t.setup.modules.title);
    await click(t.setup.nav.next);
    // The notifications: Discord and e-mail set up, Slack left to set up (its column stays grey), and what goes where.
    await waitText(t.setup.notifications.matrixTitle);
    await page.type('#setup-discord', 'https://discord.com/api/webhooks/123456789/demo-webhook');
    await page.type('#setup-smtp-host', 'smtp.mon-ecole.fr');
    await page.type('#setup-smtp-from', 'bde@mon-ecole.fr');
    const names = t.setup.notifications.channelNames;
    for (const channel of [names.discord, names.email])
      await click(t.setup.notifications.checkColumn.replace('{channel}', channel));
    // the e-mail of the reminders is left out: the people in charge already get the calendar
    await page.click(
      `input[aria-label="${t.setup.notifications.types.eventReminder.name} — ${names.email}"]`,
    );
    await shootSection(t.setup.notifications.matrixTitle, 'notifications.webp');
    await click(t.setup.nav.next);
    await waitText(t.setup.summary.title);
    await click(t.setup.summary.install);
    await waitText(t.setup.done.title);
    log('installed');

    // ---- demo data in this language ------------------------------------------------------------------------------
    const password = run('docker', [
      'run',
      '--rm',
      '-v',
      `${project}_secrets:/s:ro`,
      'postgres:17-alpine',
      'cat',
      '/s/postgres_password',
    ]).trim();
    const databaseUrl = `postgresql://bde:${encodeURIComponent(password)}@127.0.0.1:${DB_PORT}/bde_network`;
    const seed = spawnSync('npx', ['tsx', 'prisma/seed.ts'], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl, SEED_LOCALE: lang },
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    if (seed.status !== 0)
      throw new Error(`the demo data could not be written:\n${seed.stdout}\n${seed.stderr}`);
    const sql = (statement) =>
      compose(
        project,
        override,
        'exec',
        '-T',
        'postgres',
        'psql',
        '-U',
        'bde',
        '-d',
        'bde_network',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        statement,
      );
    // The BDE of the pictures: its name, its categories and its two default roles in the language of the pictures.
    const categories =
      lang === 'fr'
        ? [
            ['soiree', 'Soirée'],
            ['sport', 'Sport'],
            ['wei', 'WEI'],
            ['partenariat', 'Partenariat'],
          ]
        : [
            ['soiree', 'Party'],
            ['sport', 'Sport'],
            ['wei', 'Integration weekend'],
            ['partenariat', 'Partnership'],
          ];
    const colors = { soiree: '#db2777', sport: '#16a34a', wei: '#ea580c', partenariat: '#2563eb' };
    const json = JSON.stringify(
      categories.map(([key, label]) => ({ key, label, color: colors[key] })),
    );
    sql(
      `UPDATE "PlatformSettings" SET config = jsonb_set(config, '{events,categories}', '${json}'::jsonb)`,
    );
    if (lang === 'en') {
      sql(
        `UPDATE "Role" SET name = 'Member', description = 'Read-only. The role offered to new members.' WHERE id = 'role-member'`,
      );
      sql(
        `UPDATE "Role" SET description = 'Every right, including those of future modules, except the audit log (owners only).' WHERE id = 'role-admin'`,
      );
    }
    // The platform was installed on a spare port (yours may be taken): the pictures show the usual address.
    sql(
      `UPDATE "PlatformSettings" SET environment = jsonb_set(environment, '{APP_URL}', '"http://localhost:3000"')`,
    );
    // The server keeps the settings in memory: restart it so that the pictures show what was just written.
    compose(project, override, 'restart', 'app');
    await waitFor(
      async () => (await fetch(`${base}/api/health`).catch(() => null))?.ok,
      'the platform to restart',
    );
    log('demo data written');

    // ---- the pages, signed in as demo accounts --------------------------------------------------------------------
    const secret = run('docker', [
      'run',
      '--rm',
      '-v',
      `${project}_secrets:/s:ro`,
      'postgres:17-alpine',
      'cat',
      '/s/auth_secret',
    ]).trim();
    const signInAs = async (login) => {
      await page.deleteCookie({ name: COOKIE, url: base });
      await page.setCookie({
        name: COOKIE,
        value: await encode({ token: { login }, secret, salt: COOKIE }),
        url: base,
        httpOnly: true,
      });
    };
    const open = async (path, { settle = 600 } = {}) => {
      await page.goto(`${base}/${lang}${path}`, { waitUntil: 'networkidle0' });
      await new Promise((resolve) => setTimeout(resolve, settle));
    };
    await page.setViewport({ width: 1280, height: 800 });
    await page.deleteCookie({ name: COOKIE, url: base });
    await open('', { settle: 400 });
    await save('login.webp');
    log('login.webp');

    await signInAs('demo-president');
    await open('/dashboard');
    await save('dashboard.webp');
    log('dashboard.webp');

    await page.setViewport({ width: 1280, height: 880 });
    await open('/events');
    await save('calendar.webp');
    log('calendar.webp');

    await page.setViewport({ width: 1280, height: 860 });
    await open('/events/demo-event-sport');
    await save('event.webp');
    log('event.webp');

    // The window that every action on a date of a series opens (here: saving an edit of the fourth date).
    const seriesDates = await page.$$eval('li a[href*="occ="]', (links) =>
      links.map((link) => link.getAttribute('href')),
    );
    await page.goto(`${base}${seriesDates[3]}`, { waitUntil: 'networkidle0' });
    await click(t.events.detail.edit);
    await page.waitForSelector('#location');
    await click(t.events.scope.edit.confirm);
    await page.waitForSelector('[role="dialog"]');
    await new Promise((resolve) => setTimeout(resolve, 500));
    await save('series-dialog.webp');
    log('series-dialog.webp');

    // The description of an event: the bar of formatting buttons, and the preview beside the field.
    await page.setViewport({ width: 1280, height: 900 });
    await open('/events/new');
    await page.waitForSelector('#description');
    const description =
      lang === 'fr'
        ? '## Au programme\n\n- **Accueil** à 19 h\n- Buffet et jeux de société\n\nInscription : [le formulaire](https://exemple.fr)'
        : '## On the programme\n\n- **Welcome** at 7 pm\n- Buffet and board games\n\nSign up: [the form](https://example.org)';
    await page.type('#description', description);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const block = await page.evaluateHandle(() =>
      document.getElementById('description').closest('div.sm\\:col-span-2'),
    );
    await block
      .asElement()
      .screenshot({ path: join(out, 'event-form.webp'), type: 'webp', quality: 86 });
    log('event-form.webp');

    await page.setViewport({ width: 1280, height: 800 });
    await open('/roles');
    await save('roles.webp');
    log('roles.webp');

    await open('/members');
    await save('members.webp');
    log('members.webp');

    await open('/profile');
    await save('profile.webp');
    log('profile.webp');

    await signInAs('demo-owner');
    await page.setViewport({ width: 1280, height: 1000 });
    await open('/settings');
    await save('settings.webp');
    log('settings.webp');
    await shootSection(t.settings.events.title, 'settings-events.webp');

    // The editor of the notifications: a Discord message made different from the others, as a BDE would write it.
    const board = lang === 'fr' ? 'Le Bureau' : 'The board';
    const quoted = (value) => value.replace(/'/g, "''");
    const written = JSON.stringify({
      emoji: '🥳',
      eyebrow: lang === 'fr' ? 'Nouvelle soirée au BDE' : 'New party at the BDE',
      above:
        lang === 'fr'
          ? '{@role:bureau} une nouvelle date vient de tomber !'
          : '{@role:bureau} a new date just dropped!',
      items: {
        order: 'custom',
        list: [
          { id: 'when', enabled: true },
          { id: 'where', enabled: true },
          { id: 'description', enabled: true },
          { id: 'category', enabled: false },
          { id: 'assignees', enabled: false },
          { id: 'repeats', enabled: false },
          {
            id: 'text:demo01',
            enabled: true,
            text:
              lang === 'fr'
                ? '**Venez nombreux**, entrée libre !'
                : '**Come in numbers**, free entry!',
          },
        ],
      },
      button: {
        enabled: true,
        label: lang === 'fr' ? "Je m'inscris" : 'Sign me up',
        url: 'https://forms.mon-ecole.fr/inscription',
      },
    });
    sql(
      `INSERT INTO "NotificationMention" (id, key, platform, kind, label, "externalId", "createdByLogin") VALUES ('demo-mention', 'bureau', 'discord', 'role', '${board}', '123456789012345678', 'demo-owner')`,
    );
    sql(
      `INSERT INTO "NotificationTemplate" (id, type, scope, content, version, "basedOnRevision", "updatedAt", "updatedByLogin") VALUES ('demo-template', 'eventConfirmed', 'discord', '${quoted(written)}'::jsonb, 1, 1, now(), 'demo-owner')`,
    );
    sql(
      `INSERT INTO "NotificationTemplateVersion" (id, type, scope, version, content, "basedOnRevision", action, "authorLogin") VALUES ('demo-template-v1', 'eventConfirmed', 'discord', 1, '${quoted(written)}'::jsonb, 1, 'save', 'demo-owner')`,
    );
    await page.setViewport({ width: 1280, height: 1100 });
    await open('/notifications?type=eventConfirmed&scope=discord', { settle: 2000 });
    await save('notification-editor.webp');
    log('notification-editor.webp');
    await page.setViewport({
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    await open('/notifications?type=eventConfirmed&scope=discord', { settle: 2000 });
    await click(t.templates.editor.viewPreview);
    await new Promise((resolve) => setTimeout(resolve, 800));
    // the card itself, not the head of the page
    await page.evaluate(() => {
      const card = document.querySelector('[data-testid="preview-discord"]');
      if (card) window.scrollTo(0, card.getBoundingClientRect().top + window.scrollY - 110);
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await save('notification-editor-mobile.webp');
    log('notification-editor-mobile.webp');
    sql(
      `DELETE FROM "NotificationTemplateVersion"; DELETE FROM "NotificationTemplate"; DELETE FROM "NotificationMention"`,
    );

    await page.setViewport({ width: 1280, height: 800 });
    await open('/audit-log');
    await save('audit-log.webp');
    log('audit-log.webp');

    await signInAs('demo-president');
    await page.setViewport({
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    await open('/dashboard');
    await save('mobile.webp');
    log('mobile.webp');

    await page.close();
  } finally {
    if (!process.env.KEEP) {
      try {
        compose(project, override, 'down', '-v');
      } catch {
        /* nothing to remove */
      }
    }
    rmSync(work, { recursive: true, force: true });
  }
}

const mock = await startMock(MOCK_PORT, ['demo-owner']);
const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
try {
  for (const lang of LANGUAGES) await shootLanguage(browser, lang);
  console.log('\nDone: docs/images/');
} finally {
  await browser.close();
  mock.close();
}
