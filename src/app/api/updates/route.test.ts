// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ manager: vi.fn(), status: vi.fn() }));

vi.mock('@/lib/settings/access', () => ({ getSettingsManager: mocks.manager }));
vi.mock('@/lib/updates/status', () => ({ updateStatus: mocks.status }));

const { GET } = await import('./route');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.status.mockResolvedValue({ state: 'current' });
});

describe('GET /api/updates', () => {
  it('answers a bare 404 to anybody who is not an owner, and asks nobody', async () => {
    mocks.manager.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it('tells an owner, without letting a cache keep it', async () => {
    mocks.manager.mockResolvedValue({ user: { login: 'alice' } });
    mocks.status.mockResolvedValue({
      state: 'available',
      current: '1.1.0',
      latest: '1.2.0',
      url: 'https://github.com/edouardbautz/BDE_Network/releases/tag/v1.2.0',
      summary: 'What is new.',
    });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ state: 'available', latest: '1.2.0' });
  });
});
