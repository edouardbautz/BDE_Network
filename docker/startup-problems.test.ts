// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PAGE_STYLE,
  buildDatabaseUrl,
  classifyMigrationFailure,
  parseReport,
  pickLanguage,
  problemTitle,
  redact,
  renderProblemPage,
  terminalLine,
} from './startup-problems.mjs';

describe('terminalLine', () => {
  it('leaves out the Network line: 0.0.0.0 is where the server listens, nobody can open it', () => {
    expect(terminalLine('   - Network:      http://0.0.0.0:3000', 3000)).toBeNull();
  });

  it('shows the address of the browser, with the port of this computer, on the Local line', () => {
    expect(terminalLine('   - Local:        http://localhost:3000', 3000)).toBe(
      '   - Local:        http://localhost:3000',
    );
    expect(terminalLine('   - Local:        http://localhost:3000', 3001)).toBe(
      '   - Local:        http://localhost:3001',
    );
    expect(terminalLine('   - Local:        http://0.0.0.0:3000', 3001)).toBe(
      '   - Local:        http://localhost:3001',
    );
  });

  it('does not touch any other line', () => {
    for (const line of [
      '   ▲ Next.js 15.5.27',
      ' ✓ Ready in 111ms',
      '',
      'visit http://0.0.0.0:3000 now',
    ]) {
      expect(terminalLine(line, 3000)).toBe(line);
    }
  });
});

describe('classifyMigrationFailure', () => {
  const cases: Array<[string, string, string, boolean]> = [
    [
      'Error: P1000: Authentication failed against database server, the provided database credentials for `bde` are not valid.',
      'database-auth',
      'P1000',
      true,
    ],
    ['Error: P1003: Database `x` does not exist', 'database-auth', 'P1003', true],
    [
      "Error: P1001: Can't reach database server at `postgres:5432`",
      'database-unreachable',
      'P1001',
      true,
    ],
    ['Error: P1017: Server has closed the connection.', 'database-unreachable', 'P1017', true],
    ['connect ECONNREFUSED 10.0.0.2:5432', 'database-unreachable', '', true],
    ['Error: P1013: The provided database string is invalid.', 'database-url', 'P1013', false],
    [
      'Error: The datasource.url property is required in your Prisma config',
      'database-url',
      '',
      false,
    ],
    ['Error: P3005\n\nThe database schema is not empty.', 'migration', 'P3005', false],
    ['Error: P3009 migrate found failed migrations', 'migration', 'P3009', false],
    ['something nobody expected', 'migration', '', false],
  ];

  it.each(cases)('%s', (output, kind, code, retry) => {
    expect(classifyMigrationFailure(output)).toEqual({ kind, code, retry });
  });
});

describe('redact', () => {
  const env = {
    AUTH_SECRET: 'a-very-long-session-secret-value-0123456789',
    POSTGRES_PASSWORD: 'pa@ss/word:1',
    FORTYTWO_CLIENT_SECRET: 's-1234567890',
    SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T000/B000/XXXX',
    SMTP_PASSWORD: 'abc', // too short to be searched for: it would mangle ordinary words
  };

  it('hides every secret, in clear and url-encoded', () => {
    const text = [
      `the password is ${env.POSTGRES_PASSWORD}`,
      `or ${encodeURIComponent(env.POSTGRES_PASSWORD)}`,
      `secret=${env.AUTH_SECRET} and ${env.FORTYTWO_CLIENT_SECRET}`,
      `posted to ${env.SLACK_WEBHOOK_URL}`,
    ].join('\n');
    const result = redact(text, env);
    for (const value of [
      env.AUTH_SECRET,
      env.POSTGRES_PASSWORD,
      encodeURIComponent(env.POSTGRES_PASSWORD),
      env.FORTYTWO_CLIENT_SECRET,
      env.SLACK_WEBHOOK_URL,
    ]) {
      expect(result).not.toContain(value);
    }
    expect(result).toContain('***');
  });

  it('hides any database address, even one it does not know', () => {
    expect(redact('at postgresql://user:hunter2@db:5432/x?schema=public failed', {})).toBe(
      'at postgresql://*** failed',
    );
  });

  it('leaves ordinary text alone', () => {
    expect(redact('Prisma schema loaded from prisma/schema.prisma', env)).toBe(
      'Prisma schema loaded from prisma/schema.prisma',
    );
  });
});

