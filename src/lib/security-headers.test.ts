import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, securityHeaders } from './security-headers';

const valueOf = (rules: ReturnType<typeof securityHeaders>, key: string) =>
  rules.flatMap((rule) => rule.headers).find((header) => header.key === key)?.value;

describe('securityHeaders', () => {
  it('forbids framing, sniffing and leaking the referrer, in every mode', () => {
    for (const mode of ['development', 'production'] as const) {
      const rules = securityHeaders(mode);
      expect(valueOf(rules, 'X-Frame-Options')).toBe('DENY');
      expect(valueOf(rules, 'X-Content-Type-Options')).toBe('nosniff');
      expect(valueOf(rules, 'Referrer-Policy')).toBe('strict-origin-when-cross-origin');
      expect(valueOf(rules, 'Permissions-Policy')).toContain('camera=()');
    }
  });

  it('applies to every path', () => {
    expect(securityHeaders('production').every((rule) => rule.source === '/:path*')).toBe(true);
  });

  it('sends the CSP in production only (React dev tooling needs eval)', () => {
    expect(valueOf(securityHeaders('production'), 'Content-Security-Policy')).toBe(
      contentSecurityPolicy(),
    );
    expect(valueOf(securityHeaders('development'), 'Content-Security-Policy')).toBeUndefined();
  });

  it('sends HSTS only on requests that came over HTTPS', () => {
    const rule = securityHeaders('production').find((candidate) =>
      candidate.headers.some((header) => header.key === 'Strict-Transport-Security'),
    );

    expect(rule?.has).toEqual([{ type: 'header', key: 'x-forwarded-proto', value: 'https' }]);
    expect(rule?.headers[0]?.value).toBe('max-age=15552000');
    expect(valueOf(securityHeaders('development'), 'Strict-Transport-Security')).toBeUndefined();
  });
});

describe('contentSecurityPolicy', () => {
  const directives = new Map(
    contentSecurityPolicy()
      .split('; ')
      .map((directive) => {
        const [name, ...values] = directive.split(' ');
        return [name, values] as const;
      }),
  );

  it('cannot be framed, embed plugins or change the base URL', () => {
    expect(directives.get('frame-ancestors')).toEqual(["'none'"]);
    expect(directives.get('object-src')).toEqual(["'none'"]);
    expect(directives.get('base-uri')).toEqual(["'self'"]);
  });

  it('only loads from itself, except profile pictures from 42', () => {
    expect(directives.get('default-src')).toEqual(["'self'"]);
    expect(directives.get('connect-src')).toEqual(["'self'"]);
    expect(directives.get('img-src')).toEqual(["'self'", 'data:', 'https://cdn.intra.42.fr']);
  });

  it('lets the sign-in form go to 42, and nowhere else', () => {
    expect(directives.get('form-action')).toEqual(["'self'", 'https://api.intra.42.fr']);
  });

  it('does not force https: an instance without an HTTPS proxy must keep working', () => {
    expect(contentSecurityPolicy()).not.toContain('upgrade-insecure-requests');
  });
});
