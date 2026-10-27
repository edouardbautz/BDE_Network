// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { archiveName } from '@/lib/backups/names';

/**
 * The download of a backup: owners only (a bare 404 for anybody else), from the platform's own pages, the passphrase in the body, the
 * audit entry written before the first byte and without it no byte, nothing of the passphrase in the answer.
 */

const mocks = vi.hoisted(() => ({
  manager: vi.fn(),
  audit: vi.fn(),
  dir: '',
}));

vi.mock('@/lib/settings/access', () => ({ getSettingsManager: mocks.manager }));
vi.mock('@/lib/audit-log', () => ({ logAuditEvent: mocks.audit }));
vi.mock('@/lib/backups/service', () => ({ backupDir: () => mocks.dir }));

const { POST } = await import('./route');

const NAME = archiveName(new Date('2026-10-26T02:00:00Z'));
const PASS = 'a passphrase of the owner';
const OWNER = { user: { login: 'alice', id: 'u-alice' } };

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request('http://bde.example/api/backups/download', {
      method: 'POST',
      headers: { host: 'bde.example', 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  mocks.dir = mkdtempSync(join(tmpdir(), 'bde-route-'));
  writeFileSync(join(mocks.dir, NAME), 'the backup');
  mocks.manager.mockResolvedValue(OWNER);
  mocks.audit.mockResolvedValue(undefined);
});
afterEach(() => {
  rmSync(mocks.dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('who may download', () => {
  it('is a bare 404 for anybody who is not an owner, before the body is even read', async () => {
    mocks.manager.mockResolvedValue(null);
    const response = await post({ name: NAME, passphrase: PASS });
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('refuses a request that comes from another site', async () => {
    const response = await post(
      { name: NAME, passphrase: PASS },
      { origin: 'https://evil.example' },
    );
    expect(response.status).toBe(403);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('accepts the platform’s own origin, behind a proxy too', async () => {
    expect(
      (await post({ name: NAME, passphrase: PASS }, { origin: 'http://bde.example' })).status,
    ).toBe(200);
    const behind = await post(
      { name: NAME, passphrase: PASS },
      { origin: 'https://bde.fr', 'x-forwarded-host': 'bde.fr' },
    );
    expect(behind.status).toBe(200);
  });
});

describe('what it refuses to read', () => {
  it.each([
    ['not JSON', 'nope', 400, 'badRequest'],
    [
      'a body that is too large',
      JSON.stringify({ name: NAME, passphrase: PASS, junk: 'x'.repeat(5000) }),
      413,
      'tooLarge',
    ],
    ['a passphrase that is too short', { name: NAME, passphrase: 'short' }, 400, 'tooShort'],
    ['a passphrase that is too long', { name: NAME, passphrase: 'x'.repeat(201) }, 400, 'tooLong'],
    ['a name that is a path', { name: `../${NAME}`, passphrase: PASS }, 400, 'badName'],
    [
      'a backup that is gone',
      { name: archiveName(new Date('2026-01-01T02:00:00Z')), passphrase: PASS },
      404,
      'missing',
    ],
  ])('%s: a code, no file, nothing in the audit log', async (_what, body, status, error) => {
    const response = await post(body);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe('the file', () => {
  it('leaves as an attachment, encrypted, with nothing cached or sniffed', async () => {
    const response = await post({ name: NAME, passphrase: PASS });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename="${NAME}.enc"`);
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 8).toString('ascii')).toBe('Salted__');
    expect(bytes.includes('the backup')).toBe(false);
  });

  it('is written in the audit log first, with who, which backup, and never the passphrase', async () => {
    await post({ name: NAME, passphrase: PASS });
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    const entry = mocks.audit.mock.calls[0]?.[0];
    expect(entry).toMatchObject({
      actorLogin: 'alice',
      actorId: 'u-alice',
      action: 'backup.download',
      targetType: 'Backup',
      targetLabel: NAME,
    });
    expect(JSON.stringify(entry)).not.toContain(PASS);
  });

  it('does not leave if the audit entry cannot be written', async () => {
    mocks.audit.mockRejectedValue(new Error('database down'));
    await expect(post({ name: NAME, passphrase: PASS })).rejects.toThrow('database down');
  });
});
