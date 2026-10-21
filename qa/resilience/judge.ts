/**
 * The judgments of the resilience suites that need no platform: pure functions, tested on their own (`judge.test.ts`), so
 * that a verdict that cannot fail is found out.
 */

export interface Attempt {
  /** The action was answered without an error (a 5xx is the platform saying it could not do it). */
  answered: boolean;
}

export interface Persisted {
  /** The ids of the events that exist, of the batch. */
  events: readonly string[];
  /** The ids the audit entries of the batch are about. */
  audited: readonly string[];
}

/**
 * What an interruption (the database killed, the container killed) may leave of a batch of writes: some happened, some did not,
 * and **every one that happened is whole**. An event with no audit entry is a half-done write (the entry is written in the same
 * transaction); an audit entry about an event that does not exist is its mirror; an action that answered, whose event is not
 * there, is a write the platform announced and lost. A refused write that is present anyway is fine: the answer was lost on the
 * way, not the write.
 */
export function wholeWrites(attempts: readonly Attempt[], persisted: Persisted): string[] {
  const problems: string[] = [];
  const events = new Set(persisted.events);
  const audited = new Set(persisted.audited);
  const withoutAudit = persisted.events.filter((id) => !audited.has(id));
  const withoutEvent = persisted.audited.filter((id) => !events.has(id));
  if (withoutAudit.length > 0)
    problems.push(`${withoutAudit.length} event(s) without their audit entry (a half-done write)`);
  if (withoutEvent.length > 0)
    problems.push(`${withoutEvent.length} audit entr(ies) about an event that does not exist`);
  const answered = attempts.filter((attempt) => attempt.answered).length;
  if (answered > events.size)
    problems.push(
      `${answered} action(s) were answered but only ${events.size} event(s) exist (a lost write)`,
    );
  return problems;
}

/**
 * What a visitor may be shown while the database is away: the page that says so (a redirect to it, or the page itself), or an
 * error status. Not a page of the platform drawn as if all was well (a login page for a signed-in member would sign them out
 * in their mind), and never a trace of the code or of the database address.
 */
export function outageAnswer(
  status: number,
  location: string | null,
  body: string,
): { ok: boolean; why: string } {
  if (
    /postgres(ql)?:\/\/|ECONNREFUSED|at \S+ \(.*:\d+:\d+\)|PrismaClient|DriverAdapterError/.test(
      body,
    )
  )
    return { ok: false, why: 'the answer shows a trace or an address of the database' };
  if (location !== null && /\/unavailable(\?|$)/.test(location))
    return { ok: true, why: 'sent to the page that says the service is unavailable' };
  if (status === 503) return { ok: true, why: 'answered 503' };
  if (/\/unavailable/.test(body)) return { ok: true, why: 'sent to the unavailable page (meta)' };
  return { ok: false, why: `answered ${status}${location ? ` → ${location}` : ''}` };
}

/** One line of the log of the listener that never answers: when a connection opened and when it closed. */
export interface Connection {
  id: number;
  openedAt: number;
  closedAt: number | null;
}

/** Reads the log of `hang.ts` (`open <id> <ms>` / `close <id> <ms>`). */
export function parseHangLog(log: string): Connection[] {
  const connections = new Map<number, Connection>();
  for (const line of log.split('\n')) {
    const match = /^(open|close) (\d+) (\d+)$/.exec(line.trim());
    if (!match) continue;
    const id = Number(match[2]);
    const at = Number(match[3]);
    if (match[1] === 'open') connections.set(id, { id, openedAt: at, closedAt: null });
    else {
      const known = connections.get(id);
      if (known) known.closedAt = at;
    }
  }
  return [...connections.values()].sort((a, b) => a.id - b.id);
}

/** How long each connection stayed open, in ms (still open: measured up to `now`). */
export const heldFor = (connections: readonly Connection[], now: number): number[] =>
  connections.map((connection) => (connection.closedAt ?? now) - connection.openedAt);
