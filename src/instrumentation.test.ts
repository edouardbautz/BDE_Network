// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** What the server does when it starts: load the settings, then either check them and run, or open the installer. */

const mocks = vi.hoisted(() => {
  class PlatformSettingsError extends Error {}
  return {
    PlatformSettingsError,
    initializePlatform: vi.fn(),
    runStartupChecks: vi.fn(),
    refuseToStart: vi.fn((): never => {
      throw new Error('refused');
    }),
    enterSetupMode: vi.fn(),
    warnFortyTwo: vi.fn(),
    startScheduler: vi.fn(),
  };
});

vi.mock('./lib/settings/store', () => ({
  initializePlatform: mocks.initializePlatform,
  PlatformSettingsError: mocks.PlatformSettingsError,
}));
vi.mock('./lib/startup-checks', () => ({
  runStartupChecks: mocks.runStartupChecks,
  refuseToStart: mocks.refuseToStart,
}));
vi.mock('./lib/setup/mode', () => ({ enterSetupMode: mocks.enterSetupMode }));
vi.mock('./lib/auth/oauth-check', () => ({
  warnIfFortyTwoRejectsTheApplication: mocks.warnFortyTwo,
}));
vi.mock('./lib/events/scheduler', () => ({ startEventReminderScheduler: mocks.startScheduler }));

const { register } = await import('./instrumentation');

describe('register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('NEXT_PHASE', 'phase-production-server');
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([{ source: 'database' }, { source: 'import' }, { source: 'files' }])(
    'checks the settings and starts what runs in the background (%j)',
    async (result) => {
      mocks.initializePlatform.mockResolvedValue(result);
      await register();
      expect(mocks.runStartupChecks).toHaveBeenCalledTimes(1);
      expect(mocks.warnFortyTwo).toHaveBeenCalledTimes(1);
      expect(mocks.startScheduler).toHaveBeenCalledTimes(1);
      expect(mocks.enterSetupMode).not.toHaveBeenCalled();
    },
  );

  it('opens the installer when nothing is decided, and runs nothing else', async () => {
    mocks.initializePlatform.mockResolvedValue({ source: 'setup' });
    await register();
    expect(mocks.enterSetupMode).toHaveBeenCalledTimes(1);
    expect(mocks.runStartupChecks).not.toHaveBeenCalled(); // the .env of a platform not installed is empty
    expect(mocks.warnFortyTwo).not.toHaveBeenCalled();
    expect(mocks.startScheduler).not.toHaveBeenCalled();
  });

  it('refuses to start, with the explanation, when the stored settings cannot be used', async () => {
    mocks.initializePlatform.mockRejectedValue(new mocks.PlatformSettingsError('invalid'));
    await expect(register()).rejects.toThrow('refused');
    expect(mocks.refuseToStart).toHaveBeenCalledWith('config', 'invalid');
    expect(mocks.runStartupChecks).not.toHaveBeenCalled();
  });

  it('lets any other error through: a database that fails here is a crash, not a setting', async () => {
    mocks.initializePlatform.mockRejectedValue(new TypeError('boom'));
    await expect(register()).rejects.toThrow('boom');
    expect(mocks.refuseToStart).not.toHaveBeenCalled();
  });

  it('does nothing on the Edge runtime, nor while the image is being built', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    await register();
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    await register();
    expect(mocks.initializePlatform).not.toHaveBeenCalled();
  });
});
