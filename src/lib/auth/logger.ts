import type { LoggerInstance } from '@auth/core/types';

/**
 * What Auth.js says about a request that was refused because of what the visitor sent, not because anything is wrong
 * here: a cookie that cannot be read (expired, signed with a secret that has changed, forged), a form without its CSRF
 * token, a callback address or a state that does not parse, an action that does not exist. Auth.js logs each of them as an
 * error with a stack trace, so one visitor (or a script) could fill the logs of the platform, and after a change of secret
 * every member's old cookie did the same: a log that always shouts is a log where the real problem is not seen.
 *
 * These are told in one line, as a warning, without the trace. Everything else (the sign-in with 42 failing, a database
 * that does not answer, a callback that throws) keeps the complete report, the same as Auth.js writes by default.
 */
export const REFUSED_REQUEST_ERRORS: ReadonlySet<string> = new Set([
  'JWTSessionError',
  'MissingCSRF',
  'InvalidCheck',
  'InvalidCallbackUrl',
  'UnknownAction',
]);

type AuthFailure = Error & { type?: string; cause?: unknown };

export const authLogger: Pick<LoggerInstance, 'error'> = {
  error(error: AuthFailure) {
    const name = error.type ?? error.name;
    if (REFUSED_REQUEST_ERRORS.has(name)) {
      console.warn(`[auth] ${name}: request refused`);
      return;
    }

    console.error(`[auth][error] ${name}: ${error.message}`);
    const { cause } = error;
    if (cause && typeof cause === 'object' && 'err' in cause && cause.err instanceof Error) {
      const { err, ...data } = cause as { err: Error } & Record<string, unknown>;
      console.error('[auth][cause]:', err.stack);
      console.error('[auth][details]:', JSON.stringify(data, null, 2));
    } else if (error.stack) {
      console.error(error.stack.replace(/.*/, '').substring(1));
    }
  },
};