describe('buildDatabaseUrl', () => {
  it('encodes every part, so that a password with @ / : cannot cut the address', () => {
    const url = buildDatabaseUrl({
      POSTGRES_USER: 'bde',
      POSTGRES_PASSWORD: 'pa@ss/word:1?#',
      POSTGRES_DB: 'bde_network',
    });
    const parsed = new URL(url);
    expect(parsed.hostname).toBe('postgres');
    expect(decodeURIComponent(parsed.password)).toBe('pa@ss/word:1?#');
    expect(parsed.pathname).toBe('/bde_network');
  });

  it('is empty when a setting is missing', () => {
    expect(buildDatabaseUrl({ POSTGRES_USER: 'bde' })).toBe('');
  });
});

describe('parseReport', () => {
  it('keeps the kind and the variable names', () => {
    expect(parseReport('{"kind":"env","variables":["AUTH_SECRET","SMTP_HOST"]}')).toEqual({
      kind: 'env',
      code: '',
      retry: false,
      variables: ['AUTH_SECRET', 'SMTP_HOST'],
    });
  });

  it('drops anything that is not a variable name, so a value can never get through', () => {
    const report = parseReport(
      JSON.stringify({
        kind: 'env',
        variables: ['AUTH_SECRET', 'hunter2 is my password', '<b>x</b>', 42],
      }),
    );
    expect(report?.variables).toEqual(['AUTH_SECRET']);
  });

  it('refuses an unknown kind, and anything that is not JSON', () => {
    expect(parseReport('{"kind":"nope"}')).toBeNull();
    expect(parseReport('not json')).toBeNull();
    expect(parseReport('null')).toBeNull();
  });
});

describe('pickLanguage', () => {
  it('follows ?lang= first', () => {
    expect(pickLanguage('/x?lang=en', 'fr-FR')).toBe('en');
    expect(pickLanguage('/x?lang=fr', 'en-US')).toBe('fr');
  });
  it('then the browser, French by default', () => {
    expect(pickLanguage('/', 'en-GB,en;q=0.9')).toBe('en');
    expect(pickLanguage('/', 'fr-FR,fr;q=0.9,en;q=0.8')).toBe('fr');
    expect(pickLanguage('/', undefined)).toBe('fr');
    expect(pickLanguage('/', 'de-DE')).toBe('fr');
  });
});

