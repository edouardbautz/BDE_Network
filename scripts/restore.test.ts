// @vitest-environment node
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * `scripts/restore.sh` against a `docker` that is only a recorder: what the script asks Docker to do, in what order. The
 * script is for a server (POSIX shell, Docker), so the test needs a POSIX shell and is not run where there is none.
 *
 * The case it holds: going back to an earlier version. The folder is still at the version being left, and its application,
 * started on the database that was just put back, applies its migrations again at once; the earlier version then refuses a
 * database that is "newer". Found by the update suite of the quality campaign (`qa/upgrade`), which rolled back for real.
 */

/** A path as the POSIX shell of the machine reads it (Git Bash on Windows wants /c/Users/…). */
const posix = (path: string) =>
  process.platform === 'win32'
    ? path
        .replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`)
        .split('\\')
        .join('/')
    : path;

const hasShell =
  spawnSync('sh', ['-c', 'true']).status === 0 && spawnSync('tar', ['--version']).status === 0;

const DOCKER_STUB = `#!/bin/sh
echo "docker $*" >> "$STUB_LOG"
case "$*" in
  *"ps --status running"*) echo postgres ;;
  *pg_dump*) echo "-- PostgreSQL database dump complete" ;;
  *"--entrypoint ls app"*) echo "pre-update_20261015T101530Z_v1.1.0.sql.gz" ;;
  *"--entrypoint cat app"*) gzip -c "$STUB_DIR/database.sql" ;;
  *"--entrypoint tar app -cf"*) cat "$STUB_DIR/secrets.tar" ;;
  *"--entrypoint tar app -xf"*) cat > /dev/null ;;
  *psql*) cat > /dev/null ;;
  *"--entrypoint sh app -c"*) exit 1 ;;
esac
exit 0
`;

describe.skipIf(!hasShell || process.platform === 'win32')(
  'restore.sh (a script for a Linux server: not run on Windows)',
  () => {
    let work: string;
    let log: string;

    const docker = () => readFileSync(log, 'utf8').split('\n').filter(Boolean);
    const restore = (...args: string[]) =>
      spawnSync('sh', ['scripts/restore.sh', ...args], {
        cwd: work,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${posix(join(work, 'bin'))}:${process.env.PATH}`,
          STUB_LOG: posix(log),
          STUB_DIR: posix(work),
        },
      });

    beforeEach(() => {
      work = mkdtempSync(join(tmpdir(), 'bde-restore-'));
      log = join(work, 'docker.log');
      writeFileSync(log, '');
      mkdirSync(join(work, 'scripts'));
      mkdirSync(join(work, 'bin'));
      mkdirSync(join(work, 'keys'));
      for (const name of ['restore.sh', 'backup.sh'])
        copyFileSync(join(process.cwd(), 'scripts', name), join(work, 'scripts', name));
      writeFileSync(join(work, 'bin', 'docker'), DOCKER_STUB);
      chmodSync(join(work, 'bin', 'docker'), 0o755);
      // what the stub hands back: a complete dump, and an archive of the keys that holds the one file the script looks for
      writeFileSync(
        join(work, 'database.sql'),
        'SELECT 1;\n-- PostgreSQL database dump complete\n',
      );
      writeFileSync(join(work, 'keys', 'settings_key'), 'x');
      writeFileSync(join(work, 'keys', 'auth_secret'), 'y');
      spawnSync('tar', [
        '-cf',
        join(work, 'secrets.tar'),
        '-C',
        join(work, 'keys'),
        'auth_secret',
        'settings_key',
      ]);
      // a backup made by backup.sh: the dump and a note
      writeFileSync(join(work, 'info.txt'), 'test');
      spawnSync('tar', [
        '-czf',
        join(work, 'backup.tar.gz'),
        '-C',
        work,
        'database.sql',
        'info.txt',
      ]);
    });

    afterEach(() => rmSync(work, { recursive: true, force: true }));

    /** The commands that start the application, after the database was replaced. */
    const startsOfTheApp = () => {
      const lines = docker();
      const replaced = lines.findIndex((line) => line.includes('psql'));
      return lines.slice(replaced + 1).filter((line) => /compose up .*\bapp\b/.test(line));
    };

    it('puts the database back and starts the application again, by default', () => {
      const result = restore('backup.tar.gz', '--yes');
      expect(result.status, result.stderr).toBe(0);
      expect(docker().some((line) => line.includes('psql'))).toBe(true);
      expect(startsOfTheApp()).toHaveLength(1);
    });

    it('leaves the application stopped with --no-start, and says what to do next', () => {
      const result = restore('backup.tar.gz', '--no-start', '--yes');
      expect(result.status, result.stderr).toBe(0);
      expect(docker().some((line) => line.includes('psql'))).toBe(true);
      expect(startsOfTheApp()).toEqual([]);
      expect(result.stdout).toMatch(/laissée arrêtée/);
      expect(result.stdout).toMatch(/git checkout/);
    });

    it('leaves the application stopped for a copy made before an update, which only serves to go back', () => {
      const result = restore('--pre-update', '--yes');
      expect(result.status, result.stderr).toBe(0);
      expect(docker().some((line) => line.includes('psql'))).toBe(true);
      expect(startsOfTheApp()).toEqual([]);
    });

    it('still starts the application again when the restore fails (the database is as it was)', () => {
      writeFileSync(
        join(work, 'bin', 'docker'),
        DOCKER_STUB.replace('*psql*) cat > /dev/null ;;', '*psql*) cat > /dev/null; exit 1 ;;'),
      );
      const result = restore('backup.tar.gz', '--no-start', '--yes');
      expect(result.status).not.toBe(0);
      expect(docker().filter((line) => /compose up .*\bapp\b/.test(line))).toHaveLength(1);
    });
  },
);
