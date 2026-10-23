import { beforeEach, describe, expect, it, vi } from 'vitest';
import { effectiveFor } from '@/test/session-fixtures';

vi.mock('@/lib/auth/session', () => ({ getEffectiveSession: vi.fn() }));

const { getEffectiveSession } = await import('@/lib/auth/session');
const { getTemplateEditor, requireTemplateEditor } = await import('./access');

const session = (permissions: string[], status: 'OWNER' | 'MEMBER' | 'PENDING' = 'MEMBER') => {
  const base = effectiveFor(status, 'paula', 'u1');
  return { ...base, user: { ...base.user, permissions } };
};

beforeEach(() => {
  vi.mocked(getEffectiveSession).mockReset();
});

describe('who may customise the notifications', () => {
  it('is whoever holds the permission', async () => {
    const holder = session(['notifications.templates']);
    vi.mocked(getEffectiveSession).mockResolvedValue(holder);
    expect(await getTemplateEditor()).toBe(holder);
    expect(await requireTemplateEditor()).toBe(holder);
  });

  it('is not somebody who holds other rights, however many', async () => {
    vi.mocked(getEffectiveSession).mockResolvedValue(
      session(['members.manage', 'roles.manage', 'events.validate']),
    );
    expect(await getTemplateEditor()).toBeNull();
    await expect(requireTemplateEditor()).rejects.toThrow('Forbidden');
  });

  it('is nobody who is signed out, and nobody whose account is waiting for approval', async () => {
    vi.mocked(getEffectiveSession).mockResolvedValue(null);
    expect(await getTemplateEditor()).toBeNull();
    await expect(requireTemplateEditor()).rejects.toThrow('Forbidden');

    vi.mocked(getEffectiveSession).mockResolvedValue(
      session(['notifications.templates'], 'PENDING'),
    );
    expect(await getTemplateEditor()).toBeNull();
  });
});
