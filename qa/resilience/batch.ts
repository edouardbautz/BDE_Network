import type { Platform } from '../access/http';
import { withDatabase } from '../access/http';
import { checkInvariants, describeViolations } from '../invariants';
import type { Report } from '../security/core';
import { eventWriter } from './context';
import { sleep } from './docker';
import { wholeWrites, type Attempt } from './judge';

/**
 * A batch of writes with something broken in the middle of it: events created by a validator, a few at a time, while the
 * database or the application is killed. What is asked afterwards is not "did they all work" (they cannot) but "is what
 * happened whole" (`wholeWrites`) and "do the invariants of the database still hold".
 */

export interface BatchResult {
  attempts: Attempt[];
  prefix: string;
}

export async function writeWhileBroken(
  platform: Platform,
  {
    count,
    concurrency,
    breakAfterMs,
    breakIt,
  }: {
    count: number;
    concurrency: number;
    breakAfterMs: number;
    breakIt: () => void;
  },
): Promise<BatchResult> {
  const writer = eventWriter(platform);
  const prefix = `Resilience ${Date.now().toString(36)}`;
  const attempts: Attempt[] = [];
  let next = 0;

  const worker = async () => {
    while (next < count) {
      const index = next++;
      const call = await writer.create(`${prefix} #${index}`);
      attempts.push({ answered: !call.threw && call.status > 0 });
      // Spread the batch over the moment of the break: some before, some during, some after.
      await sleep(40);
    }
  };

  const breaker = sleep(breakAfterMs).then(breakIt);
  await Promise.all([breaker, ...Array.from({ length: concurrency }, worker)]);
  return { attempts, prefix };
}

/** After the recovery: whole writes only, and the invariants. */
export async function judgeBatch(
  platform: Platform,
  report: Report,
  area: string,
  name: string,
  { attempts, prefix }: BatchResult,
): Promise<void> {
  await withDatabase(platform, async (db) => {
    const events = await db.query(`SELECT "id" FROM "Event" WHERE "title" LIKE $1`, [`${prefix}%`]);
    const audits = await db.query(
      `SELECT "targetId" FROM "AuditLog" WHERE "action" = 'event.create' AND "targetLabel" LIKE $1`,
      [`${prefix}%`],
    );
    const problems = wholeWrites(attempts, {
      events: events.rows.map((row) => String(row.id)),
      audited: audits.rows.map((row) => String(row.targetId)),
    });
    const answered = attempts.filter((attempt) => attempt.answered).length;
    report.check(
      area,
      `${name}: every write that happened is whole`,
      problems.length === 0,
      problems.length > 0
        ? problems.join('; ')
        : `${events.rows.length} event(s) of ${attempts.length} attempts (${answered} answered), each with its audit entry`,
    );
    const violations = await checkInvariants(db);
    report.check(
      area,
      `${name}: the invariants of the database hold`,
      violations.length === 0,
      violations.length === 0 ? 'none broken' : describeViolations(violations),
    );
  });
}
