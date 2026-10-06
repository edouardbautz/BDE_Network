// @vitest-environment node
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bdeConfigSchema } from '../src/config/schema';
import type { Runner, RunResult } from './docker';
import type { FetchLike } from './fortytwo';
import { parseEnv } from './files';
import type { MailTransport } from './notify-test';
import { AbortedError, InputClosedError, Prompts } from './prompts';
import {
  CAMPUSES,
  fakeApi,
  scriptedReader,
  type FakeApiOptions,
  type ScriptedReader,
} from './test-helpers';
import { runWizard, selectCampuses, type WizardDeps } from './wizard';

const DISCORD = 'https://discord.com/api/webhooks/123456/discord-secret-token';
const SLACK = 'https://hooks.slack.com/services/T0AAA111/B0BBB222/slacksecrettoken';
const SECRETS = ['s-s4t2ud-secret', 'discord-secret-token', 'slacksecrettoken', 'smtp-secret-pass'];

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bde-wizard-'));
  for (const name of ['docker-compose.yml', '.env.example', 'bde.config.yml']) {
    copyFileSync(join(process.cwd(), name), join(dir, name));
  }
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const ok = (stdout = ''): RunResult => ({ code: 0, stdout });

interface Harness {
  reader: ScriptedReader;
  deps: WizardDeps;
  discordPosts: unknown[];
  slackPosts: unknown[];
  dockerCalls: string[][];
  mails: Array<{ to: string; subject: string }>;
  api: ReturnType<typeof fakeApi>;
}

function harness(
  lines: string[],
  options: {
    api?: FakeApiOptions;
    docker?: 'ok' | 'no-docker' | 'start-fails' | 'never-healthy';
    discordStatus?: number;
    smtpVerify?: Array<'ok' | 'fail'>;
    slackLink?: string | null;
  } = {},
): Harness {
  const reader = scriptedReader(lines);
  const api = fakeApi({
    campuses: CAMPUSES,
    logins: ['jdupont', 'marie-d', 'paul'],
    ...options.api,
  });
  const discordPosts: unknown[] = [];
  const slackPosts: unknown[] = [];

  const fetchFn: FetchLike = async (url, init) => {
    if (url.startsWith('https://discord.com/')) {
      discordPosts.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: options.discordStatus ?? 204 });
    }
    if (url.startsWith('https://hooks.slack.com/')) {
      slackPosts.push(JSON.parse(String(init?.body)));
      return new Response('ok', { status: 200 });
    }
    return api.fetch(url, init);
  };

  const dockerCalls: string[][] = [];
  const run: Runner = async (args) => {
    dockerCalls.push(args);
    const mode = options.docker ?? 'ok';
    if (mode === 'no-docker' && args[0] === 'version') return { code: 1, stdout: '' };
    if (args[0] === 'version') return ok('29.3.1');
    if (args[0] === 'inspect' && args[1] !== '--format') {
      return ok(
        JSON.stringify([
          {
            Config: {
              Image: 'bde-network-setup',
              Labels: {
                'com.docker.compose.project': 'bde_network',
                'com.docker.compose.project.working_dir': '/home/me/BDE_Network',
              },
            },
          },
        ]),
      );
    }
    if (args[0] === 'run') return mode === 'start-fails' ? { code: 1, stdout: '' } : ok();
    if (args[0] === 'ps') return ok('app-container');
    if (args[0] === 'inspect') return ok(mode === 'never-healthy' ? 'starting' : 'healthy');
    return ok();
  };

  const mails: Array<{ to: string; subject: string }> = [];
  const verifies = [...(options.smtpVerify ?? ['ok'])];
  const transport = (): MailTransport => ({
    verify: async () => {
      if (verifies.shift() === 'fail') {
        throw Object.assign(new Error('Invalid login: 535 wrong-password rejected'), {
          code: 'EAUTH',
        });
      }
      return true;
    },
    sendMail: async (message) => {
      mails.push({ to: message.to, subject: message.subject });
      return {};
    },
  });

  let clock = 0;
  const deps: WizardDeps = {
    prompts: new Prompts(reader),
    projectDir: dir,
    fetchFn,
    sleep: async (ms) => void (clock += ms),
    transport,
    run,
    containerId: 'abc123',
    guessTimezone: () => undefined,
    now: () => new Date('2026-10-06T14:25:30Z'),
    slackLink: () =>
      options.slackLink === undefined
        ? 'https://api.slack.com/apps?new_app=1&manifest_yaml=X'
        : options.slackLink,
    startTimeoutMs: 12_000,
  };
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  return { reader, deps, discordPosts, slackPosts, dockerCalls, mails, api };
}

afterEach(() => vi.restoreAllMocks());

const env = () => parseEnv(readFileSync(join(dir, '.env'), 'utf8'));
const config = () =>
  load(readFileSync(join(dir, 'bde.config.yml'), 'utf8')) as ReturnType<
    typeof bdeConfigSchema.parse
  >;

/** The answers of a first install on this computer, up to the notification question. */
const FIRST = [
  '1', // language
  'BDE Les Lynx', // name
  '', // colour
  '', // message language
  'localhost', // address
  'u-s4t2ud-good', // UID
  's-s4t2ud-secret', // secret
  'nic', // search: Nice, Nicosia
  '1', // choose Nice
  'ok', // finish
  '', // time zone (from the campus)
  'jdupont', // owner
  '', // events module: yes
];

describe('a first installation', () => {
  const run = async (extra: string[] = ['4', '', '']) => {
    const h = harness([...FIRST, ...extra]);
    await runWizard(h.deps);
    return h;
  };

  it('writes .env and bde.config.yml from the answers', async () => {
    await run(['4', '', '']); // no notifications, write, no start

    expect(config()).toMatchObject({
      bde: {
        name: 'BDE Les Lynx',
        campus: 'Nice',
        timezone: 'Europe/Paris',
        defaultLocale: 'fr',
        accentColor: '#0f766e',
      },
      auth: { owners: ['jdupont'], allowedCampuses: ['Nice'] },
      modules: { enabled: ['events'] },
    });
    expect(env().get('FORTYTWO_CLIENT_ID')).toBe('u-s4t2ud-good');
    expect(env().get('FORTYTWO_CLIENT_SECRET')).toBe('s-s4t2ud-secret');
    expect(env().get('APP_URL')).toBe('http://localhost:3000');
  });

  it('generates the session secret and the database password', async () => {
    await run(['4', '', '']);

    expect(env().get('AUTH_SECRET')?.length).toBeGreaterThanOrEqual(32);
    expect(env().get('POSTGRES_PASSWORD')).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(env().get('DATABASE_URL')).toContain(env().get('POSTGRES_PASSWORD'));
    expect(env().get('POSTGRES_PASSWORD')).not.toBe('change-me');
  });

  it('writes a configuration the platform accepts, and keeps the comments of the template .env', async () => {
    await run(['4', '', '']);

    expect(bdeConfigSchema.safeParse(config()).success).toBe(true);
    expect(readFileSync(join(dir, '.env'), 'utf8')).toContain(
      '# --- Authentication (NextAuth + 42 OAuth) ---',
    );
  });

  it('never prints a secret, nor asks for one in the open', async () => {
    const h = await run(['1', DISCORD, 'o', '', '']);

    const transcript = h.reader.transcript();
    for (const secret of SECRETS) expect(transcript).not.toContain(secret);
    expect(transcript).not.toContain(env().get('AUTH_SECRET') ?? 'x-never');
    expect(transcript).not.toContain(env().get('POSTGRES_PASSWORD') ?? 'x-never');
    expect(h.reader.secretPrompts.map((prompt) => prompt.replace(/:\s*$/, ''))).toEqual([
      'Secret de l’application (la saisie reste invisible)',
      'URL du webhook Discord (la saisie reste invisible)',
    ]);
  });

  it('shows the exact redirect URL to declare on the 42 intra', async () => {
    const h = await run(['4', '', '']);
    expect(h.reader.transcript()).toContain('http://localhost:3000/api/auth/callback/42-school');
    expect(h.reader.transcript()).toContain('https://profile.intra.42.fr/oauth/applications/new');
  });

  it('checks the credentials with the 42 API before going on', async () => {
    const h = await run(['4', '', '']);
    expect(h.api.requests[0]).toBe('POST https://api.intra.42.fr/oauth/token');
    expect(h.reader.transcript()).toContain('✓ L’API 42 accepte ces identifiants.');
  });

  it('lets the person pick the campus from the list instead of typing it', async () => {
    const h = await run(['4', '', '']);
    const transcript = h.reader.transcript();
    expect(transcript).toContain('6 campus trouvés.');
    expect(transcript).toContain('1) Nice (France)');
    expect(transcript).toContain('2) Nicosia (Cyprus)');
    expect(transcript).toContain('Ajouté : Nice');
  });

  it('takes the time zone of the campus and offers it', async () => {
    const h = await run(['4', '', '']);
    expect(h.reader.transcript()).toContain('Fuseau déduit du campus Nice : Europe/Paris.');
    expect(h.reader.transcript()).toContain('Fuseau horaire [Europe/Paris]: ');
  });

  it('checks that the owner exists on the intra', async () => {
    const h = await run(['4', '', '']);
    expect(h.reader.transcript()).toContain('✓ jdupont existe sur l’intra 42.');
    expect(h.api.requests).toContain('GET https://api.intra.42.fr/v2/users/jdupont');
  });

  it('shows a summary without any secret, then writes only after the confirmation', async () => {
    const h = harness([...FIRST, '4', 'n']); // refuse at the summary
    await runWizard(h.deps);

    const transcript = h.reader.transcript();
    expect(transcript).toContain('Voici ce qui sera écrit :');
    expect(transcript).toContain('BDE Les Lynx');
    expect(transcript).toContain('••• enregistré');
    expect(transcript).toContain('Rien n’a été écrit.');
    expect(existsSync(join(dir, '.env'))).toBe(false);
    expect(readFileSync(join(dir, 'bde.config.yml'), 'utf8')).toContain('votre-login-42'); // untouched
  });

  it('does not talk of an earlier configuration when there is only the shipped template', async () => {
    const h = await run(['4', '', '']);
    expect(h.reader.transcript()).not.toContain('Une configuration existe déjà');
    expect(h.reader.transcript()).toContain('Nom du BDE (affiché dans l’interface): ');
  });
});

