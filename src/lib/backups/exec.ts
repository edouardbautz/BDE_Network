import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

/**
 * Runs a program of the image (`pg_dump`, `psql`, `tar`) without a shell: the arguments reach it as they are, and what a path or a
 * password holds can never be taken for a line of shell. Its output goes to a file when asked (a dump is not held in memory); its
 * errors are kept, cut, to say what went wrong.
 */
export interface ExecOptions {
  /** Variables of the program, added to the environment (a password goes here, never on the command line). */
  env?: Record<string, string>;
  cwd?: string;
  /** Where the standard output goes, instead of being kept. */
  stdoutFile?: string;
  /** What the standard input reads. */
  stdinFile?: string;
  timeoutMs?: number;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Exec = (
  command: string,
  args: readonly string[],
  options?: ExecOptions,
) => Promise<ExecResult>;

const KEPT = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 15 * 60_000;

export const realExec: Exec = async (command, args, options = {}) => {
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: [options.stdinFile ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stdout = '';
  let stderr = '';
  const keep = (current: string, chunk: Buffer) =>
    current.length >= KEPT
      ? current
      : current + chunk.toString('utf8').slice(0, KEPT - current.length);
  // stdout and stderr are always pipes (see stdio above)
  const out = child.stdout!;
  child.stderr!.on('data', (chunk: Buffer) => (stderr = keep(stderr, chunk)));

  const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const closed = new Promise<number>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });

  try {
    const pipes: Promise<void>[] = [];
    if (options.stdoutFile)
      pipes.push(pipeline(out, createWriteStream(options.stdoutFile, { mode: 0o600 })));
    else out.on('data', (chunk: Buffer) => (stdout = keep(stdout, chunk)));
    if (options.stdinFile && child.stdin)
      pipes.push(pipeline(createReadStream(options.stdinFile), child.stdin));
    const [code] = await Promise.all([closed, ...pipes]);
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
};
