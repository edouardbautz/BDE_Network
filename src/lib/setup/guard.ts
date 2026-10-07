import { createHash, randomBytes, randomInt } from 'node:crypto';

/**
 * Who may use the installer, as long as the platform is not installed.
 *
 * Until somebody has installed it, anybody who can reach the address could do it, and so choose the owners.
 * The protection is a code made when the server starts and shown in ITS logs (and in the terminal of
 * `docker compose up`), where only the person who runs the server looks:
 *
 *   - 8 letters and digits (no 0/O, 1/I/L), written `K7QM-4XPD`, new at every start, kept in memory only;
 *   - 5 wrong tries lock the entry for a while, longer each time (30 s, 1 min, 2 min... up to 15 min): somebody
 *     can delay the installation, never guess the code; restarting the container gives a new code;
 *   - the right code gives a session (a 256-bit random token in an HttpOnly, SameSite=Strict cookie, 2 hours);
 *     the server keeps only a hash of it;
 *   - once the platform is installed, nothing here answers any more (see `leaveSetupMode`).
 *
 * All of it sits on `globalThis`: Next.js bundles the pieces that need it separately.
 */

export const SETUP_COOKIE = 'bde_setup';
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
export const MAX_FAILURES = 5;
const FIRST_LOCK_MS = 30_000;
const MAX_LOCK_MS = 15 * 60_000;
const MAX_SESSIONS = 20;
/** No 0/O, no 1/I/L: a code that is read in a terminal and typed must not be ambiguous. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

interface SetupState {
  mode: 'setup' | 'ready';
  code: string;
  failures: number;
  locks: number;
  lockedUntil: number;
  /** hash of the token → when the session ends */
  sessions: Map<string, number>;
}

const SLOT = Symbol.for('bde-network.setup-state');
type Holder = typeof globalThis & { [SLOT]?: SetupState };

function state(): SetupState {
  const holder = globalThis as Holder;
  holder[SLOT] ??= {
    mode: 'ready',
    code: '',
    failures: 0,
    locks: 0,
    lockedUntil: 0,
    sessions: new Map(),
  };
  return holder[SLOT];
}

const hash = (token: string): string => createHash('sha256').update(token).digest('hex');

/** `k7qm 4xpd` → `K7QM4XPD`: what is compared, whatever way the code was typed. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** True while the platform is not installed. */
export function isSetupMode(): boolean {
  return state().mode === 'setup';
}

/** Starts the installation mode with a new code, which is returned (to be written to the logs). */
export function startSetupMode(): string {
  const current = state();
  current.mode = 'setup';
  current.code = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  current.failures = 0;
  current.locks = 0;
  current.lockedUntil = 0;
  current.sessions.clear();
  return formatCode(current.code);
}

/** The platform is installed: the code and every session are forgotten, nothing opens the installer again. */
export function leaveSetupMode(): void {
  const current = state();
  current.mode = 'ready';
  current.code = '';
  current.failures = 0;
  current.locks = 0;
  current.lockedUntil = 0;
  current.sessions.clear();
}

export type CodeResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'wrong' }
  | { ok: false; reason: 'locked'; retryAfterSeconds: number };

/** Checks a code typed by the visitor. The right one starts a session (the token goes in the cookie). */
export function verifySetupCode(input: string, now: number = Date.now()): CodeResult {
  const current = state();
  if (current.mode !== 'setup') return { ok: false, reason: 'wrong' };

  if (current.lockedUntil > now) {
    return {
      ok: false,
      reason: 'locked',
      retryAfterSeconds: Math.ceil((current.lockedUntil - now) / 1000),
    };
  }

  const typed = Buffer.from(hash(normalizeCode(input)));
  const expected = Buffer.from(hash(current.code));
  // Hashes of equal length, compared in constant time.
  const right = typed.length === expected.length && timingSafe(typed, expected);

  if (!right) {
    current.failures += 1;
    if (current.failures >= MAX_FAILURES) {
      current.failures = 0;
      current.locks += 1;
      const wait = Math.min(FIRST_LOCK_MS * 2 ** (current.locks - 1), MAX_LOCK_MS);
      current.lockedUntil = now + wait;
      return { ok: false, reason: 'locked', retryAfterSeconds: Math.ceil(wait / 1000) };
    }
    return { ok: false, reason: 'wrong' };
  }

  current.failures = 0;
  current.locks = 0;
  for (const [key, end] of current.sessions) if (end <= now) current.sessions.delete(key);
  while (current.sessions.size >= MAX_SESSIONS) {
    const oldest = current.sessions.keys().next().value;
    if (oldest === undefined) break;
    current.sessions.delete(oldest);
  }
  const token = randomBytes(32).toString('base64url');
  current.sessions.set(hash(token), now + SESSION_TTL_MS);
  return { ok: true, token };
}

function timingSafe(a: Buffer, b: Buffer): boolean {
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

/** The key of a session in the server's memory (for what is kept per session), or null when it is not valid. */
export function setupSessionKey(
  token: string | undefined,
  now: number = Date.now(),
): string | null {
  const current = state();
  if (current.mode !== 'setup' || !token) return null;
  const key = hash(token);
  const end = current.sessions.get(key);
  if (end === undefined || end <= now) {
    current.sessions.delete(key);
    return null;
  }
  return key;
}
