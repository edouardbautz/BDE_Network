import { spawnSync } from 'node:child_process';
import type { Platform } from '../access/http';

/**
 * What the resilience suites do to the platform's containers: stop, kill, pause and start them, and wait for the platform to
 * come back. Docker is started without a shell (arguments, not a command line), and every wait has a deadline: a suite that
 * waits for ever hides the very failure it is looking for.
 */

export const APP = process.env.QA_APP_CONTAINER ?? 'qa-app';
export const DATABASE = process.env.QA_DATABASE_CONTAINER ?? 'qa-postgres';

export function docker(...args: string[]): { ok: boolean; out: string } {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
    maxBuffer: 64 * 1024 * 1024,
  });
  return { ok: result.status === 0, out: `${result.stdout}${result.stderr}`.trim() };
}

export interface ContainerState {
  running: boolean;
  paused: boolean;
  exitCode: number;
  restarts: number;
  oomKilled: boolean;
}

export function stateOf(container: string): ContainerState {
  const { ok, out } = docker('inspect', '--format', '{{json .State}}', container);
  if (!ok) throw new Error(`cannot inspect ${container}: ${out}`);
  const state = JSON.parse(out) as {
    Running: boolean;
    Paused: boolean;
    ExitCode: number;
    OOMKilled: boolean;
  };
  const restarts = docker('inspect', '--format', '{{.RestartCount}}', container);
  return {
    running: state.Running,
    paused: state.Paused,
    exitCode: state.ExitCode,
    oomKilled: state.OOMKilled,
    restarts: Number(restarts.out) || 0,
  };
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `check` until it answers true or the deadline passes; returns how long it took, or null when it never did. */
export async function waitUntil(
  check: () => Promise<boolean>,
  { seconds, everyMs = 1000 }: { seconds: number; everyMs?: number },
): Promise<number | null> {
  const started = Date.now();
  while (Date.now() - started < seconds * 1000) {
    try {
      if (await check()) return Date.now() - started;
    } catch {
      // not yet
    }
    await sleep(everyMs);
  }
  return null;
}

/** The status of `/api/health`, or 0 when nothing answered within `timeoutMs`. */
export async function healthStatus(platform: Platform, timeoutMs = 10_000): Promise<number> {
  try {
    const response = await fetch(`${platform.base}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    await response.text();
    return response.status;
  } catch {
    return 0;
  }
}

/** Waits for the platform to answer 200 on `/api/health` (it takes the database and the application). */
export const waitForHealthy = (platform: Platform, seconds: number) =>
  waitUntil(async () => (await healthStatus(platform)) === 200, { seconds });

/** Waits until PostgreSQL accepts connections again (after a start, it replays its log first). */
export const waitForDatabase = (seconds: number) =>
  waitUntil(
    async () => docker('exec', DATABASE, 'pg_isready', '-U', 'bde', '-d', 'bde_network').ok,
    {
      seconds,
    },
  );