describe('starting the platform', () => {
  it('builds and starts it from a sibling container, waits for it, and gives the address', async () => {
    const h = harness([...FIRST, '4', '', '']);
    await runWizard(h.deps);

    const start = h.dockerCalls.find((call) => call[0] === 'run');
    expect(start).toBeDefined();
    expect(start).toContain('/home/me/BDE_Network:/home/me/BDE_Network');
    expect(start).toEqual(
      expect.arrayContaining([
        '-p',
        'bde_network',
        '--project-directory',
        '/home/me/BDE_Network',
        '-f',
        '/home/me/BDE_Network/docker-compose.yml',
        'up',
        '--build',
        '-d',
      ]),
    );
    const transcript = h.reader.transcript();
    expect(transcript).toContain('✓ La plateforme est démarrée.');
    expect(transcript).toContain(
      'Ouvrez http://localhost:3000 et cliquez sur « Se connecter avec 42 ».',
    );
  });

  it('writes the files before it starts anything', async () => {
    const h = harness([...FIRST, '4', '', '']);
    h.deps.run = async (args) => {
      if (args[0] === 'run') expect(existsSync(join(dir, '.env'))).toBe(true);
      return harness([]).deps.run(args);
    };
    await runWizard(h.deps);
  });

  it("names the platform's project after the folder of the project, as docker compose does", async () => {
    const h = harness([...FIRST, '4', '', '']);
    await runWizard(h.deps);
    const start = h.dockerCalls.find((call) => call[0] === 'run') ?? [];
    expect(start[start.indexOf('-p') + 1]).toBe('bde_network');
  });

  it('uses the COMPOSE_PROJECT_NAME written in .env, so the platform is not started twice under two names', async () => {
    writeFileSync(join(dir, '.env'), 'COMPOSE_PROJECT_NAME=lynx\n');
    const h = harness([...FIRST, '4', '', '']);
    await runWizard(h.deps);
    const start = h.dockerCalls.find((call) => call[0] === 'run') ?? [];
    expect(start[start.indexOf('-p') + 1]).toBe('lynx');
    expect(env().get('COMPOSE_PROJECT_NAME')).toBe('lynx'); // and .env keeps it
  });

  it('only prints the command when the person does not want it started now', async () => {
    const h = harness([...FIRST, '4', '', 'n']);
    await runWizard(h.deps);

    expect(h.dockerCalls.some((call) => call[0] === 'run')).toBe(false);
    expect(h.reader.transcript()).toContain('docker compose up --build -d');
  });

  it('says what to run when Docker cannot be reached from the assistant', async () => {
    const h = harness([...FIRST, '4', '', ''], { docker: 'no-docker' });
    await runWizard(h.deps);

    const transcript = h.reader.transcript();
    expect(transcript).toContain(
      'Je ne peux pas démarrer la plateforme depuis ici (Docker is not reachable from the assistant)',
    );
    expect(transcript).toContain('docker compose up --build -d');
    expect(existsSync(join(dir, '.env'))).toBe(true); // the configuration is written all the same
  });

  it('says what to run when the start fails', async () => {
    const h = harness([...FIRST, '4', '', ''], { docker: 'start-fails' });
    await runWizard(h.deps);
    expect(h.reader.transcript()).toContain('✗ Le démarrage a échoué (code 1)');
    expect(h.reader.transcript()).toContain('docker compose logs app');
  });

  it('shows the end of the log when the build fails, so the cause can be read', async () => {
    const h = harness([...FIRST, '4', '', ''], { docker: 'start-fails' });
    const base = h.deps.run;
    h.deps.run = async (args, options) =>
      args[0] === 'run'
        ? { code: 1, stdout: ['step 1', 'step 2', 'ERROR: npm ci failed', ''].join('\n') }
        : base(args, options);
    await runWizard(h.deps);

    expect(h.reader.transcript()).toContain('ERROR: npm ci failed');
    expect(h.reader.transcript()).toContain('✗ Le démarrage a échoué (code 1)');
  });

  it('does not show the log of a build that succeeds, and shows a dot while it runs', async () => {
    const h = harness([...FIRST, '4', '', '']);
    const base = h.deps.run;
    h.deps.run = async (args, options) => {
      if (args[0] === 'run') {
        options?.onTick?.();
        options?.onTick?.();
        return { code: 0, stdout: 'Step 1/30 : FROM node\nSuccessfully built abc' };
      }
      return base(args, options);
    };
    await runWizard(h.deps);

    expect(h.reader.transcript()).toContain('..');
    expect(h.reader.transcript()).not.toContain('Successfully built');
  });

  it('says so when the platform is slow to answer', async () => {
    const h = harness([...FIRST, '4', '', ''], { docker: 'never-healthy' });
    await runWizard(h.deps);
    expect(h.reader.transcript()).toContain('La plateforme met du temps à répondre');
    expect(h.reader.transcript()).not.toContain('✓ La plateforme est démarrée.');
  });

  it('always reminds how to run the assistant again', async () => {
    const h = harness([...FIRST, '4', '', 'n']);
    await runWizard(h.deps);
    expect(h.reader.transcript()).toContain(
      'docker compose -f docker-compose.setup.yml run --rm --build setup',
    );
  });
});

describe('answers that are not valid', () => {
  it('explains each one and asks again, writing nothing until all is right', async () => {
    const h = harness([
      '1',
      '', // empty name
      'BDE Les Lynx',
      'rouge', // bad colour
      '#0F766E',
      '', // message language
      'bde exemple fr', // bad address
      'localhost',
      'u-s4t2ud-good',
      's-s4t2ud-secret',
      'zzzz', // no campus matches
      'nic',
      '2', // Nicosia
      'ok',
      'Mars/Olympus', // bad time zone
      'Asia/Nicosia',
      'Bad_Login', // bad login
      'jdupont',
      'n', // no events
      '4',
      '',
      'n',
    ]);
    await runWizard(h.deps);

    const transcript = h.reader.transcript();
    expect(transcript).toContain('✗ Le nom doit faire entre 1 et 60 caractères');
    expect(transcript).toContain('✗ Une couleur hexadécimale est attendue');
    expect(transcript).toContain('✗ Adresse invalide.');
    expect(transcript).toContain('Aucun campus ne correspond à « zzzz ».');
    expect(transcript).toContain('✗ Fuseau horaire inconnu.');
    expect(transcript).toContain('✗ Un login 42 ne contient que des lettres');
    expect(config().bde.accentColor).toBe('#0f766e');
    expect(config().bde.campus).toBe('Nicosia');
    expect(config().bde.timezone).toBe('Asia/Nicosia');
    expect(config().modules.enabled).toEqual([]);
  });
});

