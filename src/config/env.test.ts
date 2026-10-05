import { describe, expect, it } from 'vitest';
import { formatEnvironmentErrors, PLACEHOLDER_OWNER, validateEnvironment } from './env';
import { bdeConfigSchema, type BdeConfig } from './schema';

const SECRET = 'x'.repeat(44);

const VALID_ENV = {
  AUTH_SECRET: SECRET,
  FORTYTWO_CLIENT_ID: 'u-s4t2ud-abc',
  FORTYTWO_CLIENT_SECRET: 's-s4t2ud-def',
  DATABASE_URL: 'postgresql://bde:pw@postgres:5432/bde_network?schema=public',
};

function configWith(overrides: {
  owners?: string[];
  modules?: string[];
  notifications?: Partial<Record<string, string>>;
}): BdeConfig {
  return bdeConfigSchema.parse({
    bde: {
      name: 'BDE Test',
      campus: 'Paris',
      timezone: 'Europe/Paris',
      defaultLocale: 'fr',
      accentColor: '#0f766e',
      logoPath: '/logo.svg',
    },
    auth: { owners: overrides.owners ?? ['alice'], allowedCampuses: ['Paris'] },
    modules: { enabled: overrides.modules ?? [] },
    events: { categories: [{ key: 'soiree', label: 'Soirée', color: '#db2777' }] },
    notifications: {
      memberPending: 'none',
      memberApproved: 'none',
      memberRemoved: 'none',
      ...overrides.notifications,
    },
  });
}

const check = (env: Record<string, string | undefined>, config = configWith({})) =>
  validateEnvironment(env, config);

