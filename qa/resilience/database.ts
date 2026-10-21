import type { Report } from '../security/core';
import type { Platform } from '../access/http';
import { judgeBatch, writeWhileBroken } from './batch';
import { ask, isServed, judgeOutage } from './context';
import {
  APP,
  DATABASE,
  docker,
  healthStatus,
  sleep,
  stateOf,
  waitForDatabase,
  waitForHealthy,
} from './docker';

/**
 * The database goes away, in three ways, while the platform is up: stopped (an operator restarts it), frozen (a host that
 * stalls: connections stay open and nothing answers), and killed in the middle of writes (a crash). The platform may not serve
 * what it cannot, but it must say so, in a bounded time, and it must come back by itself and not forget who is signed in.
 */

const AREA = 'database';

/** What a signed-in person, a visitor and the health check see while the database is not there. */
async function duringOutage(platform: Platform, report: Report, label: string): Promise<void> {
  const health = await ask(platform, '/api/health', { timeoutMs: 15_000 });
  report.check(
    AREA,
    `${label}: /api/health says 503, quickly`,
    health.status === 503 && health.ms < 8_000,
    health.timedOut ? 'no answer' : `${health.status} in ${Math.round(health.ms)} ms`,
  );

  for (const [who, path] of [
    ['member', '/fr/dashboard'],
    ['owner', '/fr/events'],
    [undefined, '/fr'],
  ] as const) {
    const answer = await ask(platform, path, { as: who, timeoutMs: 40_000 });
    const verdict = judgeOutage(answer);
    report.check(
      AREA,
      `${label}: ${who ?? 'a visitor'} asking for ${path} is told the service is unavailable, in less than 30 s`,
      verdict.ok && answer.ms < 30_000,
      `${verdict.why} (${Math.round(answer.ms)} ms)`,
    );
  }

  const feed = await ask(platform, `/api/calendar/${'0'.repeat(64)}`, { timeoutMs: 30_000 });
  report.check(
    AREA,
    `${label}: a calendar link gets a bare 404 or 503, not an error page`,
    !feed.timedOut &&
      (feed.status === 404 || feed.status === 503) &&
      !/ECONNREFUSED|postgres/.test(feed.body),
    feed.timedOut ? 'no answer' : `${feed.status}`,
  );

  const state = stateOf(APP);
  report.check(
    AREA,
    `${label}: the application did not crash`,
    state.running && state.restarts === 0 && !state.oomKilled,
    `running=${state.running} restarts=${state.restarts} oomKilled=${state.oomKilled}`,
  );
}

/** After the database is back: the platform serves again by itself, and the cookies of before still sign people in. */
async function afterRecovery(platform: Platform, report: Report, label: string): Promise<void> {
  const recovered = await waitForHealthy(platform, 60);
  report.check(
    AREA,
    `${label}: the platform serves again by itself, within 60 s of the database`,
    recovered !== null,
    recovered === null ? 'still unhealthy after 60 s' : `healthy after ${Math.round(recovered)} ms`,
  );
  if (recovered === null) return;
  for (const [who, path] of [
    ['member', '/fr/dashboard'],
    ['owner', '/fr/settings'],
    ['validator', '/fr/events'],
  ] as const) {
    const answer = await ask(platform, path, { as: who });
    report.check(
      AREA,
      `${label}: ${who} is still signed in (${path})`,
      isServed(answer),
      `${answer.status}${answer.location ? ` → ${answer.location}` : ''}`,
    );
  }
}

export async function checkDatabase(platform: Platform, report: Report): Promise<void> {
  const healthy = report.check(
    AREA,
    'the platform is healthy before the database is touched (the checks below mean something)',
    (await healthStatus(platform)) === 200,
  );
  if (!healthy) return;

  // 1. Stopped, then started: what an operator's restart or a host update does.
  docker('stop', '-t', '10', DATABASE);
  await sleep(1500);
  await duringOutage(platform, report, 'database stopped');
  docker('start', DATABASE);
  await waitForDatabase(60);
  await afterRecovery(platform, report, 'database started again');

  // 2. Frozen: the connections stay, nothing answers (a stalled disk, a paused virtual machine).
  docker('pause', DATABASE);
  await sleep(1500);
  const frozenHealth = await ask(platform, '/api/health', { timeoutMs: 20_000 });
  report.check(
    AREA,
    'database frozen: /api/health says 503 within 8 s',
    frozenHealth.status === 503 && frozenHealth.ms < 8_000,
    frozenHealth.timedOut
      ? 'no answer'
      : `${frozenHealth.status} in ${Math.round(frozenHealth.ms)} ms`,
  );
  const frozenPage = await ask(platform, '/fr/dashboard', { as: 'member', timeoutMs: 45_000 });
  const verdict = judgeOutage(frozenPage);
  report.check(
    AREA,
    'database frozen: a page answers in less than 30 s (an answer that says so, not a wait without end)',
    verdict.ok && frozenPage.ms < 30_000,
    `${verdict.why} (${Math.round(frozenPage.ms)} ms)`,
  );
  docker('unpause', DATABASE);
  await afterRecovery(platform, report, 'database unfrozen');

  // 3. Killed in the middle of writes: PostgreSQL replays its log when it starts again.
  const batch = await writeWhileBroken(platform, {
    count: 60,
    concurrency: 6,
    breakAfterMs: 700,
    breakIt: () => void docker('kill', DATABASE),
  });
  docker('start', DATABASE);
  await waitForDatabase(90);
  await afterRecovery(platform, report, 'database killed and started again');
  await judgeBatch(platform, report, AREA, 'database killed during writes', batch);
}
