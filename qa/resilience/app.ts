import type { Report } from '../security/core';
import type { Platform } from '../access/http';
import { judgeBatch, writeWhileBroken } from './batch';
import { ask, isServed } from './context';
import { APP, docker, healthStatus, stateOf, waitForHealthy } from './docker';

/**
 * The application goes away: asked to stop (an update, a restart: it must leave at once and cleanly) and killed in the middle of
 * writes (an out-of-memory kill, a host that loses power). It starts again by itself where it left off.
 */

const AREA = 'app';

async function comesBack(platform: Platform, report: Report, label: string): Promise<boolean> {
  const started = docker('start', APP);
  report.check(AREA, `${label}: the container starts again`, started.ok, started.out);
  const healthy = await waitForHealthy(platform, 120);
  report.check(
    AREA,
    `${label}: the platform answers again within 120 s`,
    healthy !== null,
    healthy === null ? 'never healthy' : `healthy after ${Math.round(healthy)} ms`,
  );
  if (healthy === null) return false;
  for (const [who, path] of [
    ['member', '/fr/dashboard'],
    ['owner', '/fr/settings'],
  ] as const) {
    const answer = await ask(platform, path, { as: who });
    report.check(
      AREA,
      `${label}: ${who} is still signed in (${path})`,
      isServed(answer),
      `${answer.status}${answer.location ? ` → ${answer.location}` : ''}`,
    );
  }
  return true;
}

export async function checkApp(platform: Platform, report: Report): Promise<void> {
  const healthy = report.check(
    AREA,
    'the platform is healthy before the application is touched (the checks below mean something)',
    (await healthStatus(platform)) === 200,
  );
  if (!healthy) return;

  // 1. A stop request (SIGTERM): `docker stop` waits 10 s and then kills; a platform that ignores the request takes the 10 s
  //    and leaves with 137.
  const started = Date.now();
  const stopped = docker('stop', APP);
  const elapsed = Date.now() - started;
  const state = stateOf(APP);
  report.check(
    AREA,
    'asked to stop, the application leaves cleanly and at once',
    stopped.ok && state.exitCode === 0 && elapsed < 9_000,
    `exit code ${state.exitCode} after ${elapsed} ms`,
  );
  await comesBack(platform, report, 'stopped and started again');

  // 2. Killed in the middle of writes.
  const batch = await writeWhileBroken(platform, {
    count: 60,
    concurrency: 6,
    breakAfterMs: 600,
    breakIt: () => void docker('kill', '--signal', 'KILL', APP),
  });
  if (await comesBack(platform, report, 'killed and started again')) {
    await judgeBatch(platform, report, AREA, 'application killed during writes', batch);
  }
}
