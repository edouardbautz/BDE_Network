import { cookieHeaderFor, persona, type PersonaKey } from '../personas';
import type { Platform } from '../access/http';

/**
 * What the security suites share: a way to say what was checked and what came of it, and requests made the way an
 * attacker makes them (a header the browser would never send, a cookie that was never issued).
 */

export interface Check {
  /** The suite: headers, sessions, csrf, feeds, uploads, injection, limits. */
  area: string;
  name: string;
  ok: boolean;
  detail: string;
}

export class Report {
  readonly checks: Check[] = [];

  /** Records a check; `detail` says what was seen (always, so that a pass is as readable as a failure). */
  check(area: string, name: string, ok: boolean, detail = ''): boolean {
    this.checks.push({ area, name, ok, detail });
    return ok;
  }

  get failures(): Check[] {
    return this.checks.filter((check) => !check.ok);
  }

  /** One line per failure, for a log or a summary. */
  describeFailures(limit = 60): string {
    return this.failures
      .slice(0, limit)
      .map((check) => `✗ [${check.area}] ${check.name}${check.detail ? `: ${check.detail}` : ''}`)
      .join('\n');
  }

  /** A table by suite: how many checks, how many failed. */
  byArea(): { area: string; total: number; failed: number }[] {
    const areas = new Map<string, { total: number; failed: number }>();
    for (const check of this.checks) {
      const entry = areas.get(check.area) ?? { total: 0, failed: 0 };
      entry.total += 1;
      if (!check.ok) entry.failed += 1;
      areas.set(check.area, entry);
    }
    return [...areas].map(([area, counts]) => ({ area, ...counts }));
  }
}

export interface Response2 {
  status: number;
  headers: Headers;
  body: string;
  /** How long the platform took, in milliseconds. */
  ms: number;
}

/** A request with exactly the headers asked for (and the cookie of a persona, when one is named). */
export async function send(
  platform: Platform,
  path: string,
  options: {
    as?: PersonaKey;
    method?: string;
    headers?: Record<string, string>;
    body?: BodyInit;
    /** The whole Cookie header, for a cookie nobody issued. Wins over `as`. */
    cookie?: string;
  } = {},
): Promise<Response2> {
  const cookie =
    options.cookie ??
    (options.as ? await cookieHeaderFor(persona(options.as), platform.secret) : null);
  const started = performance.now();
  const response = await fetch(`${platform.base}${path}`, {
    method: options.method ?? 'GET',
    redirect: 'manual',
    headers: { ...(cookie ? { cookie } : {}), ...options.headers },
    ...(options.body !== undefined ? { body: options.body } : {}),
  });
  const body = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body,
    ms: performance.now() - started,
  };
}

/** The pathname a redirect sends to, or null. */
export function redirectOf(response: Response2, platform: Platform): string | null {
  const location = response.headers.get('location');
  if (location && response.status >= 300 && response.status < 400)
    return new URL(location, platform.base).pathname;
  const meta =
    /<meta id="__next-page-redirect" http-equiv="refresh" content="\d+;url=([^"]+)"/.exec(
      response.body,
    );
  return meta?.[1] ? new URL(meta[1], platform.base).pathname : null;
}

/** Whether a page is the one that says "not found" (see qa/access/http.ts for how Next.js writes it). */
export function isNotFoundPage(response: Response2): boolean {
  return (
    response.status === 404 ||
    (/name="robots" content="noindex/.test(response.body) &&
      /NEXT_HTTP_ERROR_FALLBACK/.test(response.body))
  );
}
