// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The server side of the installer. What matters is that nothing works without the installer session, that
 * everything is validated again on the server, that nothing secret goes back to the browser, and that once the
 * platform is installed every action is a 404.
 */

const mocks = vi.hoisted(() => {
  class NotFound extends Error {}
  return {
    NotFound,
    jar: new Map<string, { value: string; options: Record<string, unknown> }>(),
    requestHeaders: new Map<string, string>(),
    verifyCredentials: vi.fn(),
    listCampuses: vi.fn(),
    checkLogin: vi.fn(),
    sendDiscordTest: vi.fn(),
    sendSlackTest: vi.fn(),
    sendTestMail: vi.fn(),
    installPlatform: vi.fn(),
    startScheduler: vi.fn(),
  };
});

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const entry = mocks.jar.get(name);
      return entry ? { name, value: entry.value } : undefined;
    },
    set: (name: string, value: string, options: Record<string, unknown>) =>
      void mocks.jar.set(name, { value, options }),
    delete: (name: string) => void mocks.jar.delete(name),
  }),
  headers: async () => ({ get: (name: string) => mocks.requestHeaders.get(name) ?? null }),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new mocks.NotFound('NOT_FOUND');
  },
}));
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string, values?: Record<string, string>) =>
    `${key}${values ? JSON.stringify(values) : ''}`,
}));
vi.mock('@/lib/setup/fortytwo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/setup/fortytwo')>()),
  verifyCredentials: mocks.verifyCredentials,
  listCampuses: mocks.listCampuses,
  checkLogin: mocks.checkLogin,
}));
vi.mock('@/lib/setup/notify-test', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/setup/notify-test')>()),
  sendDiscordTest: mocks.sendDiscordTest,
  sendSlackTest: mocks.sendSlackTest,
  sendTestMail: mocks.sendTestMail,
}));
vi.mock('@/lib/settings/store', () => ({ installPlatform: mocks.installPlatform }));
vi.mock('@/lib/events/scheduler', () => ({ startEventReminderScheduler: mocks.startScheduler }));

const actions = await import('./actions');
const guard = await import('@/lib/setup/guard');
const { draftFor } = await import('@/lib/setup/draft');

const UID = 'u-s4t2ud-uid-abcdef';
const SECRET = 's-s4t2ud-secret-abcdef';

/** The installer session of the browser: starts the mode, gives the right code. */
async function signIn() {
  const code = guard.startSetupMode();
  const result = await actions.submitCode(code);
  expect(result).toEqual({ ok: true });
  const token = mocks.jar.get(guard.SETUP_COOKIE)?.value ?? '';
  return { code, token, key: guard.setupSessionKey(token) ?? '' };
}

beforeEach(() => {
  vi.clearAllMocks();
  // What the container's start-up gives the server before anything else runs (docker/start.mjs).
  vi.stubEnv('AUTH_SECRET', 'x'.repeat(44));
  vi.stubEnv('DATABASE_URL', 'postgresql://bde:pw@postgres:5432/bde_network?schema=public');
  mocks.jar.clear();
  mocks.requestHeaders.clear();
  guard.leaveSetupMode();
  mocks.verifyCredentials.mockResolvedValue({ ok: true, token: 'app-token' });
  mocks.listCampuses.mockResolvedValue([
    { id: 1, name: 'Nice', country: 'France', timeZone: 'Europe/Paris' },
    { id: 2, name: 'Paris', country: 'France', timeZone: 'Europe/Paris' },
  ]);
  mocks.checkLogin.mockResolvedValue('exists');
  mocks.installPlatform.mockResolvedValue('installed');
});

/** Answers every step, as the page would. */
async function answerEverything() {
  expect(
    await actions.saveIdentity({ name: 'BDE Test', accentColor: '#0F766E', messageLocale: 'fr' }),
  ).toEqual({ ok: true });
  expect(await actions.saveAddress({ address: 'https://bde.exemple.fr' })).toMatchObject({
    ok: true,
  });
  expect(await actions.verifyFortyTwo({ clientId: UID, clientSecret: SECRET })).toEqual({
    ok: true,
  });
  expect(
    await actions.saveCampuses({
      campuses: ['Nice'],
      mainCampus: 'Nice',
      timezone: 'Europe/Paris',
    }),
  ).toEqual({ ok: true });
  expect(await actions.saveOwners({ owners: ['alice'] })).toEqual({ ok: true });
  expect(await actions.saveModules({ events: true })).toEqual({ ok: true });
  expect(await actions.saveNotifications({ mode: 'none' })).toEqual({ ok: true });
}

