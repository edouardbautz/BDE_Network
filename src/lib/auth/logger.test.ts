// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authLogger, REFUSED_REQUEST_ERRORS } from './logger';

const error = (name: string, message = 'a message', extra: object = {}) =>
  Object.assign(new Error(message), { name, ...extra });

afterEach(() => vi.restoreAllMocks());

describe('authLogger', () => {
  it.each([...REFUSED_REQUEST_ERRORS])(
    'tells %s in one line, as a warning, without a trace',
    (name) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const fail = vi.spyOn(console, 'error').mockImplementation(() => {});

      authLogger.error(error(name, 'Invalid callback URL. Received: javascript:alert(1)'));

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(`[auth] ${name}: request refused`);
      expect(fail).not.toHaveBeenCalled();
    },
  );

  it('reads the type of an Auth.js error before its name', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    authLogger.error(error('AuthError', 'x', { type: 'MissingCSRF' }));
    expect(warn).toHaveBeenCalledWith('[auth] MissingCSRF: request refused');
  });

  it('does not repeat what the visitor sent (an address, a cookie)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    authLogger.error(error('JWTSessionError', 'secret-cookie-value-123'));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-cookie-value-123');
  });

  it('keeps the complete report of an error that matters', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fail = vi.spyOn(console, 'error').mockImplementation(() => {});

    authLogger.error(error('OAuthCallbackError', '42 did not answer'));

    expect(warn).not.toHaveBeenCalled();
    expect(fail.mock.calls[0]?.[0]).toBe('[auth][error] OAuthCallbackError: 42 did not answer');
    expect(fail.mock.calls.length).toBeGreaterThan(1);
  });

  it('shows the cause of an error that has one', () => {
    const fail = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cause = new Error('connection refused');

    authLogger.error(
      error('CallbackRouteError', 'failed', { cause: { err: cause, provider: '42-school' } }),
    );

    const lines = fail.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(lines).toContain('connection refused');
    expect(lines).toContain('42-school');
  });
});
