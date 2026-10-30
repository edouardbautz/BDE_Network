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
  *"--entrypoint ls app -1 /auto-backups/pre-update /legacy-backups"*) echo "pre-update_20261015T101530Z_v1.1.0.sql.gz" ;;
  *"--entrypoint sh app -c"*"/auto-backups/pre-update/"*) gzip -c "$STUB_DIR/database.sql" ;;
  *"--entrypoint ls app -1 /auto-backups"*) printf 'bde-auto-2026-10-25_02-00-00Z.tar.gz\nbde-auto-2026-10-26_02-00-00Z.tar.gz\n' ;;
  *"--entrypoint cat app /auto-backups/"*) cat "$STUB_DIR/auto.tar.gz" ;;
  *openssl*) cat > /dev/null; if [ -f "$STUB_DIR/wrong-passphrase" ]; then exit 1; fi; cat "$STUB_DIR/auto.tar.gz" ;;
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

    beforeEach(() => {
      // an automatic backup: the dump, the keys, the logo's absence is fine, and the manifest the platform wrote
      writeFileSync(join(work, 'manifest.json'), '{}');
      spawnSync('tar', [
        '-czf',
        join(work, 'auto.tar.gz'),
        '-C',
        work,
        'database.sql',
        'secrets.tar',
        'info.txt',
        'manifest.json',
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

    it('looks for the copies before an update in the folder of the backups, and in the old volume that has not been carried over yet', () => {
      restore('--pre-update', '--yes');
      const lines = docker();
      expect(
        lines.some((line) => line.includes('ls app -1 /auto-backups/pre-update /legacy-backups')),
      ).toBe(true);
      const read = lines.find((line) => line.includes('--entrypoint sh app -c'));
      expect(read).toContain('/auto-backups/pre-update/$1');
      expect(read).toContain('/legacy-backups/$1');
      expect(read).toContain('pre-update_20261015T101530Z_v1.1.0.sql.gz');
    });

    describe('the backups the platform makes by itself', () => {
      it("--auto restores the newest one, read through the application's own container, keys included", () => {
        const result = restore('--auto', '--yes');
        expect(result.status, result.stderr).toBe(0);
        const lines = docker();
        expect(
          lines.some((line) =>
            line.includes('cat app /auto-backups/bde-auto-2026-10-26_02-00-00Z.tar.gz'),
          ),
        ).toBe(true);
        expect(lines.some((line) => line.includes('psql'))).toBe(true);
        // the keys come out of the archive itself: no second file to give
        expect(lines.some((line) => line.includes('tar app -xf - -C /secrets'))).toBe(true);
        expect(result.stdout).toMatch(/clés de la sauvegarde/);
        expect(result.stdout).not.toMatch(/Rappel/);
      });

      it('--auto restores the one that is named, and refuses a name that is not in the folder', () => {
        const named = restore('--auto', 'bde-auto-2026-10-25_02-00-00Z.tar.gz', '--yes');
        expect(named.status, named.stderr).toBe(0);
        expect(
          docker().some((line) =>
            line.includes('/auto-backups/bde-auto-2026-10-25_02-00-00Z.tar.gz'),
          ),
        ).toBe(true);

        writeFileSync(log, '');
        const unknown = restore('--auto', 'bde-auto-2020-01-01_00-00-00Z.tar.gz', '--yes');
        expect(unknown.status).not.toBe(0);
        expect(unknown.stderr).toMatch(/introuvable/);
        expect(docker().some((line) => line.includes('psql'))).toBe(false);
      });

      it('--auto does not mix with a file or with --pre-update', () => {
        expect(restore('--auto', 'backup.tar.gz', '--yes').status).toBe(2);
        expect(restore('--auto', '--pre-update', '--yes').status).toBe(2);
      });

      it('restores the keys of a backup that holds them, and says nothing about a missing key archive', () => {
        const result = restore('auto.tar.gz', '--yes');
        expect(result.status, result.stderr).toBe(0);
        expect(docker().some((line) => line.includes('tar app -xf - -C /secrets'))).toBe(true);
        expect(result.stdout).not.toMatch(/Rappel/);
      });

      it('lets an archive of keys given by hand replace the one inside', () => {
        const result = restore('auto.tar.gz', '--secrets', 'secrets.tar', '--yes');
        // secrets.tar is not a gzip: the check of the keys archive refuses it before anything is touched
        expect(result.status).not.toBe(0);
        expect(docker().some((line) => line.includes('psql'))).toBe(false);
      });

      it("decrypts a downloaded file in the application's image, the passphrase in the environment and never on a command line", () => {
        copyFileSync(
          join(work, 'auto.tar.gz'),
          join(work, 'bde-auto-2026-10-26_02-00-00Z.tar.gz.enc'),
        );
        const result = spawnSync(
          'sh',
          ['scripts/restore.sh', 'bde-auto-2026-10-26_02-00-00Z.tar.gz.enc', '--yes'],
          {
            cwd: work,
            encoding: 'utf8',
            env: {
              ...process.env,
              PATH: `${posix(join(work, 'bin'))}:${process.env.PATH}`,
              STUB_LOG: posix(log),
              STUB_DIR: posix(work),
              BDE_BACKUP_PASSPHRASE: 'correct horse battery staple',
            },
          },
        );
        expect(result.status, result.stderr).toBe(0);
        const lines = docker();
        const decrypt = lines.find((line) => line.includes('openssl enc -d'))!;
        expect(decrypt).toContain(
          '-aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -pass env:BDE_BACKUP_PASSPHRASE',
        );
        expect(lines.join('\n')).not.toContain('correct horse');
        expect(lines.some((line) => line.includes('psql'))).toBe(true);
      });

      it('stops before touching anything when the passphrase is wrong', () => {
        copyFileSync(join(work, 'auto.tar.gz'), join(work, 'download.tar.gz.enc'));
        writeFileSync(join(work, 'wrong-passphrase'), '');
        const result = spawnSync('sh', ['scripts/restore.sh', 'download.tar.gz.enc', '--yes'], {
          cwd: work,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${posix(join(work, 'bin'))}:${process.env.PATH}`,
            STUB_LOG: posix(log),
            STUB_DIR: posix(work),
            BDE_BACKUP_PASSPHRASE: 'not the one',
          },
        });
        expect(result.status).not.toBe(0);
        expect(result.stderr).toMatch(/phrase de passe incorrecte/);
        const lines = docker();
        expect(lines.some((line) => line.includes('psql'))).toBe(false);
        expect(lines.some((line) => line.includes('backup.sh') || line.includes('pg_dump'))).toBe(
          false,
        );
      });

      it('asks for the passphrase, and does nothing, when there is no terminal to ask on', () => {
        copyFileSync(join(work, 'auto.tar.gz'), join(work, 'download.tar.gz.enc'));
        const result = restore('download.tar.gz.enc', '--yes');
        expect(result.status).not.toBe(0);
        expect(result.stderr).toMatch(/BDE_BACKUP_PASSPHRASE/);
        expect(docker().some((line) => line.includes('psql'))).toBe(false);
      });
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