describe('the 42 application credentials', () => {
  it('explains that 42 refuses wrong ones, and asks again until they are right', async () => {
    const h = harness([
      '1',
      'BDE',
      '',
      '',
      'localhost',
      'u-s4t2ud-good',
      'wrong-secret-x',
      'u-s4t2ud-good',
      's-s4t2ud-secret',
      'nic',
      '1',
      'ok',
      '',
      'jdupont',
      '',
      '4',
      '',
      'n',
    ]);
    await runWizard(h.deps);

    const transcript = h.reader.transcript();
    expect(transcript).toContain('✗ L’API 42 refuse ces identifiants (invalid_client).');
    expect(transcript).toContain('secret expiré ou régénéré depuis');
    expect(transcript).toContain('✓ L’API 42 accepte ces identifiants.');
    expect(env().get('FORTYTWO_CLIENT_SECRET')).toBe('s-s4t2ud-secret');
  });

  it('notices an UID and a secret that were swapped, before asking 42', async () => {
    const h = harness(
      ['1', 'BDE', '', '', 'localhost', 's-s4t2ud-secret', 'u-s4t2ud-good', 's-s4t2ud-secret'],
      {},
    );
    await expect(runWizard(h.deps)).rejects.toBeInstanceOf(InputClosedError);

    expect(h.reader.transcript()).toContain('✗ Il semble que l’UID et le secret soient inversés');
    expect(h.api.requests.filter((r) => r.includes('/oauth/token'))).toHaveLength(1);
  });

  it('never sends the credentials anywhere but the token request body', async () => {
    const h = harness([...FIRST, '4', '', 'n']);
    await runWizard(h.deps);
    expect(h.api.requests.join('\n')).not.toContain('s-s4t2ud-secret');
    expect(h.api.requests.join('\n')).not.toContain('u-s4t2ud-good');
  });

  it('says clearly when 42 cannot be reached, and lets the person retry or go on without the check', async () => {
    const h = harness(
      [
        '1',
        'BDE',
        '',
        '',
        'localhost',
        'u-s4t2ud-good',
        's-s4t2ud-secret',
        'n', // do not retry
        'o', // continue without checking
        'Nice', // campuses by hand
        'Europe/Paris',
        'jdupont',
        '',
        '4',
        '',
        'n',
      ],
      { api: { down: true } },
    );
    await runWizard(h.deps);

    const transcript = h.reader.transcript();
    expect(transcript).toContain('✗ Impossible de joindre l’API 42 (ENOTFOUND)');
    expect(transcript).toContain('L’API 42 est injoignable : je continue sans la liste des campus');
    expect(transcript).toContain('Je n’ai pas pu vérifier « jdupont »');
    expect(config().auth.allowedCampuses).toEqual(['Nice']);
    expect(config().bde.campus).toBe('Nice');
    expect(env().get('FORTYTWO_CLIENT_ID')).toBe('u-s4t2ud-good');
  });

  it('does not let the person go on with wrong credentials unless 42 simply cannot answer', async () => {
    const h = harness(['1', 'BDE', '', '', 'localhost', 'u-s4t2ud-good', 'wrong-secret-x'], {});
    await expect(runWizard(h.deps)).rejects.toBeInstanceOf(InputClosedError);
    expect(existsSync(join(dir, '.env'))).toBe(false);
  });

  it('waits out a "too many requests" answer and offers to retry', async () => {
    const h = harness(
      [
        '1',
        'BDE',
        '',
        '',
        'localhost',
        'u-s4t2ud-good',
        's-s4t2ud-secret',
        'o',
        'u-s4t2ud-good',
        's-s4t2ud-secret',
      ],
      { api: { tokenStatus: 429 } },
    );
    await expect(runWizard(h.deps)).rejects.toBeInstanceOf(InputClosedError);
    expect(h.reader.transcript()).toContain('L’API 42 demande de patienter');
  });
});

describe('the owners', () => {
  it('asks again when a login does not exist on the intra', async () => {
    const h = harness([
      ...FIRST.slice(0, 11),
      'nobody', // unknown
      'jdupont, marie-d', // two owners
      '',
      '4',
      '',
      'n',
    ]);
    await runWizard(h.deps);

    expect(h.reader.transcript()).toContain('✗ Le login « nobody » n’existe pas sur l’intra 42.');
    expect(config().auth.owners).toEqual(['jdupont', 'marie-d']);
  });

  it('asks again as long as one of several logins is unknown', async () => {
    const h = harness([...FIRST.slice(0, 11), 'jdupont, nobody', 'jdupont', '', '4', '', 'n']);
    await runWizard(h.deps);
    expect(config().auth.owners).toEqual(['jdupont']);
  });
});

