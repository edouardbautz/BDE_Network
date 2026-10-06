// @vitest-environment node
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bdeConfigSchema } from '../src/config/schema';
import type { Address } from './validate';
import type { Answers } from './answers';
import {
  backupStamp,
  envChanges,
  envTemplate,
  formatEnvValue,
  generateAuthSecret,
  generatePassword,
  parseEnv,
  readExisting,
  renderConfig,
  renderEnv,
  writeFiles,
} from './files';

const local: Address = {
  url: 'http://localhost:3000',
  host: 'localhost',
  port: 3000,
  isLocal: true,
  insecureDomain: false,
};
const domain: Address = {
  url: 'https://bde.exemple.fr',
  host: 'bde.exemple.fr',
  port: 443,
  isLocal: false,
  insecureDomain: false,
};

const answers = (over: Partial<Answers> = {}): Answers => ({
  lang: 'fr',
  name: 'BDE Les Lynx',
  accentColor: '#0f766e',
  messageLocale: 'fr',
  timezone: 'Europe/Paris',
  address: local,
  clientId: 'u-s4t2ud-abc123',
  clientSecret: 's-s4t2ud-def456',
  campuses: ['Nice'],
  mainCampus: 'Nice',
  owners: ['jdupont'],
  events: true,
  notifications: { mode: 'none' },
  authSecret: 'A'.repeat(43) + '=',
  postgresPassword: 'Pg1234567890abcdefghijkl',
  ...over,
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bde-setup-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('generated secrets', () => {
  it('makes an AUTH_SECRET of at least 32 characters, different every time', () => {
    const a = generateAuthSecret();
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(Buffer.from(a, 'base64')).toHaveLength(32);
    expect(generateAuthSecret()).not.toBe(a);
  });

  it('makes a database password of 24 letters and digits, safe in a URL and in .env', () => {
    const password = generatePassword();
    expect(password).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(generatePassword()).not.toBe(password);
    expect(encodeURIComponent(password)).toBe(password);
  });

  it('makes a password of the length asked', () => {
    expect(generatePassword(40)).toHaveLength(40);
  });
});

describe('parseEnv', () => {
  it('reads plain, single-quoted and double-quoted values, and export lines', () => {
    const values = parseEnv(
      [
        'A=plain',
        "B='single quoted'",
        'C="double quoted"',
        'export D=exported',
        'E=',
        ' F = spaced ',
      ].join('\n'),
    );
    expect(Object.fromEntries(values)).toEqual({
      A: 'plain',
      B: 'single quoted',
      C: 'double quoted',
      D: 'exported',
      E: '',
      F: 'spaced',
    });
  });

  it('ignores comments and blank lines, and a trailing comment of an unquoted value', () => {
    const values = parseEnv("# a comment\n\nA=1 # trailing\n#B=2\nC='x # not a comment'\n");
    expect(Object.fromEntries(values)).toEqual({ A: '1', C: 'x # not a comment' });
  });

  it('reads Windows line endings', () => {
    expect(Object.fromEntries(parseEnv('A=1\r\nB=2\r\n'))).toEqual({ A: '1', B: '2' });
  });

  it('keeps an equals sign inside a value', () => {
    expect(parseEnv('AUTH_SECRET=abc+/=\n').get('AUTH_SECRET')).toBe('abc+/=');
  });
});

describe('formatEnvValue', () => {
  it('leaves a plain value bare', () => {
    expect(formatEnvValue('u-s4t2ud-abc123')).toBe('u-s4t2ud-abc123');
    expect(formatEnvValue('http://localhost:3000')).toBe('http://localhost:3000');
    expect(formatEnvValue('abc+/=')).toBe('abc+/=');
    expect(formatEnvValue('')).toBe('');
  });

  it('puts anything else in single quotes, where nothing is expanded', () => {
    expect(formatEnvValue('BDE Nice <bde@x.fr>')).toBe("'BDE Nice <bde@x.fr>'");
    expect(formatEnvValue('p$ss #word')).toBe("'p$ss #word'");
    expect(formatEnvValue('postgresql://bde:pw@localhost:5432/db?schema=public')).toBe(
      "'postgresql://bde:pw@localhost:5432/db?schema=public'",
    );
  });

  it.each(["it's", 'a\nb', 'a\rb', 'a\0b'])(
    'refuses %j rather than write something broken',
    (value) => {
      expect(() => formatEnvValue(value)).toThrow();
    },
  );

  it('round-trips through parseEnv', () => {
    for (const value of ['plain', 'with space', 'p$ss #word', 'BDE <a@b.fr>', 'abc+/=']) {
      expect(parseEnv(`K=${formatEnvValue(value)}`).get('K')).toBe(value);
    }
  });
});

describe('renderEnv', () => {
  const base = [
    '# comment',
    'POSTGRES_PASSWORD=change-me',
    'KEEP_ME=untouched',
    '',
    'APP_URL=',
    '# APP_PORT=3000',
  ].join('\n');

  it('replaces the line of a key in place, and leaves every other line as it was', () => {
    const out = renderEnv(base, {
      POSTGRES_PASSWORD: 'newpass',
      APP_URL: 'https://bde.exemple.fr',
    });
    expect(out).toBe(
      [
        '# comment',
        'POSTGRES_PASSWORD=newpass',
        'KEEP_ME=untouched',
        '',
        'APP_URL=https://bde.exemple.fr',
        '# APP_PORT=3000',
        '',
      ].join('\n'),
    );
  });

  it('turns a commented-out line into the active one', () => {
    expect(renderEnv(base, { APP_PORT: '3001' })).toContain('\nAPP_PORT=3001\n');
    expect(renderEnv(base, { APP_PORT: '3001' })).not.toContain('# APP_PORT');
  });

  it('prefers the active line over a commented one', () => {
    const out = renderEnv('# APP_URL=old\nAPP_URL=active\n', { APP_URL: 'new' });
    expect(out).toBe('# APP_URL=old\nAPP_URL=new\n');
  });

  it('adds the keys that are not there at the end, under a heading', () => {
    const out = renderEnv('A=1\n', { SMTP_HOST: 'smtp.exemple.fr' });
    expect(out).toBe('A=1\n\n# --- Added by the setup assistant ---\nSMTP_HOST=smtp.exemple.fr\n');
  });

  it('writes an empty value for a key that was given an empty string', () => {
    expect(renderEnv('SMTP_USER=old\n', { SMTP_USER: '' })).toBe('SMTP_USER=\n');
  });

  it('works from nothing', () => {
    expect(renderEnv('', { A: '1' })).toBe('\n# --- Added by the setup assistant ---\nA=1\n');
  });

  it('ends with exactly one line break, and writes LF even over CRLF text', () => {
    const out = renderEnv('A=1\r\nB=2\r\n\r\n', { A: '9' });
    expect(out).toBe('A=9\nB=2\n');
  });

  it('writes values that read back the same', () => {
    const out = renderEnv(base, {
      POSTGRES_PASSWORD: 'p$ss #word',
      APP_URL: 'http://localhost:3000',
    });
    const values = parseEnv(out);
    expect(values.get('POSTGRES_PASSWORD')).toBe('p$ss #word');
    expect(values.get('APP_URL')).toBe('http://localhost:3000');
    expect(values.get('KEEP_ME')).toBe('untouched');
  });
});

describe('envChanges', () => {
  it('decides the database, the session secret, the 42 application and the address', () => {
    const changes = envChanges(answers(), new Map());
    expect(changes).toMatchObject({
      POSTGRES_USER: 'bde',
      POSTGRES_PASSWORD: 'Pg1234567890abcdefghijkl',
      POSTGRES_DB: 'bde_network',
      AUTH_SECRET: 'A'.repeat(43) + '=',
      FORTYTWO_CLIENT_ID: 'u-s4t2ud-abc123',
      FORTYTWO_CLIENT_SECRET: 's-s4t2ud-def456',
      APP_URL: 'http://localhost:3000',
      APP_PORT: '3000',
    });
    expect(changes.DATABASE_URL).toBe(
      'postgresql://bde:Pg1234567890abcdefghijkl@localhost:5432/bde_network?schema=public',
    );
  });

  it('keeps the database user and name already in use', () => {
    const changes = envChanges(
      answers(),
      new Map([
        ['POSTGRES_USER', 'club'],
        ['POSTGRES_DB', 'club_db'],
      ]),
    );
    expect(changes.POSTGRES_USER).toBe('club');
    expect(changes.POSTGRES_DB).toBe('club_db');
    expect(changes.DATABASE_URL).toContain('postgresql://club:');
    expect(changes.DATABASE_URL).toContain('/club_db?');
  });

  it('chooses the port of a local try-out, and none for a real domain', () => {
    const port = envChanges(
      answers({ address: { ...local, url: 'http://localhost:3001', port: 3001 } }),
      new Map(),
    );
    expect(port.APP_PORT).toBe('3001');
    expect(envChanges(answers({ address: domain }), new Map())).not.toHaveProperty('APP_PORT');
    expect(envChanges(answers({ address: domain }), new Map()).APP_URL).toBe(
      'https://bde.exemple.fr',
    );
  });

  it('writes no notification setting when there is none', () => {
    const changes = envChanges(answers(), new Map());
    for (const key of ['DISCORD_WEBHOOK_URL', 'SLACK_WEBHOOK_URL', 'SMTP_HOST']) {
      expect(changes).not.toHaveProperty(key);
    }
  });

  it('writes the Discord webhook, the Slack webhook, or the SMTP settings, as chosen', () => {
    const hook = 'https://discord.com/api/webhooks/1/x';
    expect(
      envChanges(answers({ notifications: { mode: 'discord', discordWebhook: hook } }), new Map()),
    ).toMatchObject({
      DISCORD_WEBHOOK_URL: hook,
    });
    const slack = 'https://hooks.slack.com/services/T1/B1/x';
    const forSlack = envChanges(
      answers({ notifications: { mode: 'slack', slackWebhook: slack } }),
      new Map(),
    );
    expect(forSlack.SLACK_WEBHOOK_URL).toBe(slack);
    expect(forSlack).not.toHaveProperty('DISCORD_WEBHOOK_URL');

    const email = envChanges(
      answers({
        notifications: {
          mode: 'email',
          smtp: {
            host: 'smtp.exemple.fr',
            port: 587,
            user: 'bde',
            password: 'pw',
            from: 'bde@exemple.fr',
          },
        },
      }),
      new Map(),
    );
    expect(email).toMatchObject({
      SMTP_HOST: 'smtp.exemple.fr',
      SMTP_PORT: '587',
      SMTP_USER: 'bde',
      SMTP_PASSWORD: 'pw',
      SMTP_FROM: 'bde@exemple.fr',
    });
  });

  it('leaves the notification settings alone when the current ones are kept', () => {
    const changes = envChanges(answers({ notifications: { mode: 'keep' } }), new Map());
    expect(changes).not.toHaveProperty('SMTP_HOST');
    expect(changes).not.toHaveProperty('DISCORD_WEBHOOK_URL');
  });
});

describe('renderConfig', () => {
  const parse = (text: string) => load(text) as ReturnType<typeof bdeConfigSchema.parse>;

  it('writes a configuration the platform itself accepts', () => {
    const text = renderConfig(answers(), null);
    const parsed = bdeConfigSchema.safeParse(load(text));
    expect(parsed.success).toBe(true);
  });

  it('writes what was answered', () => {
    const config = parse(
      renderConfig(answers({ campuses: ['Nice', 'Paris'], owners: ['jdupont', 'marie-d'] }), null),
    );
    expect(config.bde).toMatchObject({
      name: 'BDE Les Lynx',
      campus: 'Nice',
      timezone: 'Europe/Paris',
      defaultLocale: 'fr',
      accentColor: '#0f766e',
      logoPath: '/logo.svg',
    });
    expect(config.auth).toEqual({
      owners: ['jdupont', 'marie-d'],
      allowedCampuses: ['Nice', 'Paris'],
    });
  });

  it('writes an empty list of campuses for "every campus"', () => {
    const text = renderConfig(answers({ campuses: [] }), null);
    expect(text).toContain('allowedCampuses: []');
    expect(parse(text).auth.allowedCampuses).toEqual([]);
  });

  it('keeps awkward names exactly, quotes and symbols included', () => {
    for (const name of [
      'L\'été #1: ça "roule"',
      'Bureau {x} [y] & z',
      "''",
      'null',
      'true',
      '123',
      '- tiret',
      '日本語',
    ]) {
      const config = parse(renderConfig(answers({ name }), null));
      expect(config.bde.name).toBe(name);
    }
  });

  it('enables the Events module with the default categories and a reminder hour of 18', () => {
    const config = parse(renderConfig(answers({ events: true }), null));
    expect(config.modules.enabled).toEqual(['events']);
    expect(config.events?.reminderHour).toBe(18);
    expect(config.events?.categories.map((c) => c.key)).toEqual([
      'soiree',
      'sport',
      'wei',
      'partenariat',
    ]);
  });

  it('leaves the Events module and its section out when it is turned off', () => {
    const text = renderConfig(answers({ events: false }), null);
    expect(parse(text).modules.enabled).toEqual([]);
    expect(text).not.toContain('events:');
  });

  it('puts the chosen channel on the five notifications', () => {
    const config = parse(
      renderConfig(
        answers({
          notifications: {
            mode: 'discord',
            discordWebhook: 'https://discord.com/api/webhooks/1/x',
          },
        }),
        null,
      ),
    );
    expect(config.notifications).toEqual({
      memberPending: 'discord',
      memberApproved: 'discord',
      memberRemoved: 'discord',
      eventConfirmed: 'discord',
      eventReminder: 'discord',
    });
  });

  it('writes "none" everywhere for no notification', () => {
    const config = parse(renderConfig(answers(), null));
    expect(Object.values(config.notifications)).toEqual(['none', 'none', 'none', 'none', 'none']);
  });

  describe('when a configuration already exists', () => {
    const current = {
      bde: { name: 'Ancien', logoPath: '/mon-logo.png', contactEmail: 'bureau@exemple.fr' },
      modules: { enabled: ['events', 'finances'] },
      events: {
        categories: [{ key: 'concert', label: 'Concert', color: '#123456' }],
        reminderHour: 9,
      },
      notifications: { memberPending: 'email', eventConfirmed: 'slack' },
    };

    it('keeps what the assistant does not ask: logo, contact address, other modules', () => {
      const config = parse(renderConfig(answers(), current));
      expect(config.bde.logoPath).toBe('/mon-logo.png');
      expect(config.bde.contactEmail).toBe('bureau@exemple.fr');
      expect(config.modules.enabled).toEqual(['finances', 'events']);
    });

    it('keeps the event categories and the reminder hour', () => {
      const config = parse(renderConfig(answers(), current));
      expect(config.events).toEqual({
        categories: [{ key: 'concert', label: 'Concert', color: '#123456' }],
        reminderHour: 9,
      });
    });

    it('removes only the Events module when it is turned off, and keeps the other modules', () => {
      const text = renderConfig(answers({ events: false }), current);
      expect(parse(text).modules.enabled).toEqual(['finances']);
      expect(text).not.toContain('concert');
    });

    it('keeps the current notification settings when asked to', () => {
      const config = parse(renderConfig(answers({ notifications: { mode: 'keep' } }), current));
      expect(config.notifications).toEqual({
        memberPending: 'email',
        memberApproved: 'none',
        memberRemoved: 'none',
        eventConfirmed: 'slack',
        eventReminder: 'none',
      });
    });

    it('replaces the notification settings when a channel is chosen', () => {
      const config = parse(renderConfig(answers({ notifications: { mode: 'none' } }), current));
      expect(Object.values(config.notifications)).toEqual(['none', 'none', 'none', 'none', 'none']);
    });

    it('does not trust a malformed current file', () => {
      const config = parse(
        renderConfig(answers(), { bde: 'oops', modules: 5, events: { categories: 'x' } }),
      );
      expect(config.bde.logoPath).toBe('/logo.svg');
      expect(config.events?.categories).toHaveLength(4);
    });
  });

  it('comments the file in the language of the assistant', () => {
    expect(renderConfig(answers({ lang: 'fr' }), null)).toContain(
      "écrite par l'assistant d'installation",
    );
    expect(renderConfig(answers({ lang: 'en' }), null)).toContain('written by the setup assistant');
  });

  it('refuses to produce a configuration the platform would reject', () => {
    expect(() => renderConfig(answers({ accentColor: 'not-a-colour' }), null)).toThrow(/invalid/);
    expect(() => renderConfig(answers({ owners: [] }), null)).toThrow(/invalid/);
  });
});

describe('readExisting', () => {
  it('finds nothing in an empty folder', () => {
    expect(readExisting(dir)).toEqual({
      env: new Map(),
      envText: null,
      config: null,
      hasLocalConfig: false,
    });
  });

  it('reads .env and bde.config.yml, and notices bde.config.local.yml', () => {
    writeFileSync(join(dir, '.env'), 'APP_URL=http://localhost:3000\n');
    writeFileSync(join(dir, 'bde.config.yml'), "bde:\n  name: 'X'\n");
    writeFileSync(join(dir, 'bde.config.local.yml'), 'bde: {}\n');

    const existing = readExisting(dir);
    expect(existing.env.get('APP_URL')).toBe('http://localhost:3000');
    expect(existing.envText).toBe('APP_URL=http://localhost:3000\n');
    expect(existing.config).toEqual({ bde: { name: 'X' } });
    expect(existing.hasLocalConfig).toBe(true);
  });

  it('treats a config that is not valid YAML, or not a mapping, as missing', () => {
    writeFileSync(join(dir, 'bde.config.yml'), 'bde: [unclosed\n');
    expect(readExisting(dir).config).toBeNull();
    writeFileSync(join(dir, 'bde.config.yml'), '- a\n- b\n');
    expect(readExisting(dir).config).toBeNull();
    writeFileSync(join(dir, 'bde.config.yml'), 'just text\n');
    expect(readExisting(dir).config).toBeNull();
  });

  it('gives the project template as the starting point of a first .env', () => {
    expect(envTemplate(dir)).toBe('');
    writeFileSync(join(dir, '.env.example'), 'A=\n');
    expect(envTemplate(dir)).toBe('A=\n');
  });
});

describe('writeFiles', () => {
  const files = { env: 'A=1\n', config: "bde:\n  name: 'X'\n" };
  const now = new Date('2026-10-06T14:25:30Z');

  it('stamps the backup folder with the UTC date and time', () => {
    expect(backupStamp(now)).toBe('20261006-142530');
    expect(backupStamp(new Date('2027-01-02T03:04:05Z'))).toBe('20270102-030405');
  });

  it('creates both files when there are none, and has nothing to back up', () => {
    const result = writeFiles(dir, files, now);
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe('A=1\n');
    expect(readFileSync(join(dir, 'bde.config.yml'), 'utf8')).toBe(files.config);
    expect(result).toEqual({ written: ['.env', 'bde.config.yml'], backupDir: null });
    expect(existsSync(join(dir, '.setup-backups'))).toBe(false);
  });

  it('copies the previous files to .setup-backups/<date>/ before replacing them', () => {
    writeFileSync(join(dir, '.env'), 'OLD_ENV=1\n');
    writeFileSync(join(dir, 'bde.config.yml'), 'old: config\n');

    const result = writeFiles(dir, files, now);

    expect(result.backupDir).toBe(join('.setup-backups', '20261006-142530'));
    const backup = join(dir, '.setup-backups', '20261006-142530');
    expect(readFileSync(join(backup, '.env'), 'utf8')).toBe('OLD_ENV=1\n');
    expect(readFileSync(join(backup, 'bde.config.yml'), 'utf8')).toBe('old: config\n');
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe('A=1\n');
  });

  it('backs up and rewrites only what changes', () => {
    writeFileSync(join(dir, '.env'), 'A=1\n');
    writeFileSync(join(dir, 'bde.config.yml'), 'old: config\n');

    const result = writeFiles(dir, files, now);

    expect(result.written).toEqual(['bde.config.yml']);
    expect(readdirSync(join(dir, '.setup-backups', '20261006-142530'))).toEqual(['bde.config.yml']);
  });

  it('does nothing at all when nothing changes', () => {
    writeFileSync(join(dir, '.env'), 'A=1\n');
    writeFileSync(join(dir, 'bde.config.yml'), files.config);

    expect(writeFiles(dir, files, now)).toEqual({ written: [], backupDir: null });
    expect(existsSync(join(dir, '.setup-backups'))).toBe(false);
  });

  it('keeps every earlier backup: two runs give two folders', () => {
    writeFileSync(join(dir, '.env'), 'ONE=1\n');
    writeFiles(dir, { env: 'TWO=2\n', config: files.config }, new Date('2026-10-06T10:00:00Z'));
    writeFiles(dir, { env: 'THREE=3\n', config: files.config }, new Date('2026-10-06T11:00:00Z'));

    expect(readdirSync(join(dir, '.setup-backups')).sort()).toEqual([
      '20261006-100000',
      '20261006-110000',
    ]);
    expect(readFileSync(join(dir, '.setup-backups', '20261006-100000', '.env'), 'utf8')).toBe(
      'ONE=1\n',
    );
    expect(readFileSync(join(dir, '.setup-backups', '20261006-110000', '.env'), 'utf8')).toBe(
      'TWO=2\n',
    );
  });

  it('leaves no temporary file behind', () => {
    writeFiles(dir, files, now);
    expect(readdirSync(dir).filter((name) => name.includes('setup-tmp'))).toEqual([]);
  });

  it('writes nothing, and leaves the old files untouched, when a write fails', () => {
    writeFileSync(join(dir, '.env'), 'OLD=1\n');
    // bde.config.yml is a directory: the second file cannot be replaced
    mkdirSync(join(dir, 'bde.config.yml'));

    expect(() => writeFiles(dir, files, now)).toThrow();

    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe('OLD=1\n');
    expect(readdirSync(dir).filter((name) => name.includes('setup-tmp'))).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')(
    'makes .env readable by its owner only, the config by everyone',
    () => {
      writeFiles(dir, files, now);
      expect(statMode(join(dir, '.env'))).toBe(0o600);
      expect(statMode(join(dir, 'bde.config.yml'))).toBe(0o644);
    },
  );

  it.skipIf(process.platform === 'win32')('keeps a backup of a secret private too', () => {
    writeFileSync(join(dir, '.env'), 'SECRET=1\n');
    chmodSync(join(dir, '.env'), 0o644);
    writeFiles(dir, files, now);
    expect(statMode(join(dir, '.setup-backups', '20261006-142530', '.env'))).toBe(0o600);
  });
});

function statMode(path: string): number {
  return statSync(path).mode & 0o777;
}

describe('edge cases', () => {
  it('reads a lone quote as a value, not as an empty quoted string', () => {
    expect(parseEnv('A=\'\nB="\n').get('A')).toBe("'");
    expect(parseEnv('A=\'\nB="\n').get('B')).toBe('"');
  });

  it('changes the first line of a key when it appears twice, and the first commented one', () => {
    expect(renderEnv('A=1\nA=2\n', { A: '9' })).toBe('A=9\nA=2\n');
    expect(renderEnv('# A=1\n# A=2\n', { A: '9' })).toBe('A=9\n# A=2\n');
  });

  it('writes a webhook or SMTP setting only when the channel is chosen AND the value is there', () => {
    const hook = 'https://discord.com/api/webhooks/1/x';
    // a stray value of another channel is not written
    expect(
      envChanges(answers({ notifications: { mode: 'none', discordWebhook: hook } }), new Map()),
    ).not.toHaveProperty('DISCORD_WEBHOOK_URL');
    expect(
      envChanges(answers({ notifications: { mode: 'slack', discordWebhook: hook } }), new Map()),
    ).not.toHaveProperty('DISCORD_WEBHOOK_URL');
    expect(
      envChanges(
        answers({
          notifications: { mode: 'none', slackWebhook: 'https://hooks.slack.com/services/T1/B1/x' },
        }),
        new Map(),
      ),
    ).not.toHaveProperty('SLACK_WEBHOOK_URL');
    expect(
      envChanges(
        answers({
          notifications: {
            mode: 'none',
            smtp: { host: 'h', port: 1, user: '', password: '', from: 'a@b.fr' },
          },
        }),
        new Map(),
      ),
    ).not.toHaveProperty('SMTP_HOST');
    // the channel chosen but nothing given: nothing to write
    expect(
      envChanges(answers({ notifications: { mode: 'discord' } }), new Map()),
    ).not.toHaveProperty('DISCORD_WEBHOOK_URL');
    expect(envChanges(answers({ notifications: { mode: 'slack' } }), new Map())).not.toHaveProperty(
      'SLACK_WEBHOOK_URL',
    );
    expect(envChanges(answers({ notifications: { mode: 'email' } }), new Map())).not.toHaveProperty(
      'SMTP_HOST',
    );
  });

  it('keeps only the well-formed event categories of the current file, and the defaults when none is', () => {
    const parse = (text: string) => load(text) as ReturnType<typeof bdeConfigSchema.parse>;
    const mixed = renderConfig(answers(), {
      events: {
        categories: [
          { key: 'ok', label: 'Ok', color: '#111111' },
          { key: 'no-label', color: '#222222' },
          { label: 'No key', color: '#333333' },
          { key: 'no-color', label: 'No colour' },
          'not an object',
          null,
        ],
      },
    });
    expect(parse(mixed).events?.categories).toEqual([{ key: 'ok', label: 'Ok', color: '#111111' }]);

    const none = renderConfig(answers(), { events: { categories: [{ key: 'x' }] } });
    expect(parse(none).events?.categories).toHaveLength(4);
    expect(
      parse(renderConfig(answers(), { events: { categories: [] } })).events?.categories,
    ).toHaveLength(4);
  });

  it('says where the backup is even when only one file was backed up', () => {
    writeFileSync(join(dir, '.env'), 'A=1\n');
    writeFileSync(join(dir, 'bde.config.yml'), 'old: config\n');
    const result = writeFiles(
      dir,
      { env: 'A=1\n', config: "bde:\n  name: 'X'\n" },
      new Date('2026-10-06T14:25:30Z'),
    );
    expect(result.backupDir).toBe(join('.setup-backups', '20261006-142530'));
  });

  it('does not report a backup when the changed files did not exist before', () => {
    expect(writeFiles(dir, { env: 'A=1\n', config: 'x: 1\n' }).backupDir).toBeNull();
  });
});

describe('parseEnv: empty quotes', () => {
  it('reads an empty quoted string as empty, not as two quote characters', () => {
    const values = parseEnv('A=\'\'\nB=""\n');
    expect(values.get('A')).toBe('');
    expect(values.get('B')).toBe('');
  });
});
