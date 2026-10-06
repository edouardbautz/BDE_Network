import { beforeEach, describe, expect, it, vi } from 'vitest';
import { effectiveFor, type AccountKind } from '@/test/session-fixtures';

const { RedirectSignal } = vi.hoisted(() => ({
  RedirectSignal: class RedirectSignal extends Error {
    constructor(public href: string) {
      super(`REDIRECT:${href}`);
    }
  },
}));

vi.mock('./session', () => ({ getEffectiveSession: vi.fn() }));
vi.mock('next-intl/server', () => ({ getLocale: vi.fn(async () => 'fr') }));
vi.mock('@/i18n/navigation', () => ({
  redirect: vi.fn((options: { href: string }) => {
    throw new RedirectSignal(options.href);
  }),
}));

const { getEffectiveSession } = await import('./session');
const { requireApprovedSession } = await import('./require-session');

beforeEach(() => vi.clearAllMocks());

describe('requireApprovedSession', () => {
  it('sends a visitor without a session to the login page', async () => {
    vi.mocked(getEffectiveSession).mockResolvedValue(null);
    await expect(requireApprovedSession()).rejects.toThrow(new RedirectSignal('/'));
  });

  it('sends an account that is still waiting to the waiting page', async () => {
    vi.mocked(getEffectiveSession).mockResolvedValue(effectiveFor('PENDING'));
    await expect(requireApprovedSession()).rejects.toThrow(new RedirectSignal('/pending'));
  });

  it.each<AccountKind>(['OWNER', 'ADMIN', 'MEMBER'])(
    'returns the session of an approved %s',
    async (kind) => {
      const session = effectiveFor(kind);
      vi.mocked(getEffectiveSession).mockResolvedValue(session);
      await expect(requireApprovedSession()).resolves.toBe(session);
    },
  );
});