describe('without the code', () => {
  it('answers "session" to every action, and does nothing', async () => {
    guard.startSetupMode();
    const calls = [
      () => actions.saveIdentity({ name: 'x', accentColor: '#000', messageLocale: 'fr' }),
      () => actions.saveAddress({ address: 'localhost' }),
      () => actions.verifyFortyTwo({ clientId: UID, clientSecret: SECRET }),
      () => actions.skipFortyTwoVerification({ clientId: UID, clientSecret: SECRET }),
      () => actions.loadCampuses(),
      () => actions.saveCampuses({ campuses: [], mainCampus: 'Nice', timezone: 'UTC' }),
      () => actions.checkOwner({ login: 'alice' }),
      () => actions.saveOwners({ owners: ['alice'] }),
      () => actions.saveModules({ events: true }),
      () => actions.saveNotifications({ mode: 'none' }),
      () => actions.testNotification({ mode: 'none' }, { locale: 'fr' }),
      () => actions.finishInstallation(),
    ];
    for (const call of calls) expect(await call()).toMatchObject({ ok: false, code: 'session' });
    expect(mocks.verifyCredentials).not.toHaveBeenCalled();
    expect(mocks.installPlatform).not.toHaveBeenCalled();
  });

  it('refuses a made-up or an expired session cookie', async () => {
    guard.startSetupMode();
    mocks.jar.set(guard.SETUP_COOKIE, { value: 'a-forged-token', options: {} });
    expect(await actions.saveModules({ events: true })).toMatchObject({
      ok: false,
      code: 'session',
    });
  });

  it('refuses a session of an earlier start of the server', async () => {
    const { token } = await signIn();
    guard.startSetupMode(); // the server restarted: new code, no session
    mocks.jar.set(guard.SETUP_COOKIE, { value: token, options: {} });
    expect(await actions.saveModules({ events: true })).toMatchObject({
      ok: false,
      code: 'session',
    });
  });
});

describe('submitCode', () => {
  it('gives an HttpOnly, SameSite=Strict cookie for the right code, not secure over plain http', async () => {
    await signIn();
    expect(mocks.jar.get(guard.SETUP_COOKIE)?.options).toMatchObject({
      httpOnly: true,
      sameSite: 'strict',
      secure: false,
      path: '/',
      maxAge: 7200,
    });
  });

  it('makes the cookie secure behind an HTTPS proxy', async () => {
    mocks.requestHeaders.set('x-forwarded-proto', 'https');
    await signIn();
    expect(mocks.jar.get(guard.SETUP_COOKIE)?.options.secure).toBe(true);
  });

  it('refuses a wrong code and gives no cookie, then locks the entry', async () => {
    guard.startSetupMode();
    expect(await actions.submitCode('NOPE-NOPE')).toEqual({ ok: false, code: 'wrong' });
    expect(mocks.jar.size).toBe(0);
    for (let attempt = 0; attempt < 3; attempt++) await actions.submitCode('NOPE-NOPE');
    expect(await actions.submitCode('NOPE-NOPE')).toMatchObject({
      ok: false,
      code: 'locked',
      retryAfterSeconds: 30,
    });
  });

  it('refuses what is not a short text', async () => {
    guard.startSetupMode();
    expect(await actions.submitCode('x'.repeat(100))).toEqual({ ok: false, code: 'wrong' });
    expect(await actions.submitCode(42 as unknown as string)).toEqual({ ok: false, code: 'wrong' });
  });
});

describe('once the platform is installed', () => {
  it('every action is a 404, with a valid session cookie or without', async () => {
    const { token } = await signIn();
    guard.leaveSetupMode();
    mocks.jar.set(guard.SETUP_COOKIE, { value: token, options: {} });

    for (const call of [
      () => actions.submitCode('AAAA-AAAA'),
      () => actions.saveIdentity({}),
      () => actions.verifyFortyTwo({}),
      () => actions.loadCampuses(),
      () => actions.checkOwner({}),
      () => actions.finishInstallation(),
    ]) {
      await expect(call()).rejects.toThrow(mocks.NotFound);
    }
    expect(mocks.verifyCredentials).not.toHaveBeenCalled();
    expect(mocks.installPlatform).not.toHaveBeenCalled();
  });
});