describe('notifications', () => {
  it('Discord: sends a test message, asks if it arrived, and saves the webhook', async () => {
    const h = harness([...FIRST, '1', DISCORD, 'o', '', 'n']);
    await runWizard(h.deps);

    expect(h.discordPosts).toHaveLength(1);
    expect(h.discordPosts[0]).toMatchObject({
      content: expect.stringContaining('BDE Les Lynx'),
      allowed_mentions: { parse: [] },
    });
    expect(h.reader.transcript()).toContain('✓ Message de test envoyé.');
    expect(env().get('DISCORD_WEBHOOK_URL')).toBe(DISCORD);
    expect(Object.values(config().notifications)).toEqual(Array(5).fill('discord'));
  });

  it('Discord: refuses a webhook that is not a Discord one', async () => {
    const h = harness([...FIRST, '1', 'https://example.org/hook', DISCORD, 'o', '', 'n']);
    await runWizard(h.deps);
    expect(h.reader.transcript()).toContain('✗ Ce n’est pas une URL de webhook Discord');
  });

  it('Discord: when the message did not arrive, offers to enter the URL again or to go on', async () => {
    const h = harness([...FIRST, '1', DISCORD, 'n', '1', DISCORD, 'o', '', 'n']);
    await runWizard(h.deps);

    expect(h.discordPosts).toHaveLength(2);
    expect(h.reader.transcript()).toContain('Pas reçu. Que faire ?');
    expect(env().get('DISCORD_WEBHOOK_URL')).toBe(DISCORD);
  });

  it('Discord: can go on without a confirmed delivery', async () => {
    const h = harness([...FIRST, '1', DISCORD, 'n', '2', '', 'n']);
    await runWizard(h.deps);
    expect(env().get('DISCORD_WEBHOOK_URL')).toBe(DISCORD);
  });

  it('Discord: reports a refusal by the webhook, without showing its address', async () => {
    const h = harness([...FIRST, '1', DISCORD, '2', '', 'n'], { discordStatus: 404 });
    await runWizard(h.deps);

    expect(h.reader.transcript()).toContain('✗ Le message de test a échoué : HTTP 404');
    expect(h.reader.transcript()).not.toContain('discord-secret-token');
  });

  it('Slack: shows the pre-filled app link, tests the webhook and saves it', async () => {
    const h = harness([...FIRST, '2', SLACK, 'o', '', 'n']);
    await runWizard(h.deps);

    expect(h.reader.transcript()).toContain('https://api.slack.com/apps?new_app=1&manifest_yaml=X');
    expect(h.slackPosts).toEqual([{ text: expect.stringContaining('BDE Les Lynx') }]);
    expect(env().get('SLACK_WEBHOOK_URL')).toBe(SLACK);
    expect(Object.values(config().notifications)).toEqual(Array(5).fill('slack'));
  });

  it('Slack: refuses a webhook that is not a Slack one', async () => {
    const h = harness([...FIRST, '2', DISCORD, SLACK, 'o', '', 'n']);
    await runWizard(h.deps);
    expect(h.reader.transcript()).toContain('✗ Ce n’est pas une URL de webhook Slack');
  });

  it('e-mail: checks the SMTP server, sends a test mail, and saves the settings', async () => {
    const h = harness([
      ...FIRST,
      '3',
      'smtp.exemple.fr',
      '', // port 587
      'bde@exemple.fr', // user
      'smtp-secret-pass', // password
      '', // from = user
      'moi@exemple.fr', // test recipient
      'o', // received
      '',
      'n',
    ]);
    await runWizard(h.deps);

    expect(h.mails).toEqual([{ to: 'moi@exemple.fr', subject: 'Test BDE_Network : BDE Les Lynx' }]);
    expect(env().get('SMTP_HOST')).toBe('smtp.exemple.fr');
    expect(env().get('SMTP_PORT')).toBe('587');
    expect(env().get('SMTP_USER')).toBe('bde@exemple.fr');
    expect(env().get('SMTP_PASSWORD')).toBe('smtp-secret-pass');
    expect(env().get('SMTP_FROM')).toBe('bde@exemple.fr');
    expect(Object.values(config().notifications)).toEqual(Array(5).fill('email'));
    expect(h.reader.transcript()).not.toContain('smtp-secret-pass');
    expect(h.reader.secretPrompts.some((p) => p.includes('SMTP'))).toBe(true);
  });

  it('e-mail: a refused login is explained, without the password, and the details can be entered again', async () => {
    const h = harness(
      [
        ...FIRST,
        '3',
        'smtp.exemple.fr',
        '',
        'bde@exemple.fr',
        'wrong-password',
        '',
        '1', // enter again
        'smtp.exemple.fr',
        '',
        'bde@exemple.fr',
        'smtp-secret-pass',
        '',
        'moi@exemple.fr',
        'o',
        '',
        'n',
      ],
      { smtpVerify: ['fail', 'ok'] },
    );
    await runWizard(h.deps);

    const transcript = h.reader.transcript();
    expect(transcript).toContain(
      '✗ Le message de test a échoué : EAUTH: Invalid login: 535 *** rejected',
    );
    expect(transcript).not.toContain('wrong-password');
    expect(transcript).not.toContain('smtp-secret-pass');
    expect(env().get('SMTP_PASSWORD')).toBe('smtp-secret-pass');
  });

  it('e-mail: asks no password for a server that wants no login', async () => {
    const h = harness([
      ...FIRST,
      '3',
      'localhost',
      '1025',
      '',
      'bde@exemple.fr',
      'moi@exemple.fr',
      'o',
      '',
      'n',
    ]);
    await runWizard(h.deps);
    expect(env().get('SMTP_PORT')).toBe('1025');
    expect(env().get('SMTP_USER')).toBe('');
    expect(h.reader.secretPrompts.every((p) => !p.includes('SMTP'))).toBe(true);
  });

  it('e-mail: refuses a bad port and a bad sender address', async () => {
    const h = harness([
      ...FIRST,
      '3',
      'smtp.exemple.fr',
      '99999',
      '587',
      '',
      'pas une adresse',
      'bde@exemple.fr',
      'moi@exemple.fr',
      'o',
      '',
      'n',
    ]);
    await runWizard(h.deps);
    expect(h.reader.transcript()).toContain('✗ Un numéro de port entre 1 et 65535 est attendu.');
    expect(h.reader.transcript()).toContain('✗ Une adresse e-mail est attendue');
  });

  it('none: turns every notification off', async () => {
    const h = harness([...FIRST, '4', '', 'n']);
    await runWizard(h.deps);
    expect(Object.values(config().notifications)).toEqual(Array(5).fill('none'));
  });

  it('writes no webhook or SMTP setting for a channel that was not chosen', async () => {
    const h = harness([...FIRST, '4', '', 'n']);
    await runWizard(h.deps);
    expect(env().get('DISCORD_WEBHOOK_URL')).toBe('');
    expect(env().get('SLACK_WEBHOOK_URL')).toBe('');
    expect(env().get('SMTP_HOST')).toBe('');
  });
});

describe('the address', () => {
  it('for a domain name, declares https, adds no port, and reminds of the HTTPS proxy', async () => {
    const lines = [...FIRST];
    lines[4] = 'bde.exemple.fr';
    const h = harness([...lines, '4', '', 'n']);
    await runWizard(h.deps);

    expect(env().get('APP_URL')).toBe('https://bde.exemple.fr');
    expect(readFileSync(join(dir, '.env'), 'utf8')).toContain('# APP_PORT=3000');
    const transcript = h.reader.transcript();
    expect(transcript).toContain('https://bde.exemple.fr/api/auth/callback/42-school');
    expect(transcript).toContain('Pour un nom de domaine, mettez un proxy HTTPS');
  });

  it('warns about http for a domain name', async () => {
    const lines = [...FIRST];
    lines[4] = 'http://bde.exemple.fr';
    const h = harness([...lines, '4', '', 'n']);
    await runWizard(h.deps);
    expect(h.reader.transcript()).toContain('Vous avez choisi http (sans chiffrement)');
    expect(env().get('APP_URL')).toBe('http://bde.exemple.fr');
  });

  it('for another local port, writes APP_PORT so that the platform is published there', async () => {
    const lines = [...FIRST];
    lines[4] = 'localhost:3001';
    const h = harness([...lines, '4', '', 'n']);
    await runWizard(h.deps);

    expect(env().get('APP_URL')).toBe('http://localhost:3001');
    expect(env().get('APP_PORT')).toBe('3001');
    expect(h.reader.transcript()).toContain('http://localhost:3001/api/auth/callback/42-school');
  });
});

describe('English', () => {
  it('speaks English from the first question on, and writes the messages language it was asked', async () => {
    const lines = [...FIRST];
    lines[0] = '2';
    lines[3] = '2'; // messages in English
    const h = harness([...lines, '4', '', 'n']);
    await runWizard(h.deps);

    const transcript = h.reader.transcript();
    expect(transcript).toContain('BDE_Network setup assistant');
    expect(transcript).toContain('Step 3/9 — 42 OAuth application');
    expect(transcript).toContain('✓ The 42 API accepts these credentials.');
    expect(transcript).toContain('Write these files? (Y/n)');
    expect(transcript).not.toContain('Étape');
    expect(config().bde.defaultLocale).toBe('en');
    expect(readFileSync(join(dir, 'bde.config.yml'), 'utf8')).toContain(
      'written by the setup assistant',
    );
  });
});