describe('required variables', () => {
  it('accepts a complete .env', () => {
    expect(check(VALID_ENV)).toEqual({ errors: [], warnings: [] });
  });

  it('explains how to generate AUTH_SECRET when it is empty or missing', () => {
    for (const value of [undefined, '', '   ']) {
      const { errors } = check({ ...VALID_ENV, AUTH_SECRET: value });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('AUTH_SECRET est vide');
      expect(errors[0]).toContain('openssl rand -base64 32');
    }
  });

  it('refuses a short AUTH_SECRET and says how long it must be', () => {
    const { errors } = check({ ...VALID_ENV, AUTH_SECRET: 'court' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('trop court (5 caractères');
    expect(errors[0]).toContain('au moins 32');
  });

  it('asks for both 42 credentials, with the redirect URL to register', () => {
    const { errors } = check({
      ...VALID_ENV,
      FORTYTWO_CLIENT_ID: '',
      FORTYTWO_CLIENT_SECRET: undefined,
    });
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('FORTYTWO_CLIENT_ID est vide');
    expect(errors[1]).toContain('FORTYTWO_CLIENT_SECRET est vide');
    expect(errors[0]).toContain('https://profile.intra.42.fr/oauth/applications');
    expect(errors[0]).toContain('http://localhost:3000/api/auth/callback/42-school');
  });

  it('uses APP_URL for the redirect URL once it is set', () => {
    const { errors } = check({
      ...VALID_ENV,
      FORTYTWO_CLIENT_ID: '',
      APP_URL: 'https://bde.exemple.fr/',
    });
    expect(errors[0]).toContain('https://bde.exemple.fr/api/auth/callback/42-school');
  });

  it.each([undefined, '', 'mysql://u:p@h/db', 'not a url'])('refuses DATABASE_URL %j', (value) => {
    const { errors } = check({ ...VALID_ENV, DATABASE_URL: value });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('DATABASE_URL est vide ou invalide');
  });

  it('reports every problem at once, not just the first', () => {
    const { errors } = check({});
    expect(errors.map((error) => error.split(' ')[0])).toEqual([
      'AUTH_SECRET',
      'FORTYTWO_CLIENT_ID',
      'FORTYTWO_CLIENT_SECRET',
      'DATABASE_URL',
    ]);
  });
});

describe('APP_URL', () => {
  it('refuses something that is not an address', () => {
    expect(check({ ...VALID_ENV, APP_URL: 'bde exemple' }).errors[0]).toContain(
      "n'est pas une adresse valide",
    );
    expect(check({ ...VALID_ENV, APP_URL: 'ftp://bde.exemple.fr' }).errors[0]).toContain(
      'doit commencer par https://',
    );
  });

  it('accepts https, and http on the local machine, without a warning', () => {
    expect(check({ ...VALID_ENV, APP_URL: 'https://bde.exemple.fr' })).toEqual({
      errors: [],
      warnings: [],
    });
    expect(check({ ...VALID_ENV, APP_URL: 'http://localhost:3000' }).warnings).toEqual([]);
  });

  it('warns, without refusing to start, about a public http address', () => {
    const report = check({ ...VALID_ENV, APP_URL: 'http://bde.exemple.fr' });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toContain('pas chiffrées');
    expect(report.warnings[0]).toContain('docs/deployment.md');
  });
});

describe('notification channels', () => {
  const eventsConfig = (notifications: Record<string, string>) =>
    configWith({ modules: ['events'], notifications });

  it('does not ask for SMTP when nothing uses e-mail', () => {
    expect(check(VALID_ENV, eventsConfig({ eventConfirmed: 'none' })).errors).toEqual([]);
  });

  // memberPending is "email" in the example config but no use case sends it yet:
  // a fresh install must not be refused for it.
  it('ignores channels of notifications that nothing sends', () => {
    const config = configWith({ notifications: { memberPending: 'email' } });
    expect(check(VALID_ENV, config).errors).toEqual([]);
  });

  it('ignores events notifications while the events module is off', () => {
    const config = configWith({ notifications: { eventConfirmed: 'email' } });
    expect(check(VALID_ENV, config).errors).toEqual([]);
  });

  it('asks for the SMTP settings an events notification needs, and says how to opt out', () => {
    const { errors } = check(VALID_ENV, eventsConfig({ eventConfirmed: 'email' }));
    expect(errors.map((error) => error.split(' ')[0])).toEqual([
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_FROM',
    ]);
    expect(errors[0]).toContain('remplacez « email » par « none »');
  });

  it('checks the SMTP port is a number', () => {
    const env = { ...VALID_ENV, SMTP_HOST: 'smtp.x', SMTP_FROM: 'a@x.fr' };
    const config = eventsConfig({ eventReminder: 'email' });
    expect(check({ ...env, SMTP_PORT: '587' }, config).errors).toEqual([]);
    expect(check({ ...env, SMTP_PORT: 'abc' }, config).errors[0]).toContain('SMTP_PORT');
    expect(check({ ...env, SMTP_PORT: '99999' }, config).errors[0]).toContain('SMTP_PORT');
  });

  it.each([
    ['discord', 'DISCORD_WEBHOOK_URL'],
    ['slack', 'SLACK_WEBHOOK_URL'],
  ])('asks for the %s webhook, over https', (channel, variable) => {
    const config = eventsConfig({ eventConfirmed: channel });
    expect(check(VALID_ENV, config).errors[0]).toContain(`${variable} est vide`);
    expect(check({ ...VALID_ENV, [variable]: 'http://x' }, config).errors[0]).toContain(
      'commençant par https://',
    );
    expect(check({ ...VALID_ENV, [variable]: 'https://hooks.example/abc' }, config).errors).toEqual(
      [],
    );
  });

  it('reports a missing SMTP variable once even if two notifications use e-mail', () => {
    const config = eventsConfig({ eventConfirmed: 'email', eventReminder: 'email' });
    expect(check(VALID_ENV, config).errors).toHaveLength(3);
  });
});

describe('placeholder owner', () => {
  it('warns clearly, but still starts', () => {
    const report = check(VALID_ENV, configWith({ owners: [PLACEHOLDER_OWNER] }));

    expect(report.errors).toEqual([]);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toContain(PLACEHOLDER_OWNER);
    expect(report.warnings[0]).toContain("personne n'est propriétaire");
    expect(report.warnings[0]).toContain('docker compose restart app');
  });

  it('warns whatever the case, and even next to a real owner', () => {
    const config = configWith({ owners: ['alice', 'Votre-Login-42'] });
    expect(check(VALID_ENV, config).warnings).toHaveLength(1);
  });

  it('is quiet once a real login is there', () => {
    expect(check(VALID_ENV, configWith({ owners: ['alice'] })).warnings).toEqual([]);
  });
});

describe('formatEnvironmentErrors', () => {
  it('lists every problem and tells what to do next', () => {
    const text = formatEnvironmentErrors(['AUTH_SECRET est vide.', 'DATABASE_URL est vide.']);
    expect(text).toContain('2 valeurs du fichier .env doivent être corrigées');
    expect(text).toContain('• AUTH_SECRET est vide.');
    expect(text).toContain('• DATABASE_URL est vide.');
    expect(text).toContain('docker compose up -d');
  });

  it('is grammatical for a single problem', () => {
    expect(formatEnvironmentErrors(['x'])).toContain(
      'une valeur du fichier .env doit être corrigée',
    );
  });
});