describe('the steps', () => {
  beforeEach(async () => {
    await signIn();
  });

  it('1. validates the name and the color again, and keeps the clean ones', async () => {
    expect(
      await actions.saveIdentity({ name: '  ', accentColor: '#0f766e', messageLocale: 'fr' }),
    ).toMatchObject({ ok: false, code: 'name', field: 'name' });
    expect(
      await actions.saveIdentity({ name: 'BDE', accentColor: 'red', messageLocale: 'fr' }),
    ).toMatchObject({ ok: false, code: 'color', field: 'accentColor' });
    expect(
      await actions.saveIdentity({ name: 'BDE', accentColor: '#0f766e', messageLocale: 'de' }),
    ).toMatchObject({ ok: false, code: 'invalid' });
    expect(await actions.saveIdentity({ name: 5 })).toMatchObject({ ok: false, code: 'invalid' });
    expect(
      await actions.saveIdentity({ name: ' BDE Test ', accentColor: '#ABC', messageLocale: 'en' }),
    ).toEqual({ ok: true });
  });

  it('1. validates the contact address (optional) again: blank is fine, a wrong one is refused', async () => {
    const identity = { name: 'BDE', accentColor: '#0f766e', messageLocale: 'fr' } as const;
    expect(await actions.saveIdentity({ ...identity, contactEmail: '' })).toEqual({ ok: true });
    expect(await actions.saveIdentity(identity)).toEqual({ ok: true });
    expect(
      await actions.saveIdentity({ ...identity, contactEmail: ' bureau@exemple.fr ' }),
    ).toEqual({ ok: true });
    expect(await actions.saveIdentity({ ...identity, contactEmail: 'bureau@' })).toMatchObject({
      ok: false,
      code: 'email',
      field: 'contactEmail',
    });
  });

  it('2. never accepts 0.0.0.0, which is where the server listens and not an address (crafted request included)', async () => {
    for (const address of ['http://0.0.0.0:3000', '0.0.0.0', '0.0.0.0:3000']) {
      expect(await actions.saveAddress({ address, acceptInsecure: true })).toMatchObject({
        ok: false,
        code: 'addressUnspecified',
        field: 'address',
      });
    }
  });

  it('2. gives the redirect address to declare, and wants an explicit yes for plain http on a domain', async () => {
    expect(await actions.saveAddress({ address: 'nonsense' })).toMatchObject({
      ok: false,
      code: 'address',
    });
    expect(await actions.saveAddress({ address: 'http://bde.exemple.fr' })).toMatchObject({
      ok: false,
      code: 'insecure',
    });
    expect(
      await actions.saveAddress({ address: 'http://bde.exemple.fr', acceptInsecure: true }),
    ).toMatchObject({ ok: true, url: 'http://bde.exemple.fr' });
    expect(await actions.saveAddress({ address: 'https://bde.exemple.fr/' })).toEqual({
      ok: true,
      url: 'https://bde.exemple.fr',
      redirectUrl: 'https://bde.exemple.fr/api/auth/callback/42-school',
    });
  });

  describe('3. the 42 application', () => {
    it('is checked with 42, and the secret never comes back', async () => {
      const result = await actions.verifyFortyTwo({ clientId: UID, clientSecret: SECRET });
      expect(result).toEqual({ ok: true });
      expect(mocks.verifyCredentials).toHaveBeenCalledWith(expect.any(Function), UID, SECRET);
      expect(JSON.stringify(result)).not.toContain(SECRET);
    });

    it.each([
      [{ ok: false, reason: 'invalid' }, 'invalidCredentials'],
      [{ ok: false, reason: 'rate-limited' }, 'rateLimited'],
      [{ ok: false, reason: 'network', detail: 'ENOTFOUND' }, 'network'],
      [{ ok: false, reason: 'unexpected', status: 503 }, 'network'],
    ])('answers %j with the code %s', async (check, code) => {
      mocks.verifyCredentials.mockResolvedValue(check);
      const result = await actions.verifyFortyTwo({ clientId: UID, clientSecret: SECRET });
      expect(result).toMatchObject({ ok: false, code });
      expect(JSON.stringify(result)).not.toContain(SECRET);
    });

    it('does not even ask 42 about an identifier that cannot be one, or a pair that is swapped', async () => {
      expect(await actions.verifyFortyTwo({ clientId: 'x', clientSecret: SECRET })).toMatchObject({
        ok: false,
        code: 'clientId',
        field: 'clientId',
      });
      expect(await actions.verifyFortyTwo({ clientId: SECRET, clientSecret: UID })).toMatchObject({
        ok: false,
        code: 'swapped',
      });
      expect(await actions.verifyFortyTwo({ clientId: UID, clientSecret: '' })).toMatchObject({
        ok: false,
        code: 'clientSecret',
      });
      expect(mocks.verifyCredentials).not.toHaveBeenCalled();
    });

    it('keeps the secret typed before when the field is left empty', async () => {
      await actions.verifyFortyTwo({ clientId: UID, clientSecret: SECRET });
      expect(await actions.verifyFortyTwo({ clientId: UID, clientSecret: '' })).toEqual({
        ok: true,
      });
      expect(mocks.verifyCredentials).toHaveBeenLastCalledWith(expect.any(Function), UID, SECRET);
    });

    it('lets the person go on without the check when 42 cannot be reached', async () => {
      expect(
        await actions.skipFortyTwoVerification({ clientId: UID, clientSecret: SECRET }),
      ).toEqual({ ok: true });
      expect(await actions.loadCampuses()).toEqual({ ok: true, campuses: null });
      expect(mocks.listCampuses).not.toHaveBeenCalled();
    });
  });

  describe('4. the campuses', () => {
    it('are listed from 42 with the token of the application, once', async () => {
      await actions.verifyFortyTwo({ clientId: UID, clientSecret: SECRET });
      const first = await actions.loadCampuses();
      await actions.loadCampuses();
      expect(first).toEqual({
        ok: true,
        campuses: [
          { name: 'Nice', country: 'France', timeZone: 'Europe/Paris' },
          { name: 'Paris', country: 'France', timeZone: 'Europe/Paris' },
        ],
      });
      expect(mocks.listCampuses).toHaveBeenCalledTimes(1);
      expect(mocks.listCampuses).toHaveBeenCalledWith(
        expect.any(Function),
        'app-token',
        expect.any(Function),
      );
      expect(JSON.stringify(first)).not.toContain('app-token');
    });

    it('are typed by hand when 42 gives no list', async () => {
      mocks.listCampuses.mockResolvedValue(null);
      await actions.verifyFortyTwo({ clientId: UID, clientSecret: SECRET });
      expect(await actions.loadCampuses()).toEqual({ ok: true, campuses: null });
    });

    it('are validated: the campus of the BDE is one of the allowed, the time zone exists', async () => {
      expect(
        await actions.saveCampuses({
          campuses: ['Nice'],
          mainCampus: 'Paris',
          timezone: 'Europe/Paris',
        }),
      ).toMatchObject({ ok: false, code: 'campusNotListed', field: 'mainCampus' });
      expect(
        await actions.saveCampuses({
          campuses: ['Nice'],
          mainCampus: 'Nice',
          timezone: 'Mars/Olympus',
        }),
      ).toMatchObject({ ok: false, code: 'timezone' });
      expect(
        await actions.saveCampuses({ campuses: ['Nice'], mainCampus: '', timezone: 'UTC' }),
      ).toMatchObject({ ok: false, code: 'campus' });
      expect(
        await actions.saveCampuses({ campuses: ['a\nb'], mainCampus: 'Nice', timezone: 'UTC' }),
      ).toMatchObject({ ok: false, code: 'campus', field: 'campuses' });
      expect(
        await actions.saveCampuses({ campuses: [], mainCampus: 'Nice', timezone: 'Europe/Paris' }),
      ).toEqual({ ok: true });
    });
  });

  describe('5. the owners', () => {
    it('are checked with 42, one login at a time', async () => {
      await actions.verifyFortyTwo({ clientId: UID, clientSecret: SECRET });
      expect(await actions.checkOwner({ login: ' Alice ' })).toEqual({
        ok: true,
        login: 'alice',
        status: 'exists',
      });
      expect(mocks.checkLogin).toHaveBeenCalledWith(
        expect.any(Function),
        'app-token',
        'alice',
        expect.any(Function),
      );

      mocks.checkLogin.mockResolvedValue('missing');
      expect(await actions.checkOwner({ login: 'nobody' })).toMatchObject({
        ok: false,
        code: 'loginMissing',
      });

      mocks.checkLogin.mockResolvedValue('unknown');
      expect(await actions.checkOwner({ login: 'alice' })).toMatchObject({
        ok: true,
        status: 'unknown',
      });
    });

    it('are not asked to 42 when there is no token, and a bad login is refused before', async () => {
      expect(await actions.checkOwner({ login: 'alice' })).toMatchObject({
        ok: true,
        status: 'unknown',
      });
      expect(await actions.checkOwner({ login: 'a b' })).toMatchObject({
        ok: false,
        code: 'login',
      });
      expect(mocks.checkLogin).not.toHaveBeenCalled();
    });

    it('are at least one, valid, and listed once', async () => {
      expect(await actions.saveOwners({ owners: [] })).toMatchObject({
        ok: false,
        code: 'noOwner',
      });
      expect(await actions.saveOwners({ owners: ['alice', 'not valid!'] })).toMatchObject({
        ok: false,
        code: 'login',
      });
      expect(await actions.saveOwners({ owners: ['Alice', 'alice', 'bob'] })).toEqual({ ok: true });
    });
  });

  describe('7. the notifications', () => {
    it('Discord: the webhook is checked, kept when left empty, and never sent back', async () => {
      const webhook = 'https://discord.com/api/webhooks/123456789/secret-part';
      expect(
        await actions.saveNotifications({
          mode: 'discord',
          discordWebhook: 'https://evil.example/x',
        }),
      ).toMatchObject({ ok: false, code: 'discord', field: 'discordWebhook' });
      expect(await actions.saveNotifications({ mode: 'discord', discordWebhook: webhook })).toEqual(
        { ok: true },
      );
      expect(await actions.saveNotifications({ mode: 'discord', discordWebhook: '' })).toEqual({
        ok: true,
      });
      expect(await actions.saveNotifications({ mode: 'slack', slackWebhook: '' })).toMatchObject({
        ok: false,
        code: 'slack',
      });
    });

    it('e-mail: every setting is validated', async () => {
      const smtp = {
        host: 'smtp.exemple.fr',
        port: '587',
        user: 'bde',
        password: 'p4ss',
        from: 'bde@exemple.fr',
      };
      expect(
        await actions.saveNotifications({ mode: 'email', smtp: { ...smtp, host: 'not a host' } }),
      ).toMatchObject({ ok: false, code: 'smtpHost', field: 'smtpHost' });
      expect(
        await actions.saveNotifications({ mode: 'email', smtp: { ...smtp, port: '99999' } }),
      ).toMatchObject({ ok: false, code: 'port', field: 'smtpPort' });
      expect(
        await actions.saveNotifications({ mode: 'email', smtp: { ...smtp, from: 'nope' } }),
      ).toMatchObject({ ok: false, code: 'email', field: 'smtpFrom' });
      expect(
        await actions.saveNotifications({ mode: 'email', smtp: { ...smtp, password: "it's" } }),
      ).toMatchObject({ ok: false, code: 'secretChars' });
      expect(await actions.saveNotifications({ mode: 'email' })).toMatchObject({
        ok: false,
        code: 'invalid',
      });
      expect(await actions.saveNotifications({ mode: 'email', smtp })).toEqual({ ok: true });
      expect(
        await actions.saveNotifications({ mode: 'email', smtp: { ...smtp, password: '' } }),
      ).toEqual({ ok: true });
    });

    it('a test message goes through what was typed, with the name of the BDE, and says why it failed', async () => {
      await actions.saveIdentity({ name: 'BDE Test', accentColor: '#0f766e', messageLocale: 'fr' });
      const webhook = 'https://discord.com/api/webhooks/123456789/secret-part';
      mocks.sendDiscordTest.mockResolvedValue({ ok: true });

      expect(
        await actions.testNotification(
          { mode: 'discord', discordWebhook: webhook },
          { locale: 'fr' },
        ),
      ).toEqual({ ok: true });
      expect(mocks.sendDiscordTest).toHaveBeenCalledWith(
        expect.any(Function),
        webhook,
        expect.stringContaining('BDE Test'),
      );

      mocks.sendDiscordTest.mockResolvedValue({ ok: false, detail: 'HTTP 404' });
      const failed = await actions.testNotification(
        { mode: 'discord', discordWebhook: webhook },
        { locale: 'fr' },
      );
      expect(failed).toEqual({ ok: false, code: 'testFailed', detail: 'HTTP 404' });
      expect(JSON.stringify(failed)).not.toContain('secret-part');
    });

    it('a test e-mail needs an address to send to', async () => {
      const smtp = {
        host: 'smtp.exemple.fr',
        port: '587',
        user: '',
        password: '',
        from: 'bde@exemple.fr',
      };
      expect(
        await actions.testNotification({ mode: 'email', smtp }, { locale: 'en', to: 'nope' }),
      ).toMatchObject({ ok: false, code: 'email', field: 'testTo' });
      mocks.sendTestMail.mockResolvedValue({ ok: true });
      expect(
        await actions.testNotification(
          { mode: 'email', smtp },
          { locale: 'en', to: 'me@exemple.fr' },
        ),
      ).toEqual({ ok: true });
      expect(mocks.sendTestMail).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ host: 'smtp.exemple.fr' }),
        'me@exemple.fr',
        expect.any(String),
        expect.any(String),
      );
    });
  });
});

