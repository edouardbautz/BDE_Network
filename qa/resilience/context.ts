import { FIXTURES } from '../dataset';
import { eventForm } from '../access/actions';
import { callAction, locate, readManifest, type Call } from '../access/actions-run';
import type { Platform } from '../access/http';
import { cookieHeaderFor, persona, type PersonaKey } from '../personas';
import type { Report } from '../security/core';
import { outageAnswer } from './judge';

/** What every resilience suite is given. */
export interface Context {
  platform: Platform;
  report: Report;
}

export interface Answer {
  status: number;
  location: string | null;
  body: string;
  ms: number;
  /** Nothing answered before the deadline. */
  timedOut: boolean;
}

/** A page or a route as a persona asks for it, with a deadline: a platform that never answers is a finding, not a hang of the suite. */
export async function ask(
  platform: Platform,
  path: string,
  { as, timeoutMs = 30_000 }: { as?: PersonaKey; timeoutMs?: number } = {},
): Promise<Answer> {
  const cookie = as ? await cookieHeaderFor(persona(as), platform.secret) : null;
  const started = performance.now();
  try {
    const response = await fetch(`${platform.base}${path}`, {
      redirect: 'manual',
      headers: cookie ? { cookie } : {},
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.text();
    return {
      status: response.status,
      location: response.headers.get('location'),
      body,
      ms: performance.now() - started,
      timedOut: false,
    };
  } catch {
    return { status: 0, location: null, body: '', ms: performance.now() - started, timedOut: true };
  }
}

/** A page that answers like the page of a signed-in person: 200, and not the login page. */
export const isServed = (answer: Answer): boolean =>
  answer.status === 200 && !answer.timedOut && !/unavailable/.test(answer.body.slice(0, 4000));

/** The verdict of `outageAnswer` on an answer, or the reason there was none. */
export function judgeOutage(answer: Answer): { ok: boolean; why: string } {
  if (answer.timedOut) return { ok: false, why: `no answer in ${Math.round(answer.ms / 1000)} s` };
  return outageAnswer(answer.status, answer.location, answer.body);
}

/** The creation of events, as the validator's browser sends it: the writes the interruptions are played against. */
export function eventWriter(platform: Platform) {
  const manifest = readManifest();
  const { id, page } = locate(manifest, 'events.createEvent');
  return {
    /** One creation; `title` is how the batch finds it again. */
    create(title: string, as: PersonaKey = 'validator'): Promise<Call> {
      return callAction(platform, as, id, page, [
        {},
        eventForm({
          title,
          status: 'CONFIRMED',
          startsAt: '2027-01-12T20:00',
          endsAt: '2027-01-12T22:00',
        }),
      ]).catch(() => ({ status: 0, threw: true, text: 'no answer' }));
    },
  };
}

/** The fixtures a scenario acts on. */
export const EVENTS = FIXTURES.events;