describe('campuses', () => {
  const campuses = CAMPUSES.map((c) => ({
    id: c.id,
    name: c.name,
    country: c.country,
    timeZone: c.time_zone,
  }));
  const select = async (lines: string[], preselected: string[] = []) => {
    const reader = scriptedReader(lines);
    const prompts = new Prompts(reader);
    return { chosen: await selectCampuses(prompts, campuses, preselected), reader };
  };

  it('adds a campus straight away when the search finds only one', async () => {
    const { chosen, reader } = await select(['seoul', 'ok']);
    expect(chosen).toEqual(['Seoul']);
    expect(reader.transcript()).toContain('Ajouté : Seoul');
  });

  it('finds a name whatever the case and the accents', async () => {
    expect((await select(['MONTREAL', 'ok'])).chosen).toEqual(['Montréal']);
  });

  it('lists several matches and takes the numbers typed, one or several', async () => {
    const { chosen, reader } = await select(['ni', '1,2', 'ok']);
    expect(chosen).toEqual(['Nice', 'Nicosia']);
    expect(reader.transcript()).toContain('Résultats pour « ni » (tapez un numéro) :');
  });

  it('builds a selection of several campuses over several searches', async () => {
    expect((await select(['paris', 'lyon', 'seoul', 'ok'])).chosen).toEqual([
      'Paris',
      'Lyon',
      'Seoul',
    ]);
  });

  it('removes a choice with -number', async () => {
    const { chosen, reader } = await select(['paris', 'lyon', '-1', 'ok']);
    expect(chosen).toEqual(['Lyon']);
    expect(reader.transcript()).toContain('Retiré : Paris');
  });

  it('says a campus is already chosen instead of adding it twice', async () => {
    const { chosen, reader } = await select(['paris', 'paris', 'ok']);
    expect(chosen).toEqual(['Paris']);
    expect(reader.transcript()).toContain('Paris est déjà dans la liste.');
  });

  it('accepts every campus with "tous"', async () => {
    expect((await select(['tous'])).chosen).toEqual([]);
    expect((await select(['all'])).chosen).toEqual([]);
  });

  it('wants at least one campus before "ok", and says so', async () => {
    const { chosen, reader } = await select(['ok', 'paris', 'ok']);
    expect(chosen).toEqual(['Paris']);
    expect(reader.transcript()).toContain('Choisissez au moins un campus (ou tapez « tous »).');
  });

  it('finishes on an empty line when something is chosen', async () => {
    expect((await select(['paris', ''])).chosen).toEqual(['Paris']);
  });

  it('starts from the campuses already chosen, found by name whatever the case', async () => {
    const { chosen, reader } = await select(['ok'], ['nice', 'Lyon', 'Atlantide']);
    expect(chosen).toEqual(['Nice', 'Lyon']);
    expect(reader.transcript()).toContain('Choisis : [1] Nice, [2] Lyon');
  });

  it('treats a number with no list to choose from as a search, and keeps the list after an out-of-range number', async () => {
    const { chosen, reader } = await select(['3', 'ni', '9', '1', 'ok']);
    expect(chosen).toEqual(['Nice']);
    expect(reader.transcript()).toContain('Aucun campus ne correspond à « 3 ».');
    expect(reader.transcript()).toContain('Tapez un numéro entre 1 et 2.');
  });

  it('asks which campus is the main one when several are chosen', async () => {
    const lines = [...FIRST];
    lines.splice(7, 4, 'paris', 'nice', 'ok', '2', ''); // two campuses, main = Nice, time zone default
    const h = harness([...lines, '', '4', '', 'n']);
    await runWizard(h.deps);

    expect(config().auth.allowedCampuses).toEqual(['Paris', 'Nice']);
    expect(config().bde.campus).toBe('Nice');
    expect(h.reader.transcript()).toContain('Campus principal du bureau');
  });

  it('with "tous", asks for the name of the main campus and writes no campus filter', async () => {
    const lines = [...FIRST];
    lines.splice(7, 4, 'tous', 'Paris', 'Europe/Paris');
    const h = harness([...lines, '', '4', '', 'n']);
    await runWizard(h.deps);

    expect(config().auth.allowedCampuses).toEqual([]);
    expect(config().bde.campus).toBe('Paris');
  });
});

describe('running it again', () => {
  const prior = {
    config: [
      'bde:',
      "  name: 'BDE Ancien'",
      "  campus: 'Nice'",
      "  timezone: 'Europe/Paris'",
      "  defaultLocale: 'fr'",
      "  accentColor: '#123456'",
      "  logoPath: '/mon-logo.png'",
      "  contactEmail: 'bureau@exemple.fr'",
      'auth:',
      '  owners:',
      "    - 'jdupont'",
      '  allowedCampuses:',
      "    - 'Nice'",
      'modules:',
      "  enabled: ['events', 'finances']",
      'events:',
      '  categories:',
      "    - { key: 'concert', label: 'Concert', color: '#654321' }",
      '  reminderHour: 9',
      'notifications:',
      "  memberPending: 'discord'",
      "  memberApproved: 'discord'",
      "  memberRemoved: 'discord'",
      "  eventConfirmed: 'discord'",
      "  eventReminder: 'discord'",
      '',
    ].join('\n'),
    env: [
      '# my own comment',
      'POSTGRES_USER=club',
      'POSTGRES_PASSWORD=OldPassword123456789abc',
      'POSTGRES_DB=club_db',
      `AUTH_SECRET=${'B'.repeat(43)}=`,
      'FORTYTWO_CLIENT_ID=u-s4t2ud-good',
      'FORTYTWO_CLIENT_SECRET=s-s4t2ud-secret',
      `DISCORD_WEBHOOK_URL=${DISCORD}`,
      'APP_URL=https://bde.exemple.fr',
      'MY_CUSTOM_SETTING=keep-me',
      '',
    ].join('\n'),
  };
  const install = () => {
    writeFileSync(join(dir, 'bde.config.yml'), prior.config);
    writeFileSync(join(dir, '.env'), prior.env);
  };

  /** Enter on every question: keep what is there. */
  const ENTERS = [
    '', // language (from the config: French)
    '', // name
    '', // colour
    '', // messages language
    '', // address
    '', // keep the saved 42 credentials
    'ok', // campuses (already chosen)
    '', // time zone
    '', // owners
    '', // events
    '', // channel (Discord)
    '', // keep the saved webhook
    'o', // received
    '', // write
    'n', // do not start
  ];

  it('proposes every current value as the default, and a run of Enter changes nothing', async () => {
    install();
    const h = harness(ENTERS);
    await runWizard(h.deps);

    const transcript = h.reader.transcript();
    expect(transcript).toContain('Une configuration existe déjà');
    expect(transcript).toContain('Nom du BDE (affiché dans l’interface) [BDE Ancien]: ');
    expect(config()).toMatchObject({
      bde: {
        name: 'BDE Ancien',
        campus: 'Nice',
        timezone: 'Europe/Paris',
        defaultLocale: 'fr',
        accentColor: '#123456',
      },
      auth: { owners: ['jdupont'], allowedCampuses: ['Nice'] },
    });
  });

  it('speaks the language of the existing configuration by default', async () => {
    writeFileSync(
      join(dir, 'bde.config.yml'),
      prior.config.replace("defaultLocale: 'fr'", "defaultLocale: 'en'"),
    );
    writeFileSync(join(dir, '.env'), prior.env);
    const h = harness(ENTERS);
    await runWizard(h.deps);
    expect(h.reader.transcript()).toContain('> [2] ');
    expect(h.reader.transcript()).toContain('BDE_Network setup assistant');
  });

  it('keeps the session secret and the database password: changing them would break the database', async () => {
    install();
    await runWizard(harness(ENTERS).deps);

    expect(env().get('AUTH_SECRET')).toBe(`${'B'.repeat(43)}=`);
    expect(env().get('POSTGRES_PASSWORD')).toBe('OldPassword123456789abc');
    expect(env().get('POSTGRES_USER')).toBe('club');
    expect(env().get('POSTGRES_DB')).toBe('club_db');
  });

  it('keeps every other setting and comment of .env, and the parts of the configuration it does not ask', async () => {
    install();
    await runWizard(harness(ENTERS).deps);

    expect(readFileSync(join(dir, '.env'), 'utf8')).toContain('# my own comment');
    expect(env().get('MY_CUSTOM_SETTING')).toBe('keep-me');
    expect(config().bde).toMatchObject({
      logoPath: '/mon-logo.png',
      contactEmail: 'bureau@exemple.fr',
    });
    expect(config().modules.enabled).toEqual(['finances', 'events']);
    expect(config().events).toEqual({
      categories: [{ key: 'concert', label: 'Concert', color: '#654321' }],
      reminderHour: 9,
    });
  });

  it('changes only what was changed', async () => {
    install();
    const lines = [...ENTERS];
    lines[1] = 'BDE Nouveau';
    lines[2] = '#abcdef';
    await runWizard(harness(lines).deps);

    expect(config().bde).toMatchObject({
      name: 'BDE Nouveau',
      accentColor: '#abcdef',
      campus: 'Nice',
    });
    expect(env().get('MY_CUSTOM_SETTING')).toBe('keep-me');
  });

  it('backs up the files it replaces, and says where', async () => {
    install();
    const lines = [...ENTERS];
    lines[1] = 'BDE Nouveau';
    const h = harness(lines);
    await runWizard(h.deps);

    const backup = join(dir, '.setup-backups', '20261006-142530');
    expect(readFileSync(join(backup, 'bde.config.yml'), 'utf8')).toBe(prior.config);
    expect(readdirSync(backup)).toContain('bde.config.yml');
    expect(h.reader.transcript()).toContain(
      `Anciennes versions sauvegardées dans ${join('.setup-backups', '20261006-142530')}`,
    );
  });

  it('rewrites and backs up nothing when nothing changed', async () => {
    install();
    await runWizard(harness(ENTERS).deps);
    const afterFirst = readFileSync(join(dir, '.env'), 'utf8');

    const again = harness(ENTERS);
    await runWizard(again.deps);

    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(afterFirst);
    expect(again.reader.transcript()).toContain('✓ Fichiers écrits : —');
    expect(readdirSync(join(dir, '.setup-backups'))).toHaveLength(1); // only the first run's backup
  });

  it('offers to keep the saved 42 credentials, and checks them again with 42', async () => {
    install();
    const h = harness(ENTERS);
    await runWizard(h.deps);

    expect(h.reader.transcript()).toContain('Garder l’UID et le secret déjà enregistrés ? (O/n)');
    expect(h.api.requests[0]).toBe('POST https://api.intra.42.fr/oauth/token');
    expect(h.reader.secretPrompts.some((p) => p.includes('Secret de l’application'))).toBe(false);
  });

  it('asks for new credentials when the person does not keep the saved ones, or 42 now refuses them', async () => {
    install();
    const lines = [...ENTERS];
    lines.splice(5, 1, 'n', 'u-s4t2ud-good', 's-s4t2ud-secret');
    const h = harness(lines);
    await runWizard(h.deps);
    expect(h.reader.secretPrompts.some((p) => p.includes('Secret de l’application'))).toBe(true);

    // the saved secret has expired since
    install();
    const expired = harness(
      [
        '',
        '',
        '',
        '',
        '',
        '',
        'u-s4t2ud-good',
        's-s4t2ud-secret',
        'ok',
        '',
        '',
        '',
        '',
        '',
        'o',
        '',
        'n',
      ],
      {
        api: { credentials: { 'u-s4t2ud-good': 'a-new-secret-1' } },
      },
    );
    await expect(runWizard(expired.deps)).rejects.toBeInstanceOf(InputClosedError);
    expect(expired.reader.transcript()).toContain('✗ L’API 42 refuse ces identifiants');
  });

  it('keeps the saved webhook when asked to, without asking for it again', async () => {
    install();
    const h = harness(ENTERS);
    await runWizard(h.deps);

    expect(env().get('DISCORD_WEBHOOK_URL')).toBe(DISCORD);
    expect(h.discordPosts).toHaveLength(1); // the saved webhook is still tested
    expect(h.reader.transcript()).not.toContain('discord-secret-token');
  });

  it('can switch the channel, leaving the old webhook in .env', async () => {
    install();
    const lines = [...ENTERS];
    lines.splice(10, 3, '4'); // channel: none
    await runWizard(harness(lines).deps);

    expect(Object.values(config().notifications)).toEqual(Array(5).fill('none'));
    expect(env().get('DISCORD_WEBHOOK_URL')).toBe(DISCORD);
  });

  it('offers to keep customised notification settings when they are not all the same', async () => {
    writeFileSync(
      join(dir, 'bde.config.yml'),
      prior.config
        .replace("memberPending: 'discord'", "memberPending: 'email'")
        .replace("eventReminder: 'discord'", "eventReminder: 'slack'"),
    );
    writeFileSync(join(dir, '.env'), prior.env);
    const lines = [...ENTERS];
    lines.splice(10, 3, ''); // default = keep
    const h = harness(lines);
    await runWizard(h.deps);

    expect(h.reader.transcript()).toContain(
      'Garder la configuration actuelle (réglages personnalisés)',
    );
    expect(config().notifications).toEqual({
      memberPending: 'email',
      memberApproved: 'discord',
      memberRemoved: 'discord',
      eventConfirmed: 'discord',
      eventReminder: 'slack',
    });
  });

  it('does not propose to keep settings when they are all the same', async () => {
    install();
    const h = harness(ENTERS);
    await runWizard(h.deps);
    expect(h.reader.transcript()).not.toContain('Garder la configuration actuelle');
  });

  it('says that the secrets were kept', async () => {
    install();
    const h = harness(ENTERS);
    await runWizard(h.deps);
    expect(h.reader.transcript()).toContain('déjà enregistrés sont conservés');
  });

  it('warns when bde.config.local.yml would override what it writes', async () => {
    install();
    writeFileSync(join(dir, 'bde.config.local.yml'), 'bde: {}\n');
    const h = harness(ENTERS);
    await runWizard(h.deps);
    expect(h.reader.transcript()).toContain(
      'bde.config.local.yml existe et remplace bde.config.yml',
    );
  });
});

