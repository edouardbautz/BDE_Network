// @vitest-environment node
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
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

  it('tells the application where the folder is on the server, for the messages of the Settings page', () => {
    const environment = (doc.services.app as { environment?: Record<string, string> }).environment;
    expect(environment?.BDE_BACKUP_HOST_DIR).toBe('${BDE_BACKUP_DIR:-./backups/auto}');
  });

  /**
   * The step that prepares the folder, played for real (POSIX `sh`, a folder of the machine, the commands that a file system can refuse
   * replaced by stand-ins): a rootless Docker on a network disk answered "not permitted" to the change of owner, left the folder private to
   * the host user, and the application could not even list it ("the folder cannot be read").
   */
  describe.skipIf(process.platform === 'win32')('the preparation of the folder, played', () => {
    const script = String(doc.services.secrets?.command?.join('\n'));
    const start = script.indexOf('if { chown 1001:1001 /auto-backups');
    const part = script.slice(start, script.indexOf('\nfi\n', start) + 4);

    it('found the step it plays', () => {
      expect(start).toBeGreaterThan(0);
      expect(part).toContain('chmod 1777 /auto-backups');
      expect(part.trim().endsWith('fi')).toBe(true);
    });

    function prepare(refuse: { chown?: boolean; open?: boolean }): { mode: string; log: string } {
      const work = mkdtempSync(join(tmpdir(), 'bde-prepare-'));
      try {
        const folder = join(work, 'auto-backups');
        const bin = join(work, 'bin');
        mkdirSync(folder, { mode: 0o700 });
        mkdirSync(bin);
        chmodSync(folder, 0o700);
        const stand = (name: string, body: string) => {
          writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
          chmodSync(join(bin, name), 0o755);
        };
        stand('chown', refuse.chown ? 'exit 1' : 'exit 0');
        stand(
          'chmod',
          // the real chmod, except for the opening of the folder when the file system refuses it too
          `${refuse.open ? 'if [ "$1" = 1777 ]; then exit 1; fi' : ''}\nexec /bin/chmod "$@"`,
        );
        const run = spawnSync('sh', ['-eu', '-c', part.replaceAll('/auto-backups', folder)], {
          env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
          encoding: 'utf8',
        });
        expect(run.status, run.stderr).toBe(0);
        return {
          mode: (statSync(folder).mode & 0o7777).toString(8),
          log: run.stderr,
        };
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    }

    it('hands the folder over and lists it for everybody when it can', () => {
      expect(prepare({})).toEqual({ mode: '755', log: '' });
    });

    it('opens the folder, with the sticky bit, when the file system refuses the change of owner, and says so', () => {
      const result = prepare({ chown: true });
      expect(result.mode).toBe('1777');
      expect(result.log).toContain('it is open to every user of the server instead');
    });

    it('does not stop the platform from starting when nothing works, and says the backups will fail', () => {
      const result = prepare({ chown: true, open: true });
      expect(result.mode).toBe('700');
      expect(result.log).toContain('nor opened for it: the automatic backups will fail');
    });
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
