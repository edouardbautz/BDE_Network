// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ check: true, latest: vi.fn() }));

vi.mock('@/config', () => ({ getConfig: () => ({ updates: { check: mocks.check } }) }));
vi.mock('./latest-release', () => ({ latestRelease: mocks.latest }));

const { updateStatus } = await import('./status');

const release = {
  version: '1.2.0',
  url: 'https://github.com/edouardbautz/BDE_Network/releases/tag/v1.2.0',
  summary: 'What is new.',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.check = true;
  process.env.BDE_VERSION = '1.1.0';
  mocks.latest.mockResolvedValue(release);
});
afterEach(() => {
  delete process.env.BDE_VERSION;
});

describe('updateStatus', () => {
  it('says a newer version is available, with what to show', async () => {
    expect(await updateStatus()).toEqual({
      state: 'available',
      current: '1.1.0',
      latest: '1.2.0',
      url: release.url,
      summary: 'What is new.',
    });
    expect(mocks.latest).toHaveBeenCalledWith('1.1.0');
  });

  it('says nothing is new when the platform runs the latest, or something newer', async () => {
    process.env.BDE_VERSION = '1.2.0';
    expect(await updateStatus()).toEqual({ state: 'current' });
    process.env.BDE_VERSION = '1.3.0';
    expect(await updateStatus()).toEqual({ state: 'current' });
  });

  it('asks nobody when the owner turned the check off', async () => {
    mocks.check = false;
    expect(await updateStatus()).toEqual({ state: 'disabled' });
    expect(mocks.latest).not.toHaveBeenCalled();
  });

  it('does not ask either when the platform does not know its own version', async () => {
    delete process.env.BDE_VERSION;
    expect(await updateStatus()).toEqual({ state: 'unknown' });
    expect(mocks.latest).not.toHaveBeenCalled();
  });

  it('says it does not know when GitHub could not be asked', async () => {
    mocks.latest.mockResolvedValue(null);
    expect(await updateStatus()).toEqual({ state: 'unknown' });
  });
});