describe('the end', () => {
  it('installs what was answered, forgets the code and the answers, and starts what the config needs', async () => {
    const { key } = await signIn();
    await answerEverything();

    expect(await actions.finishInstallation()).toEqual({ ok: true });

    expect(mocks.installPlatform).toHaveBeenCalledTimes(1);
    const [{ config, values }] = mocks.installPlatform.mock.calls[0] ?? [];
    expect(config.bde).toMatchObject({ name: 'BDE Test', campus: 'Nice', accentColor: '#0f766e' });
    expect(config.auth.owners).toEqual(['alice']);
    expect(values).toEqual({
      APP_URL: 'https://bde.exemple.fr',
      FORTYTWO_CLIENT_ID: UID,
      FORTYTWO_CLIENT_SECRET: SECRET,
    });

    expect(guard.isSetupMode()).toBe(false);
    expect(guard.setupSessionKey(mocks.jar.get(guard.SETUP_COOKIE)?.value)).toBeNull();
    expect(draftFor(key).step).toBe(0); // a fresh, empty draft: the old one is gone
    expect(mocks.startScheduler).toHaveBeenCalled();
  });

  it('refuses an installation that lacks an answer', async () => {
    await signIn();
    await actions.saveIdentity({ name: 'BDE Test', accentColor: '#0f766e', messageLocale: 'fr' });
    expect(await actions.finishInstallation()).toMatchObject({ ok: false, code: 'incomplete' });
    expect(mocks.installPlatform).not.toHaveBeenCalled();
    expect(guard.isSetupMode()).toBe(true);
  });

  it('is a 404 for the loser when two people finish at the same moment', async () => {
    await signIn();
    await answerEverything();
    mocks.installPlatform.mockResolvedValue('already-installed');
    await expect(actions.finishInstallation()).rejects.toThrow(mocks.NotFound);
    expect(guard.isSetupMode()).toBe(false);
  });

  it('never lets a secret into any answer of the whole walk', async () => {
    await signIn();
    const answers: unknown[] = [];
    answers.push(
      await actions.saveIdentity({ name: 'BDE Test', accentColor: '#0f766e', messageLocale: 'fr' }),
    );
    answers.push(await actions.saveAddress({ address: 'https://bde.exemple.fr' }));
    answers.push(await actions.verifyFortyTwo({ clientId: UID, clientSecret: SECRET }));
    answers.push(await actions.loadCampuses());
    answers.push(await actions.checkOwner({ login: 'alice' }));
    answers.push(
      await actions.saveNotifications({
        mode: 'slack',
        slackWebhook: 'https://hooks.slack.com/services/T1/B1/secret-part',
      }),
    );
    answers.push(await actions.testNotification({ mode: 'slack' }, { locale: 'fr' }));
    const text = JSON.stringify(answers);
    for (const secret of [SECRET, 'app-token', 'secret-part']) expect(text).not.toContain(secret);
  });
});
