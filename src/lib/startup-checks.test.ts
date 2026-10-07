import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT_CONFIG as SUPERVISOR_EXIT_CONFIG } from '../../docker/startup-problems.mjs';
import { ConfigError } from '@/config';
import { EXIT_CONFIG, refuseToStart, runStartupChecks } from './startup-checks';

const getConfig = vi.hoisted(() => vi.fn());
vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  getConfig,
}));

const config = {
  bde: { name: 'BDE' },
  auth: { owners: ['someone'], allowedCampuses: [] },
  modules: { enabled: [] },
  notifications: {
    eventConfirmed: 'none',
    eventReminder: 'none',
    memberPending: 'none',
    memberApproved: 'none',
    memberRemoved: 'none',
  },
};

describe('startup checks', () => {
  let dir: string;
  const saved = { ...process.env };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bde-startup-'));
    process.env.BDE_STARTUP_REPORT = join(dir, 'report.json');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    getConfig.mockReturnValue(config);
  });

  afterEach(() => {
    process.env = { ...saved };
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  const report = () => JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));

  it('uses the exit code the container command waits for', () => {
    expect(EXIT_CONFIG).toBe(SUPERVISOR_EXIT_CONFIG);
  });

  it('starts when everything is fine', () => {
    Object.assign(process.env, {
      AUTH_SECRET: 'x'.repeat(40),
      FORTYTWO_CLIENT_ID: 'id',
      FORTYTWO_CLIENT_SECRET: 'secret',
      DATABASE_URL: 'postgresql://u:p@db:5432/x',
    });
    expect(() => runStartupChecks()).not.toThrow();
  });

  it('refuses a bad .env with the code 78 and names the variables, never their values', () => {
    Object.assign(process.env, {
      AUTH_SECRET: 'hunter2',
      FORTYTWO_CLIENT_ID: '',
      FORTYTWO_CLIENT_SECRET: 'the-42-secret',
      DATABASE_URL: 'postgresql://u:p@db:5432/x',
    });

    expect(() => runStartupChecks()).toThrow('exit 78');

    expect(report()).toEqual({
      kind: 'env',
      variables: ['AUTH_SECRET', 'FORTYTWO_CLIENT_ID'],
    });
    expect(JSON.stringify(report())).not.toMatch(/hunter2|the-42-secret/);
  });

  it('refuses an unusable bde.config.yml the same way', () => {
    getConfig.mockImplementation(() => {
      throw new ConfigError('Le fichier bde.config.yml est vide.');
    });
    expect(() => runStartupChecks()).toThrow('exit 78');
    expect(report()).toEqual({ kind: 'config', variables: [] });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('est vide'));
  });

  it('lets any other error through: a real crash is not a configuration problem', () => {
    getConfig.mockImplementation(() => {
      throw new TypeError('a bug');
    });
    expect(() => runStartupChecks()).toThrow('a bug');
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('still refuses to start when the report cannot be written', () => {
    process.env.BDE_STARTUP_REPORT = join(dir, 'no', 'such', 'folder', 'report.json');
    expect(() => refuseToStart('env', 'message')).toThrow('exit 78');
  });

  it('writes no report outside the container', () => {
    delete process.env.BDE_STARTUP_REPORT;
    expect(() => refuseToStart('env', 'message', ['AUTH_SECRET'])).toThrow('exit 78');
  });
});
