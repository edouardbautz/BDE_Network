// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

/**
 * A platform that nobody watches must not fill its disk with logs nor take its server down with one runaway process: every service
 * that keeps running has a ceiling for its memory and a log that Docker cuts. The one that makes a file and stops (`secrets`) has
 * neither to need.
 */
interface Service {
  restart?: string;
  mem_limit?: string;
  logging?: { driver?: string; options?: Record<string, string> };
}

const compose = load(readFileSync(join(process.cwd(), 'docker-compose.yml'), 'utf8')) as {
  services: Record<string, Service>;
};
const running = Object.entries(compose.services).filter(([, service]) => service.restart !== 'no');

describe('docker-compose.yml, for a platform that nobody watches', () => {
  it('has services that keep running (the check is not blind)', () => {
    expect(running.map(([name]) => name).sort()).toEqual(['app', 'postgres']);
  });

  it.each(running)('%s: Docker cuts the log (3 files of 10 MB at most)', (_name, service) => {
    expect(service.logging?.driver).toBe('json-file');
    expect(service.logging?.options).toMatchObject({ 'max-size': '10m', 'max-file': '3' });
  });

  it.each(running)(
    '%s: has a ceiling for its memory, that the server can change',
    (_name, service) => {
      expect(service.mem_limit).toMatch(/^\$\{[A-Z_]+:-\d+m\}$/);
    },
  );
});

/**
 * The nightly backups must outlive the platform's volumes: they are a folder of the host, mounted by the application (which writes
 * them) and by the one-shot `secrets` service (which, as root, hands the folder to the application's user: a folder made by Docker
 * on the host belongs to root, and a rootless Docker has no other way to make it writable).
 */
describe('docker-compose.yml, for the backups', () => {
  const text = readFileSync(join(process.cwd(), 'docker-compose.yml'), 'utf8');
  const doc = load(text) as {
    services: Record<string, { volumes?: string[]; command?: string[] }>;
    volumes: Record<string, unknown>;
  };
  const mount = '${BDE_BACKUP_DIR:-./backups/auto}:/auto-backups';

  it('mounts a folder of the host, not a volume, on /auto-backups', () => {
    expect(doc.services.app?.volumes).toContain(mount);
    expect(doc.services.secrets?.volumes).toContain(mount);
    expect(Object.keys(doc.volumes)).not.toContain('auto-backups');
  });

  it("gives the folder to the application's user before the application starts", () => {
    const script = String(doc.services.secrets?.command?.join('\n'));
    expect(script).toContain('chown 1001:1001 /auto-backups');
    expect(script).toContain('chmod 755 /auto-backups');
  });

  it('does not stop the platform from starting when a file system refuses to hand the folder over (a share, a Windows mount)', () => {
    // the script runs with `set -eu`: a refused chown must be answered, not fatal
    const script = String(doc.services.secrets?.command?.join('\n'));
    expect(script).toMatch(
      /\{ chown 1001:1001 \/auto-backups && chmod 755 \/auto-backups; \} 2>\/dev\/null \|\|\s+echo "[^"]*automatic backups will fail/,
    );
  });

  it('passes the number of the stack that the image checks (the two change together)', () => {
    const stack = /BDE_STACK: '(\d+)'/.exec(text)?.[1];
    const image = /STACK_VERSION = (\d+);/.exec(
      readFileSync(join(process.cwd(), 'docker', 'safe-update.mjs'), 'utf8'),
    )?.[1];
    expect(stack).toBe(image);
  });

  it("does not set the folder the application sees: the image decides (BDE_BACKUP_DIR is the host's path here)", () => {
    expect(text).not.toMatch(/^\s+BDE_BACKUP_DIR:/m);
    expect(readFileSync(join(process.cwd(), 'Dockerfile'), 'utf8')).toContain(
      'BDE_BACKUP_DIR=/auto-backups',
    );
  });
});