describe('interruption', () => {
  it('Ctrl+C at any question writes nothing', async () => {
    for (let at = 1; at <= FIRST.length; at++) {
      const h = harness(FIRST.slice(0, at));
      h.deps.prompts.reader.readLine = async () => {
        throw new AbortedError();
      };
      // answers run out after `at` lines: the next question is interrupted
      const reader = scriptedReader(FIRST.slice(0, at));
      const interrupting = {
        ...reader,
        readLine: async (prompt: string) => {
          if (reader.remaining().length === 0) throw new AbortedError();
          return reader.readLine(prompt);
        },
        readSecret: async (prompt: string) => {
          if (reader.remaining().length === 0) throw new AbortedError();
          return reader.readSecret(prompt);
        },
      };
      h.deps.prompts = new Prompts(interrupting);

      await expect(runWizard(h.deps)).rejects.toBeInstanceOf(AbortedError);
      expect(existsSync(join(dir, '.env'))).toBe(false);
      expect(existsSync(join(dir, '.setup-backups'))).toBe(false);
      expect(readFileSync(join(dir, 'bde.config.yml'), 'utf8')).toContain('votre-login-42');
    }
  });

  it('running out of answers writes nothing either', async () => {
    const h = harness(FIRST);
    await expect(runWizard(h.deps)).rejects.toBeInstanceOf(InputClosedError);
    expect(existsSync(join(dir, '.env'))).toBe(false);
  });

  it('leaves existing files untouched when interrupted at the summary', async () => {
    writeFileSync(join(dir, '.env'), 'KEEP=1\n');
    const before = readFileSync(join(dir, 'bde.config.yml'), 'utf8');
    const h = harness([...FIRST, '4', 'n']);
    await runWizard(h.deps);

    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe('KEEP=1\n');
    expect(readFileSync(join(dir, 'bde.config.yml'), 'utf8')).toBe(before);
    expect(existsSync(join(dir, '.setup-backups'))).toBe(false);
  });
});

describe('secrets on screen', () => {
  it('never appear in the transcript of a complete run with every channel', async () => {
    const h = harness([
      ...FIRST,
      '3',
      'smtp.exemple.fr',
      '587',
      'bde@exemple.fr',
      'smtp-secret-pass',
      'bde@exemple.fr',
      'moi@exemple.fr',
      'o',
      '',
      '',
    ]);
    await runWizard(h.deps);

    for (const secret of [
      ...SECRETS,
      env().get('AUTH_SECRET') ?? 'x-never',
      env().get('POSTGRES_PASSWORD') ?? 'x-never',
    ]) {
      expect(h.reader.transcript()).not.toContain(secret);
    }
    // the docker arguments hold no secret either
    expect(h.dockerCalls.flat().join(' ')).not.toContain('secret');
  });
});