describe('renderProblemPage', () => {
  const kinds = [
    'env',
    'config',
    'database-auth',
    'database-unreachable',
    'database-url',
    'migration',
  ];

  it.each(kinds)('%s: a complete page in both languages', (kind) => {
    for (const lang of ['fr', 'en']) {
      const html = renderProblemPage(
        { kind, code: 'P1000', variables: ['AUTH_SECRET'] },
        lang,
        false,
      );
      expect(html).toContain(`<html lang="${lang}">`);
      expect(html).toContain(`<title>${problemTitle(kind, lang).replace(/'/g, '&#39;')}</title>`);
      expect(html).toContain('docker compose'); // what to do, not only what is wrong
      expect(html).toContain('noindex');
    }
    // the two languages really differ
    expect(problemTitle(kind, 'fr')).not.toBe(problemTitle(kind, 'en'));
  });

  it('lists the variables to check and the error code', () => {
    const html = renderProblemPage(
      { kind: 'env', code: '', variables: ['AUTH_SECRET', 'SMTP_HOST'] },
      'fr',
      false,
    );
    expect(html).toContain('<code>AUTH_SECRET</code>, <code>SMTP_HOST</code>');
    const withCode = renderProblemPage(
      { kind: 'migration', code: 'P3009', variables: [] },
      'en',
      false,
    );
    expect(withCode).toContain('<code>P3009</code>');
  });

  it('refreshes by itself only while waiting for something that can fix itself', () => {
    const problem = { kind: 'database-unreachable', code: 'P1001', variables: [] };
    expect(renderProblemPage(problem, 'fr', true)).toContain('http-equiv="refresh"');
    expect(renderProblemPage(problem, 'fr', false)).not.toContain('http-equiv="refresh"');
  });

  it('can only show fixed sentences, variable names and a Prisma code: nothing a person typed', () => {
    const html = renderProblemPage(
      {
        kind: 'env',
        code: 'hunter2-the-password',
        variables: ['AUTH_SECRET', 'postgresql://bde:hunter2@db/x', '<script>alert(1)</script>'],
        detail: 'hunter2',
      } as never,
      'fr',
      false,
    );
    expect(html).not.toContain('hunter2');
    expect(html).not.toContain('<script');
    expect(html).toContain('<code>AUTH_SECRET</code>');
  });

  it('has no script, nothing external, and a switch to the other language', () => {
    const html = renderProblemPage({ kind: 'env', code: '', variables: [] }, 'fr', false);
    // (the SVG namespace is a name, not a request)
    expect(html.replace(/xmlns="[^"]*"/, '')).not.toMatch(/<script|src=|https?:\/\//);
    expect(html).toContain('href="?lang=en"');
    expect(renderProblemPage({ kind: 'env', code: '', variables: [] }, 'en', false)).toContain(
      'href="?lang=fr"',
    );
  });

  it('falls back on a generic page for an unknown kind', () => {
    const html = renderProblemPage({ kind: 'whatever', code: '', variables: [] }, 'fr', false);
    expect(html).toContain(problemTitle('migration', 'fr'));
  });
});

describe('the page looks like the app', () => {
  const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');
  const block = (selector: string): string => {
    const start = css.indexOf(`${selector} {`);
    return css.slice(start, css.indexOf('}', start));
  };
  const token = (scope: string, name: string): string | undefined =>
    new RegExp(`--${name}:\\s*([^;]+);`).exec(block(scope))?.[1]?.trim();

  const used = [
    'background',
    'foreground',
    'card',
    'muted',
    'muted-foreground',
    'border',
    'destructive',
  ];

  it.each(used)('uses the %s token of globals.css, light and dark', (name) => {
    const [light, dark] = PAGE_STYLE.split('@media (prefers-color-scheme:dark)');
    expect(light).toContain(`--${name}:${token(':root', name)}`);
    expect(dark).toContain(`--${name}:${token('.dark', name)}`);
  });

  it('uses the radius of the cards', () => {
    expect(PAGE_STYLE).toContain(`--radius:${token(':root', 'radius')}`);
  });
});

describe('the pages of a safe update', () => {
  const KINDS = [
    'stack-old-compose',
    'stack-old-image',
    'database-newer',
    'migration-stuck',
    'migration-restored',
    'migration-restore-failed',
    'backup-failed',
    'existing-data',
  ];
  const COPY = 'pre-update_20261015T101530Z_v1.1.0.sql.gz';

  it.each(KINDS)(
    '%s has a title, a lead and steps in both languages, and is not the generic page',
    (kind) => {
      for (const lang of ['fr', 'en']) {
        const html = renderProblemPage({ kind, code: '' }, lang, false);
        expect(problemTitle(kind, lang)).not.toBe(problemTitle('migration', lang));
        expect(html).toContain('<ol><li>');
        expect(html).toContain(`lang="${lang}"`);
      }
    },
  );

  it('names the safety copy, the migrations and the version, as code', () => {
    const html = renderProblemPage(
      {
        kind: 'migration-restored',
        code: 'P3018',
        backup: COPY,
        migrations: ['20261015120000_event_series_scope'],
        version: '1.1.0',
      },
      'fr',
      false,
    );
    expect(html).toContain(`<code>${COPY}</code>`);
    expect(html).toContain('<code>20261015120000_event_series_scope</code>');
    expect(html).toContain('<code>1.1.0</code>');
    expect(html).toContain('<code>P3018</code>');
  });

  it('shows nothing that is not what the supervisor writes: a file name of ours, migration names, a version', () => {
    const html = renderProblemPage(
      {
        kind: 'migration-restored',
        backup: '<script>alert(1)</script>.sql.gz',
        migrations: ['<img src=x onerror=alert(1)>', 'secret-password'],
        version: '1.0"><script>',
      },
      'en',
      false,
    );
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('secret-password');
    expect(html).not.toContain('Safety copy');
    expect(html).not.toContain('Migrations involved');
    expect(html).not.toContain('Platform version');
  });

  it('points to the command that puts the copy back, where it matters', () => {
    for (const kind of ['migration-restore-failed', 'migration-stuck', 'database-newer']) {
      expect(renderProblemPage({ kind, code: '' }, 'en', false)).toContain(
        'restore.sh --pre-update',
      );
    }
  });

  it("draws the problems that need the operator's eyes as alerts, and the others as database problems", () => {
    expect(renderProblemPage({ kind: 'migration-restore-failed' }, 'en', false)).toContain(
      'class="icon alert"',
    );
    expect(renderProblemPage({ kind: 'migration-restored' }, 'en', false)).not.toContain(
      'class="icon alert"',
    );
  });
});

describe('what the container learns from a failed start', () => {
  it('an empty database address is the address problem, not "another failure" (the incident of an old image)', () => {
    expect(
      classifyMigrationFailure('Error: Connection url is empty. See https://pris.ly/d/config-url'),
    ).toMatchObject({
      kind: 'database-url',
      retry: false,
    });
  });

  it('knows the report of an installer that refuses to open over existing data', () => {
    expect(parseReport(JSON.stringify({ kind: 'existing-data', variables: [] }))).toMatchObject({
      kind: 'existing-data',
    });
  });
});
