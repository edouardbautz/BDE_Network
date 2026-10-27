// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { realExec } from './exec';

/** The only door through which the application starts a program. The Semgrep rule `bde-no-child-process` names this file and no other. */
describe('exec.ts, the one place the application starts a program', () => {
  it('starts nothing through a shell: an argument reaches the program as it is', async () => {
    const hostile = `a; echo hacked && $(echo hacked) \`echo hacked\` "quoted" 'single'`;
    const result = await realExec(process.execPath, [
      '-e',
      'process.stdout.write(process.argv[1])',
      hostile,
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(hostile);
  });

  it('gives a variable to the program and not to a command line', async () => {
    const result = await realExec(
      process.execPath,
      ['-e', 'process.stdout.write(process.env.PGPASSWORD ?? "")'],
      {
        env: { PGPASSWORD: 'p@ss word' },
      },
    );
    expect(result.stdout).toBe('p@ss word');
  });

  it('answers the exit code and keeps what the program wrote on its error output, cut', async () => {
    const result = await realExec(process.execPath, [
      '-e',
      'process.stderr.write("x".repeat(200000)); process.exit(3)',
    ]);
    expect(result.code).toBe(3);
    expect(result.stderr.length).toBeLessThanOrEqual(64 * 1024);
  });

  it('gives up on a program that does not end', async () => {
    const started = Date.now();
    const result = await realExec(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
      timeoutMs: 300,
    });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.code).not.toBe(0);
  });

  it('is the only file of src/ that imports child_process', () => {
    const importer = /from ['"](node:)?child_process['"]|require\(['"](node:)?child_process['"]\)/;
    const files = readdirSync(join(process.cwd(), 'src'), { recursive: true, withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name),
      )
      .map((entry) => join(entry.parentPath, entry.name));
    const importers = files
      .filter((path) => importer.test(readFileSync(path, 'utf8')))
      .map((path) => relative(process.cwd(), path).split(sep).join('/'));
    expect(files.length).toBeGreaterThan(100);
    expect(importers).toEqual(['src/lib/backups/exec.ts']);
  });
});