describe('what is taken from an earlier run, edge by edge', () => {
  const baseConfig = (extra = '') =>
    [
      'bde:',
      "  name: 'BDE Ancien'",
      "  campus: 'Nice'",
      "  timezone: 'Europe/Paris'",
      "  defaultLocale: 'fr'",
      "  accentColor: '#123456'",
      "  logoPath: '/logo.svg'",
      'auth:',
      '  owners:',
      "    - 'jdupont'",
      '  allowedCampuses:',
      "    - 'Nice'",
      'modules:',
      "  enabled: ['events']",
      'events:',
      '  categories:',
      "    - { key: 'concert', label: 'Concert', color: '#654321' }",
      '  reminderHour: 9',
      'notifications:',
      extra || "  memberPending: 'none'",
      '',
    ].join('\n');
  const writeConfig = (text: string) => writeFileSync(join(dir, 'bde.config.yml'), text);

  it('does not offer to keep 42 credentials when only the UID was saved', async () => {
    writeConfig(baseConfig());
    writeFileSync(join(dir, '.env'), 'FORTYTWO_CLIENT_ID=u-s4t2ud-good\n');
    const h = harness([
      '',
      '',
      '',
      '',
      '',
      'u-s4t2ud-good',
      's-s4t2ud-secret',
      'ok',
      '',
      '',
      '',
      '',
      '',
      'n',
    ]);
    await runWizard(h.deps);
    expect(h.reader.transcript()).not.toContain('Garder l’UID et le secret');
    expect(h.reader.transcript()).toContain('UID de l’application (FORTYTWO_CLIENT_ID): ');
  });

  it('counts an .env that only has credentials as an earlier configuration', async () => {
    writeFileSync(join(dir, '.env'), 'FORTYTWO_CLIENT_ID=u-s4t2ud-good\n');
    const h = harness(['1']);
    await expect(runWizard(h.deps)).rejects.toBeInstanceOf(InputClosedError);
    expect(h.reader.transcript()).toContain('Une configuration existe déjà');
  });

  it('counts a session secret alone as an earlier configuration, but not the placeholders of the template', async () => {
    writeFileSync(join(dir, '.env'), `AUTH_SECRET=${'x'.repeat(40)}\n`);
    const h1 = harness(['1']);
    await expect(runWizard(h1.deps)).rejects.toBeInstanceOf(InputClosedError);
    expect(h1.reader.transcript()).toContain('Une configuration existe déjà');

    writeFileSync(
      join(dir, '.env'),
      'AUTH_SECRET=\nFORTYTWO_CLIENT_ID=change-me\nPOSTGRES_PASSWORD=change-me\n',
    );
    const h2 = harness(['1']);
    await expect(runWizard(h2.deps)).rejects.toBeInstanceOf(InputClosedError);
    expect(h2.reader.transcript()).not.toContain('Une configuration existe déjà');
  });

  it('counts a configuration that is not the shipped template as an earlier one', async () => {
    writeConfig(baseConfig());
    const h = harness(['1']);
    await expect(runWizard(h.deps)).rejects.toBeInstanceOf(InputClosedError);
    expect(h.reader.transcript()).toContain('Une configuration existe déjà');
  });

  it('does not keep a database password that is still the placeholder, and makes a new one', async () => {
    writeFileSync(join(dir, '.env'), 'POSTGRES_PASSWORD=change-me\n');
    const h = harness([...FIRST, '4', '', 'n']);
    await runWizard(h.deps);
    expect(env().get('POSTGRES_PASSWORD')).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(h.reader.transcript()).toContain('ont été générés automatiquement');
  });

  it('keeps a session secret of exactly 32 characters, and replaces a shorter one', async () => {
    writeFileSync(
      join(dir, '.env'),
      `AUTH_SECRET=${'k'.repeat(32)}\nPOSTGRES_PASSWORD=KeepThisPassword123456\n`,
    );
    await runWizard(harness([...FIRST, '4', '', 'n']).deps);
    expect(env().get('AUTH_SECRET')).toBe('k'.repeat(32));
    expect(env().get('POSTGRES_PASSWORD')).toBe('KeepThisPassword123456');

    writeFileSync(
      join(dir, '.env'),
      `AUTH_SECRET=${'k'.repeat(31)}\nPOSTGRES_PASSWORD=KeepThisPassword123456\n`,
    );
    const h = harness([...FIRST, '4', '', 'n']);
    await runWizard(h.deps);
    expect(env().get('AUTH_SECRET')).not.toBe('k'.repeat(31));
    expect(env().get('AUTH_SECRET')?.length).toBeGreaterThanOrEqual(32);
    expect(h.reader.transcript()).toContain('ont été générés automatiquement'); // one of the two was new
  });

  it('proposes the language of the messages the platform already uses, and ignores a language it does not know', async () => {
    writeConfig(baseConfig().replace("defaultLocale: 'fr'", "defaultLocale: 'en'"));
    const en = harness(['', '', '', '', '']);
    await expect(runWizard(en.deps)).rejects.toBeInstanceOf(InputClosedError);
    expect(en.reader.transcript()).toContain('BDE_Network setup assistant');

    writeConfig(baseConfig().replace("defaultLocale: 'fr'", "defaultLocale: 'de'"));
    const de = harness(['', '', '', '', '']);
    await expect(runWizard(de.deps)).rejects.toBeInstanceOf(InputClosedError);
    expect(de.reader.transcript()).toContain("Assistant d'installation de BDE_Network");
  });

  it.each([
    ['discord', '1'],
    ['slack', '2'],
    ['email', '3'],
  ] as const)(
    'proposes the channel that all five notifications already use (%s)',
    async (channel, number) => {
      const all = [
        'memberPending',
        'memberApproved',
        'memberRemoved',
        'eventConfirmed',
        'eventReminder',
      ]
        .map((key) => `  ${key}: '${channel}'`)
        .join('\n');
      writeConfig(baseConfig(all));
      writeFileSync(join(dir, '.env'), 'APP_URL=http://localhost:3000\n');
      const h = harness([
        '',
        '',
        '',
        '',
        '',
        'u-s4t2ud-good',
        's-s4t2ud-secret',
        'ok',
        '',
        '',
        '',
        '',
      ]);
      await expect(runWizard(h.deps)).rejects.toBeInstanceOf(InputClosedError);
      expect(h.reader.transcript()).toContain(`> [${number}] `);
    },
  );

  it('ignores a notification channel it does not know, and defaults to none', async () => {
    writeConfig(baseConfig("  memberPending: 'carrier-pigeon'"));
    const h = harness([
      '',
      '',
      '',
      '',
      '',
      'u-s4t2ud-good',
      's-s4t2ud-secret',
      'ok',
      '',
      '',
      '',
      '',
    ]);
    await expect(runWizard(h.deps)).rejects.toBeInstanceOf(InputClosedError);
    expect(h.reader.transcript()).toContain('> [4] ');
    expect(h.reader.transcript()).not.toContain('Garder la configuration actuelle');
  });

  it('does not say the time zone was guessed from the campus when one is already saved', async () => {
    writeConfig(baseConfig());
    writeFileSync(
      join(dir, '.env'),
      'FORTYTWO_CLIENT_ID=u-s4t2ud-good\nFORTYTWO_CLIENT_SECRET=s-s4t2ud-secret\n',
    );
    const h = harness(['', '', '', '', '', '', 'ok', '', '', '', '', '', 'n']);
    await runWizard(h.deps);
    expect(h.reader.transcript()).not.toContain('Fuseau déduit du campus');
  });

  it('offers the time zone of the campus on a first run, from the 42 API', async () => {
    const lines = [...FIRST];
    lines.splice(7, 4, 'seoul', 'ok', '', '');
    const h = harness([...lines, '4', '', 'n']);
    await runWizard(h.deps);
    expect(h.reader.transcript()).toContain('Fuseau déduit du campus Seoul : Asia/Seoul.');
    expect(config().bde.timezone).toBe('Asia/Seoul');
  });

  it('offers the time zone of this computer when 42 gives none, but never UTC, which is only the container default', async () => {
    const lines = [
      '1',
      'BDE',
      '',
      '',
      'localhost',
      'u-s4t2ud-good',
      's-s4t2ud-secret',
      'nice',
      'ok',
      '',
      'jdupont',
      '',
      '4',
      '',
      'n',
    ];
    const options = { api: { campuses: [{ id: 1, name: 'Nice' }] } };

    const montreal = harness(lines, options);
    montreal.deps.guessTimezone = () => 'America/Montreal';
    await runWizard(montreal.deps);
    expect(montreal.reader.transcript()).toContain('Fuseau horaire [America/Montreal]: ');
    expect(config().bde.timezone).toBe('America/Montreal');
  });

  it('falls back on Europe/Paris when nothing suggests a time zone', async () => {
    const lines = [
      '1',
      'BDE',
      '',
      '',
      'localhost',
      'u-s4t2ud-good',
      's-s4t2ud-secret',
      'tous',
      'Nice',
      '',
      'jdupont',
      '',
      '4',
      '',
      'n',
    ];
    const h = harness(lines, { api: { campuses: [{ id: 1, name: 'Nice' }] } });
    await runWizard(h.deps);
    expect(h.reader.transcript()).toContain('Fuseau horaire [Europe/Paris]: ');
  });
});

