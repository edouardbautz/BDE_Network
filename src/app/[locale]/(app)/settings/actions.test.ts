// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The server side of the settings page: nothing without an OWNER (a crafted request is refused, not answered), the 42
 * application is asked BEFORE it is saved, and the writing itself is `updateSettings`'s (tested apart).
 */

const mocks = vi.hoisted(() => ({
  requireManager: vi.fn(),
  editable: vi.fn(),
  updateSettings: vi.fn(),
  verifyCredentials: vi.fn(),
  listCampuses: vi.fn(),
  checkLogin: vi.fn(),
  applicationToken: vi.fn(),
  sendDiscordTest: vi.fn(),
  sendSlackTest: vi.fn(),
  sendTestMail: vi.fn(),
  revalidatePath: vi.fn(),
  startScheduler: vi.fn(),
  stopScheduler: vi.fn(),
  saved: {} as Record<string, string | undefined>,
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string, values?: Record<string, string>) =>
    `${key}${values ? JSON.stringify(values) : ''}`,
}));
vi.mock('@/config', () => ({ getConfig: () => ({ bde: { name: 'BDE Test' } }) }));
vi.mock('@/lib/events/scheduler', () => ({
  startEventReminderScheduler: mocks.startScheduler,
  stopEventReminderScheduler: mocks.stopScheduler,
}));
vi.mock('@/lib/settings/access', () => ({
  requireSettingsManager: mocks.requireManager,
  isSettingsEditable: mocks.editable,
}));
vi.mock('@/lib/settings/fortytwo-token', () => ({ applicationToken: mocks.applicationToken }));
vi.mock('@/lib/settings/runtime', () => ({ setting: (key: string) => mocks.saved[key] }));
vi.mock('@/lib/settings/update', () => ({
  updateSettings: mocks.updateSettings,
  savedNotifications: (values: Record<string, string>) => ({
    mode: 'none',
    ...(values.DISCORD_WEBHOOK_URL && { discordWebhook: values.DISCORD_WEBHOOK_URL }),
  }),
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

const actions = await import('./actions');

const ACTOR = { user: { login: 'alice', id: 'u-alice' } };
const UID = 'u-s4t2ud-uid-abcdef';
const SECRET = 's-s4t2ud-secret-abcdef';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.saved = {
    FORTYTWO_CLIENT_ID: UID,
    FORTYTWO_CLIENT_SECRET: 's-s4t2ud-saved-secret',
  };
  mocks.requireManager.mockResolvedValue(ACTOR);
  mocks.editable.mockReturnValue(true);
  mocks.updateSettings.mockResolvedValue({ ok: true, changed: true });
  mocks.applicationToken.mockResolvedValue('app-token');
  mocks.verifyCredentials.mockResolvedValue({ ok: true, token: 'app-token' });
  mocks.checkLogin.mockResolvedValue('exists');
  mocks.listCampuses.mockResolvedValue([
    { id: 1, name: 'Nice', country: 'France', timeZone: 'Europe/Paris' },
  ]);
});

describe('who may call them', () => {
  it('refuses every action to anybody who is not an owner (it is a crafted request: it throws)', async () => {
    mocks.requireManager.mockRejectedValue(new Error('Forbidden'));
    const calls = [
      () => actions.saveIdentity({}),
      () => actions.saveAddress({}),
      () => actions.verifyFortyTwo({}),
      () => actions.skipFortyTwoVerification({}),
      () => actions.loadCampuses(),
      () => actions.saveCampuses({}),
      () => actions.checkOwner({}),
      () => actions.addOwner({}),
      () => actions.removeOwner({}),
      () => actions.saveModules({}),
      () => actions.saveNotifications({}),
      () => actions.testNotification({}, {}),
    ];
    for (const call of calls) await expect(call()).rejects.toThrow('Forbidden');
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    expect(mocks.verifyCredentials).not.toHaveBeenCalled();
    expect(mocks.checkLogin).not.toHaveBeenCalled();
  });

  it('answers "readOnly" while the settings are still in the files, and writes nothing', async () => {
    mocks.editable.mockReturnValue(false);
    expect(
      await actions.saveIdentity({ name: 'x', accentColor: '#000', messageLocale: 'fr' }),
    ).toMatchObject({ ok: false, code: 'readOnly' });
    expect(await actions.saveModules({ events: false })).toMatchObject({
      ok: false,
      code: 'readOnly',
    });
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });
});

describe('a change', () => {
  it('is made in the name of the owner who asked, and the whole layout is refreshed (name, colour, menu)', async () => {
    const result = await actions.saveIdentity({
      name: 'Le BDE',
      accentColor: '#0f766e',
      messageLocale: 'fr',
    });
    expect(result).toEqual({ ok: true });
    expect(mocks.updateSettings).toHaveBeenCalledWith(
      { section: 'identity', name: 'Le BDE', accentColor: '#0f766e', messageLocale: 'fr' },
      { login: 'alice', id: 'u-alice' },
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('gives back the code and the field when it is refused, and refreshes nothing', async () => {
    mocks.updateSettings.mockResolvedValue({ ok: false, code: 'name', field: 'name' });
    expect(
      await actions.saveIdentity({ name: ' ', accentColor: '#0f766e', messageLocale: 'fr' }),
    ).toEqual({ ok: false, code: 'name', field: 'name' });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('is refused when what the browser sent is not what the form sends', async () => {
    expect(await actions.saveIdentity({ name: 5 })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await actions.saveIdentity(null)).toMatchObject({ ok: false, code: 'invalid' });
    expect(await actions.saveCampuses({ campuses: 'Nice' })).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it('address: answers with the redirect address to declare on the 42 intra', async () => {
    expect(await actions.saveAddress({ address: 'https://bde.exemple.fr/' })).toEqual({
      ok: true,
      url: 'https://bde.exemple.fr',
      redirectUrl: 'https://bde.exemple.fr/api/auth/callback/42-school',
    });
    expect(await actions.saveAddress({ address: 'nope' })).toMatchObject({
      ok: false,
      code: 'address',
    });
  });

  it('modules: the reminders start with the module and stop with it', async () => {
    await actions.saveModules({ events: false });
    expect(mocks.startScheduler).not.toHaveBeenCalled();
    expect(mocks.stopScheduler).toHaveBeenCalledTimes(1);
    await actions.saveModules({ events: true });
    expect(mocks.startScheduler).toHaveBeenCalledTimes(1);
    expect(mocks.stopScheduler).toHaveBeenCalledTimes(1);
  });

  it('modules: a refused change leaves the reminders as they are', async () => {
    mocks.updateSettings.mockResolvedValueOnce({ ok: false, code: 'invalid' });
    await actions.saveModules({ events: false });
    expect(mocks.stopScheduler).not.toHaveBeenCalled();
    expect(mocks.startScheduler).not.toHaveBeenCalled();
  });

  it('notifications: what the form sent goes to the update untouched, which validates it', async () => {
    const input = { mode: 'discord', discordWebhook: 'https://discord.com/api/webhooks/1/x' };
    await actions.saveNotifications(input);
    expect(mocks.updateSettings).toHaveBeenCalledWith(
      { section: 'notifications', notifications: input },
      expect.anything(),
    );
  });
});

describe('the 42 application', () => {
  it('is asked to 42 before it is saved, and saved only when 42 accepts it', async () => {
    expect(await actions.verifyFortyTwo({ clientId: UID, clientSecret: SECRET })).toEqual({
      ok: true,
    });
    expect(mocks.verifyCredentials).toHaveBeenCalledWith(expect.any(Function), UID, SECRET);
    expect(mocks.updateSettings).toHaveBeenCalledWith(
      { section: 'oauth', clientId: UID, clientSecret: SECRET },
      expect.anything(),
    );
  });

  it.each([
    [{ ok: false, reason: 'invalid' }, 'invalidCredentials'],
    [{ ok: false, reason: 'rate-limited' }, 'rateLimited'],
    [{ ok: false, reason: 'network', detail: 'ENOTFOUND' }, 'network'],
    [{ ok: false, reason: 'unexpected', status: 503 }, 'network'],
  ])('refuses it, and saves nothing, when 42 answers %j', async (check, code) => {
    mocks.verifyCredentials.mockResolvedValue(check);
    const result = await actions.verifyFortyTwo({ clientId: UID, clientSecret: SECRET });
    expect(result).toMatchObject({ ok: false, code });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it('keeps the saved secret when the field is left empty, and checks THAT one with 42', async () => {
    await actions.verifyFortyTwo({ clientId: UID, clientSecret: '' });
    expect(mocks.verifyCredentials).toHaveBeenCalledWith(
      expect.any(Function),
      UID,
      's-s4t2ud-saved-secret',
    );
  });

  it('is refused before 42 is asked when it cannot be one, or is swapped', async () => {
    expect(await actions.verifyFortyTwo({ clientId: 'x', clientSecret: SECRET })).toMatchObject({
      ok: false,
      code: 'clientId',
    });
    expect(await actions.verifyFortyTwo({ clientId: SECRET, clientSecret: UID })).toMatchObject({
      ok: false,
      code: 'swapped',
    });
    mocks.saved = {};
    expect(await actions.verifyFortyTwo({ clientId: UID, clientSecret: '' })).toMatchObject({
      ok: false,
      code: 'clientSecret',
    });
    expect(mocks.verifyCredentials).not.toHaveBeenCalled();
  });

  it('can be saved without the check when 42 cannot be reached (the owner chose to)', async () => {
    expect(await actions.skipFortyTwoVerification({ clientId: UID, clientSecret: SECRET })).toEqual(
      { ok: true },
    );
    expect(mocks.verifyCredentials).not.toHaveBeenCalled();
    expect(mocks.updateSettings).toHaveBeenCalledTimes(1);
  });
});

describe('the campuses of 42', () => {
  it('are listed with the token of the saved application, and never give it away', async () => {
    const result = await actions.loadCampuses();
    expect(result).toEqual({
      ok: true,
      campuses: [{ name: 'Nice', country: 'France', timeZone: 'Europe/Paris' }],
    });
    expect(mocks.listCampuses).toHaveBeenCalledWith(
      expect.any(Function),
      'app-token',
      expect.any(Function),
    );
    expect(JSON.stringify(result)).not.toContain('app-token');
  });

  it('are typed by hand when the application cannot be asked', async () => {
    mocks.applicationToken.mockResolvedValue(null);
    expect(await actions.loadCampuses()).toEqual({ ok: true, campuses: null });
    expect(mocks.listCampuses).not.toHaveBeenCalled();
  });
});

describe('the owners', () => {
  it('checkOwner: tells whether 42 knows the login', async () => {
    expect(await actions.checkOwner({ login: ' Bob ' })).toEqual({
      ok: true,
      login: 'bob',
      status: 'exists',
    });
    mocks.checkLogin.mockResolvedValue('missing');
    expect(await actions.checkOwner({ login: 'nobody' })).toMatchObject({
      ok: false,
      code: 'loginMissing',
    });
    mocks.checkLogin.mockResolvedValue('unknown');
    expect(await actions.checkOwner({ login: 'bob' })).toMatchObject({
      ok: true,
      status: 'unknown',
    });
    mocks.applicationToken.mockResolvedValue(null);
    expect(await actions.checkOwner({ login: 'bob' })).toMatchObject({
      ok: true,
      status: 'unknown',
    });
    expect(await actions.checkOwner({ login: 'a b' })).toMatchObject({ ok: false, code: 'login' });
  });

  it('addOwner: asks 42 again, whatever the page says, and adds a login 42 confirms', async () => {
    expect(await actions.addOwner({ login: 'Bob' })).toEqual({ ok: true });
    expect(mocks.checkLogin).toHaveBeenCalledWith(
      expect.any(Function),
      'app-token',
      'bob',
      expect.any(Function),
    );
    expect(mocks.updateSettings).toHaveBeenCalledWith(
      { section: 'owner-add', login: 'bob' },
      { login: 'alice', id: 'u-alice' },
    );
  });

  it('addOwner: never adds a login that does not exist, even if the page says it does', async () => {
    mocks.checkLogin.mockResolvedValue('missing');
    expect(await actions.addOwner({ login: 'nobody', acceptUnverified: true })).toMatchObject({
      ok: false,
      code: 'loginMissing',
    });
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it('addOwner: a login 42 could not confirm needs the owner’s explicit yes', async () => {
    mocks.checkLogin.mockResolvedValue('unknown');
    expect(await actions.addOwner({ login: 'bob' })).toMatchObject({
      ok: false,
      code: 'loginUnverified',
    });
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    expect(await actions.addOwner({ login: 'bob', acceptUnverified: true })).toEqual({ ok: true });
  });

  it('addOwner: without any way to ask 42 it also needs the explicit yes', async () => {
    mocks.applicationToken.mockResolvedValue(null);
    expect(await actions.addOwner({ login: 'bob' })).toMatchObject({
      ok: false,
      code: 'loginUnverified',
    });
    expect(await actions.addOwner({ login: 'bob', acceptUnverified: true })).toEqual({ ok: true });
  });

  it('removeOwner: leaves the rules (not oneself, never nobody) to the update, and shows its refusal', async () => {
    mocks.updateSettings.mockResolvedValue({ ok: false, code: 'ownerSelf', field: 'login' });
    expect(await actions.removeOwner({ login: 'alice' })).toEqual({
      ok: false,
      code: 'ownerSelf',
      field: 'login',
    });
    expect(mocks.updateSettings).toHaveBeenCalledWith(
      { section: 'owner-remove', login: 'alice' },
      { login: 'alice', id: 'u-alice' },
    );
  });
});

describe('a test notification', () => {
  const webhook = 'https://discord.com/api/webhooks/123456789/secret-part';

  it('goes through what was typed, with the name of the BDE', async () => {
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
  });

  it('uses the saved webhook when the field is left empty (the page never has it)', async () => {
    mocks.saved = { DISCORD_WEBHOOK_URL: webhook };
    mocks.sendDiscordTest.mockResolvedValue({ ok: true });
    await actions.testNotification({ mode: 'discord', discordWebhook: '' }, { locale: 'fr' });
    expect(mocks.sendDiscordTest).toHaveBeenCalledWith(
      expect.any(Function),
      webhook,
      expect.any(String),
    );
  });

  it('says why it failed, without the webhook', async () => {
    mocks.sendDiscordTest.mockResolvedValue({ ok: false, detail: 'HTTP 404' });
    const result = await actions.testNotification(
      { mode: 'discord', discordWebhook: webhook },
      { locale: 'en' },
    );
    expect(result).toEqual({ ok: false, code: 'testFailed', detail: 'HTTP 404' });
    expect(JSON.stringify(result)).not.toContain('secret-part');
  });

  it('needs an address to write to for e-mail', async () => {
    const smtp = {
      host: 'smtp.exemple.fr',
      port: '587',
      user: '',
      password: '',
      from: 'bde@exemple.fr',
    };
    expect(
      await actions.testNotification({ mode: 'email', smtp }, { locale: 'fr', to: 'nope' }),
    ).toMatchObject({ ok: false, code: 'email', field: 'testTo' });
    mocks.sendTestMail.mockResolvedValue({ ok: true });
    expect(
      await actions.testNotification(
        { mode: 'email', smtp },
        { locale: 'fr', to: 'me@exemple.fr' },
      ),
    ).toEqual({ ok: true });
  });
});
