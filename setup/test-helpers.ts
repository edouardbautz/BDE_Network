import type { LineReader } from './prompts';
import { InputClosedError } from './prompts';
import type { FetchLike } from './fortytwo';

/** Test helpers of the setup assistant: a scripted terminal and a pretend 42 API. */

export interface ScriptedReader extends LineReader {
  /** Everything the assistant printed (prompts included), as one text. */
  transcript(): string;
  /** The prompts that asked for a secret. */
  secretPrompts: string[];
  /** Lines that were never read. */
  remaining(): string[];
}

/** Answers a script, one line per question; running out of lines closes the input, like a Ctrl+D. */
export function scriptedReader(lines: string[]): ScriptedReader {
  const queue = [...lines];
  const printed: string[] = [];
  const secretPrompts: string[] = [];

  const next = (prompt: string): Promise<string> => {
    printed.push(prompt);
    const line = queue.shift();
    return line === undefined ? Promise.reject(new InputClosedError()) : Promise.resolve(line);
  };

  return {
    readLine: (prompt) => next(prompt),
    readSecret: (prompt) => {
      secretPrompts.push(prompt);
      return next(prompt);
    },
    write: (text) => void printed.push(text),
    close: () => undefined,
    transcript: () => printed.join(''),
    secretPrompts,
    remaining: () => [...queue],
  };
}

export interface FakeApiOptions {
  /** The pairs of UID / secret the pretend API accepts. */
  credentials?: Record<string, string>;
  campuses?: Array<{ id: number; name: string; country?: string; time_zone?: string }>;
  logins?: string[];
  /** Everything fails like a network error. */
  down?: boolean;
  /** Answer this status to the token request instead of judging the credentials. */
  tokenStatus?: number;
  /** Fail the list of campuses with this status. */
  campusStatus?: number;
}

export interface FakeApi {
  fetch: FetchLike;
  /** Every request made, as `METHOD url` (never a body: bodies hold secrets). */
  requests: string[];
  /** The bodies sent to the token endpoint. */
  tokenBodies: string[];
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

/** A pretend 42 API: token (client credentials), campuses and users. */
export function fakeApi(options: FakeApiOptions = {}): FakeApi {
  const requests: string[] = [];
  const tokenBodies: string[] = [];
  const credentials = options.credentials ?? { 'u-s4t2ud-good': 's-s4t2ud-secret' };
  const campuses = options.campuses ?? [];
  const logins = options.logins ?? [];

  const fetch: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    requests.push(`${method} ${url}`);
    if (options.down)
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });

    const { pathname, searchParams } = new URL(url);
    if (pathname === '/oauth/token' && method === 'POST') {
      const body = String(init?.body ?? '');
      tokenBodies.push(body);
      if (options.tokenStatus) return json({ error: 'x' }, options.tokenStatus);
      const params = new URLSearchParams(body);
      const id = params.get('client_id') ?? '';
      const valid =
        params.get('grant_type') === 'client_credentials' &&
        credentials[id] !== undefined &&
        credentials[id] === params.get('client_secret');
      return valid
        ? json({ access_token: 'token-123', token_type: 'bearer' })
        : json({ error: 'invalid_client' }, 401);
    }

    const authorization = new Headers(init?.headers).get('Authorization');
    if (authorization !== 'Bearer token-123') return json({ error: 'unauthorized' }, 401);

    if (pathname === '/v2/campus') {
      if (options.campusStatus) return json({}, options.campusStatus);
      const size = Number(searchParams.get('page[size]') ?? 30);
      const page = Number(searchParams.get('page[number]') ?? 1);
      return json(campuses.slice((page - 1) * size, page * size));
    }
    const user = /^\/v2\/users\/([^/]+)$/.exec(pathname)?.[1];
    if (user) {
      return logins.includes(decodeURIComponent(user))
        ? json({ login: decodeURIComponent(user) })
        : json({}, 404);
    }
    return json({}, 404);
  };

  return { fetch, requests, tokenBodies };
}

export const CAMPUSES = [
  { id: 1, name: 'Paris', country: 'France', time_zone: 'Europe/Paris' },
  { id: 2, name: 'Nice', country: 'France', time_zone: 'Europe/Paris' },
  { id: 3, name: 'Lyon', country: 'France', time_zone: 'Europe/Paris' },
  { id: 4, name: 'Montréal', country: 'Canada', time_zone: 'America/Toronto' },
  { id: 5, name: 'Seoul', country: 'South Korea', time_zone: 'Asia/Seoul' },
  { id: 6, name: 'Nicosia', country: 'Cyprus', time_zone: 'Asia/Nicosia' },
];