describe('42 credentials: retrying and the campus list', () => {
  it('retries after a network failure when asked to', async () => {
    const h = harness([
      ...FIRST.slice(0, 5),
      'u-s4t2ud-good',
      's-s4t2ud-secret',
      'o',
      'u-s4t2ud-good',
      's-s4t2ud-secret',
      'nic',
      '1',
      'ok',
      '',
      'jdupont',
      '',
      '4',
      '',
      'n',
    ]);
    const real = h.deps.fetchFn;
    let down = true;
    h.deps.fetchFn = async (url, init) => {
      if (down) {
        down = false;
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
      }
      return real(url, init);
    };
    await runWizard(h.deps);

    expect(h.reader.transcript()).toContain('✗ Impossible de joindre l’API 42 (ENOTFOUND)');
    expect(h.reader.transcript()).toContain('✓ L’API 42 accepte ces identifiants.');
    expect(env().get('FORTYTWO_CLIENT_ID')).toBe('u-s4t2ud-good');
  });

  it('does not let the person go on unverified when they refuse both the retry and the unverified go-on', async () => {
    const h = harness(
      [
        ...FIRST.slice(0, 5),
        'u-s4t2ud-good',
        's-s4t2ud-secret',
        'n',
        'n',
        'u-s4t2ud-good',
        's-s4t2ud-secret',
      ],
      { api: { down: true } },
    );
    await expect(runWizard(h.deps)).rejects.toBeInstanceOf(InputClosedError);
    expect(h.api.requests.filter((r) => r.includes('/oauth/token'))).toHaveLength(2);
  });

  it('asks the campuses by hand when the 42 API returns an empty list', async () => {
    const h = harness(
      [
        ...FIRST.slice(0, 5),
        'u-s4t2ud-good',
        's-s4t2ud-secret',
        'Nice',
        'Europe/Paris',
        'jdupont',
        '',
        '4',
        '',
        'n',
      ],
      { api: { campuses: [] } },
    );
    await runWizard(h.deps);
    expect(h.reader.transcript()).toContain(
      'L’API 42 est injoignable : je continue sans la liste des campus',
    );
    expect(config().auth.allowedCampuses).toEqual(['Nice']);
  });

  it('asks the campuses by hand when the campus list cannot be read, but still checks the owners', async () => {
    const h = harness(
      [
        ...FIRST.slice(0, 5),
        'u-s4t2ud-good',
        's-s4t2ud-secret',
        'Nice',
        'Europe/Paris',
        'jdupont',
        '',
        '4',
        '',
        'n',
      ],
      { api: { campusStatus: 500 } },
    );
    await runWizard(h.deps);
    expect(h.reader.transcript()).toContain('✓ jdupont existe sur l’intra 42.');
  });

  it('accepts several campuses typed by hand, separated by commas or semicolons, and none for "every campus"', async () => {
    const lines = [...FIRST.slice(0, 5), 'u-s4t2ud-good', 's-s4t2ud-secret'];
    const many = harness([...lines, 'Nice; Paris, Lyon', '2', '', 'jdupont', '', '4', '', 'n'], {
      api: { campuses: [] },
    });
    await runWizard(many.deps);
    expect(config().auth.allowedCampuses).toEqual(['Nice', 'Paris', 'Lyon']);
    expect(config().bde.campus).toBe('Paris');
  });
});

describe('the summary and the e-mail retry', () => {
  it('names the channel in the summary: Discord, Slack, e-mail, none', async () => {
    const cases: Array<[string[], string]> = [
      [['1', DISCORD, 'o'], 'Discord'],
      [['2', SLACK, 'o'], 'Slack'],
      [['3', 'smtp.exemple.fr', '', '', 'bde@exemple.fr', 'moi@exemple.fr', 'o'], 'E-mail'],
      [['4'], 'Aucune pour l’instant'],
    ];
    for (const [answers, label] of cases) {
      const h = harness([...FIRST, ...answers, 'n']);
      await runWizard(h.deps);
      expect(h.reader.transcript()).toMatch(new RegExp(`Notifications +${label}`));
    }
  });

  it('shows the language of the messages, and every campus or "tous", in the summary', async () => {
    const one = harness([...FIRST, '4', 'n']);
    await runWizard(one.deps);
    expect(one.reader.transcript()).toMatch(/Langue des messages +Français/);
    expect(one.reader.transcript()).toMatch(/Campus autorisés +Nice\n/);

    const lines = [...FIRST];
    lines[3] = '2';
    lines.splice(7, 4, 'tous', 'Nice', 'Europe/Paris');
    const all = harness([...lines, '', '4', 'n']);
    await runWizard(all.deps);
    expect(all.reader.transcript()).toMatch(/Langue des messages +English/);
    expect(all.reader.transcript()).toMatch(/Campus autorisés +tous/);
  });

  it('shows the owners and the redirect URL in the summary', async () => {
    const h = harness([...FIRST, '4', 'n']);
    await runWizard(h.deps);
    expect(h.reader.transcript()).toMatch(/Propriétaires +jdupont/);
    expect(h.reader.transcript()).toMatch(
      /URL de redirection 42 +http:\/\/localhost:3000\/api\/auth\/callback\/42-school/,
    );
  });

  it('e-mail: after a failure, does not offer the saved SMTP password again, and asks it afresh', async () => {
    writeFileSync(
      join(dir, '.env'),
      'SMTP_HOST=smtp.exemple.fr\nSMTP_PORT=587\nSMTP_USER=bde@exemple.fr\nSMTP_PASSWORD=saved-password\nSMTP_FROM=bde@exemple.fr\n',
    );
    const h = harness(
      [
        ...FIRST,
        '3',
        '',
        '',
        '', // host, port, user: the saved ones
        'o', // keep the saved password
        '', // from
        '1', // verify failed: enter again
        '',
        '',
        '',
        'new-password', // second attempt: no offer to keep, typed afresh
        '',
        'moi@exemple.fr',
        'o',
        '',
        'n',
      ],
      { smtpVerify: ['fail', 'ok'] },
    );
    await runWizard(h.deps);

    expect(h.reader.transcript().match(/Garder la valeur déjà enregistrée/g)).toHaveLength(1);
    expect(env().get('SMTP_PASSWORD')).toBe('new-password');
  });
});

describe('a folder with no configuration at all', () => {
  it('does not need an earlier bde.config.yml or .env: it writes them from nothing', async () => {
    rmSync(join(dir, 'bde.config.yml'));
    rmSync(join(dir, '.env.example'));
    const h = harness([...FIRST, '4', '', 'n']);
    await runWizard(h.deps);

    expect(h.reader.transcript()).not.toContain('Une configuration existe déjà');
    expect(config().bde.name).toBe('BDE Les Lynx');
    expect(env().get('APP_URL')).toBe('http://localhost:3000');
    expect(existsSync(join(dir, '.setup-backups'))).toBe(false); // nothing to back up
  });
});

describe('the campus selection shows what is chosen only when something is', () => {
  const campuses = CAMPUSES.map((c) => ({
    id: c.id,
    name: c.name,
    country: c.country,
    timeZone: c.time_zone,
  }));
  const select = async (lines: string[], preselected: string[] = []) => {
    const reader = scriptedReader(lines);
    const chosen = await selectCampuses(new Prompts(reader), campuses, preselected);
    return { chosen, said: reader.transcript() };
  };

  it('shows one chosen campus, from the start, after an addition and after a choice by number', async () => {
    expect((await select(['ok'], ['Nice'])).said).toContain('Choisis : [1] Nice');
    expect((await select(['seoul', 'ok'])).said).toContain('Choisis : [1] Seoul');
    expect((await select(['ni', '1', 'ok'])).said).toContain('Choisis : [1] Nice');
  });

  it('shows nothing when nothing is chosen: not at the start, not after a search that finds nothing', async () => {
    const { said } = await select(['zzzz', 'paris', 'ok']);
    expect(said.split('Paris')[0]).not.toContain('Choisis');
  });

  it('shows nothing once the only choice is removed', async () => {
    const { said, chosen } = await select(['paris', '-1', 'lyon', 'ok']);
    expect(chosen).toEqual(['Lyon']);
    const afterRemoval = said.split('Retiré : Paris')[1]?.split('Lyon')[0] ?? '';
    expect(afterRemoval).not.toContain('Choisis');
  });
});

describe('the campus selection after a removal', () => {
  it('shows the campuses that remain', async () => {
    const campuses = CAMPUSES.map((c) => ({
      id: c.id,
      name: c.name,
      country: c.country,
      timeZone: c.time_zone,
    }));
    const reader = scriptedReader(['paris', 'lyon', '-1', 'ok']);
    await selectCampuses(new Prompts(reader), campuses, []);
    expect(reader.transcript().split('Retiré : Paris')[1]).toContain('Choisis : [1] Lyon');
  });
});
