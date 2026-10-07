// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  redirectUrl,
  validateAddress,
  validateCampusName,
  validateClientId,
  validateClientSecret,
  validateColor,
  validateDiscordWebhook,
  validateEmail,
  validateLogin,
  validateName,
  validateOptionalText,
  validatePort,
  validateSecretText,
  validateSlackWebhook,
  validateSmtpHost,
  validateTimezone,
} from './validate';

const value = <T>(check: { ok: boolean; value?: T; error?: string }) =>
  check.ok ? check.value : check.error;

describe('validateName', () => {
  it('keeps a name of 1 to 60 characters, trimmed', () => {
    expect(value(validateName('  BDE Les Lynx '))).toBe('BDE Les Lynx');
    expect(value(validateName('x'.repeat(60)))).toBe('x'.repeat(60));
    expect(value(validateName("Bureau d'été #1: ça roule"))).toBe("Bureau d'été #1: ça roule");
  });

  it.each(['', '   ', 'x'.repeat(61), 'deux\nlignes', 'tab\there', 'null\0byte'])(
    'refuses %j',
    (input) => {
      expect(validateName(input)).toEqual({ ok: false, error: 'name' });
    },
  );
});

describe('validateColor', () => {
  it('writes #rrggbb whatever way it was typed', () => {
    expect(value(validateColor('#0F766E'))).toBe('#0f766e');
    expect(value(validateColor('0f766e'))).toBe('#0f766e');
    expect(value(validateColor('#0a8'))).toBe('#00aa88');
    expect(value(validateColor(' #ABC '))).toBe('#aabbcc');
  });

  it.each(['', '#', '#12', '#12345', '#ggg', 'red', '#0f766e;x', 'rgb(1,2,3)'])(
    'refuses %j',
    (input) => {
      expect(validateColor(input)).toEqual({ ok: false, error: 'color' });
    },
  );
});

describe('validateTimezone', () => {
  it.each(['Europe/Paris', 'America/Montreal', 'UTC'])('accepts %s', (zone) => {
    expect(value(validateTimezone(zone))).toBe(zone);
  });
  it.each(['', '  ', 'Paris', 'Mars/Olympus'])('refuses %j', (zone) => {
    expect(validateTimezone(zone)).toEqual({ ok: false, error: 'timezone' });
  });
});

describe('validateAddress', () => {
  it('gives a local try-out its port, and http', () => {
    expect(validateAddress('localhost')).toMatchObject({
      ok: true,
      value: { url: 'http://localhost:3000', isLocal: true, insecureDomain: false },
    });
    expect(value(validateAddress('http://localhost:3500/'))).toMatchObject({
      url: 'http://localhost:3500',
    });
    expect(value(validateAddress('127.0.0.1:3500'))).toMatchObject({
      url: 'http://127.0.0.1:3500',
    });
  });

  it('takes a domain name as https, without its usual port or a trailing slash', () => {
    expect(value(validateAddress('bde.exemple.fr'))).toMatchObject({
      url: 'https://bde.exemple.fr',
      isLocal: false,
      insecureDomain: false,
    });
    expect(value(validateAddress('https://BDE.exemple.fr:443/'))).toMatchObject({
      url: 'https://bde.exemple.fr',
    });
    expect(value(validateAddress('https://bde.exemple.fr:8443'))).toMatchObject({
      url: 'https://bde.exemple.fr:8443',
    });
  });

  it('flags a real domain written with http://: the secrets would travel in clear', () => {
    expect(value(validateAddress('http://bde.exemple.fr'))).toMatchObject({
      url: 'http://bde.exemple.fr',
      insecureDomain: true,
    });
  });

  it('does not flag an IP address (a try-out on the local network)', () => {
    expect(value(validateAddress('192.168.1.20:3000'))).toMatchObject({ insecureDomain: false });
  });

  it.each([
    '',
    'not an address',
    'bde',
    'ftp://bde.exemple.fr',
    'bde.exemple.fr:99999',
    '999.1.1.1.1',
    'bde.exemple.fr/path',
    'javascript:alert(1)',
  ])('refuses %j', (input) => {
    expect(validateAddress(input)).toEqual({ ok: false, error: 'address' });
  });

  it('writes the redirect address 42 must be given', () => {
    expect(redirectUrl('https://bde.exemple.fr')).toBe(
      'https://bde.exemple.fr/api/auth/callback/42-school',
    );
  });
});

describe('the 42 application', () => {
  it('accepts an UID and a SECRET', () => {
    expect(value(validateClientId(' u-s4t2ud-abcdef '))).toBe('u-s4t2ud-abcdef');
    expect(value(validateClientSecret('s-s4t2ud-123456'))).toBe('s-s4t2ud-123456');
  });

  it('notices an UID and a SECRET that were swapped', () => {
    expect(validateClientId('s-s4t2ud-123456')).toEqual({ ok: false, error: 'swapped' });
    expect(validateClientSecret('u-s4t2ud-abcdef')).toEqual({ ok: false, error: 'swapped' });
  });

  it.each(['', 'short', 'has a space inside', "it's"])('refuses an UID of %j', (input) => {
    expect(validateClientId(input).ok).toBe(false);
  });
  it.each(['', 'short', 'has a space inside', "it's-a-secret", 'line\nbreak'])(
    'refuses a SECRET of %j',
    (input) => {
      expect(validateClientSecret(input)).toEqual({ ok: false, error: 'clientSecret' });
    },
  );
});

describe('validateLogin', () => {
  it('lower-cases, as on the intra', () => {
    expect(value(validateLogin(' Jdupont '))).toBe('jdupont');
    expect(value(validateLogin('marie-d'))).toBe('marie-d');
  });
  it.each(['', 'a b', 'a_b', 'é', 'x'.repeat(41), 'a;b', '<script>'])('refuses %j', (input) => {
    expect(validateLogin(input)).toEqual({ ok: false, error: 'login' });
  });
});

describe('webhooks', () => {
  it('accepts the addresses Discord and Slack give', () => {
    expect(
      validateDiscordWebhook('https://discord.com/api/webhooks/123456789/abc-DEF_ghi').ok,
    ).toBe(true);
    expect(validateSlackWebhook('https://hooks.slack.com/services/T0123/B0123/abcDEF123').ok).toBe(
      true,
    );
  });

  it.each([
    'http://discord.com/api/webhooks/1/x',
    'https://evil.example/api/webhooks/1/x',
    'https://discord.com.evil.example/api/webhooks/1/x',
    '',
  ])('refuses %j as a Discord webhook', (input) => {
    expect(validateDiscordWebhook(input)).toEqual({ ok: false, error: 'discord' });
  });
  it.each(['https://hooks.slack.com.evil.example/services/T1/B1/x', 'https://slack.com', ''])(
    'refuses %j as a Slack webhook',
    (input) => {
      expect(validateSlackWebhook(input)).toEqual({ ok: false, error: 'slack' });
    },
  );
});

describe('mail settings', () => {
  it('accepts a host, a port and an address', () => {
    expect(value(validateSmtpHost(' SMTP.exemple.fr '))).toBe('smtp.exemple.fr');
    expect(value(validateSmtpHost('localhost'))).toBe('localhost');
    expect(value(validatePort('587'))).toBe(587);
    expect(validateEmail('bde@exemple.fr').ok).toBe(true);
  });
  it('refuses what is not', () => {
    expect(validateSmtpHost('not a host')).toEqual({ ok: false, error: 'smtpHost' });
    for (const port of ['', '0', '65536', 'abc', '587; drop']) {
      expect(validatePort(port)).toEqual({ ok: false, error: 'port' });
    }
    expect(validateEmail('not-an-email')).toEqual({ ok: false, error: 'email' });
  });
  it('keeps secrets to one line, with no apostrophe', () => {
    expect(validateSecretText('p@ss w0rd!').ok).toBe(true);
    expect(validateSecretText("it's")).toEqual({ ok: false, error: 'secretChars' });
    expect(validateSecretText('a\nb')).toEqual({ ok: false, error: 'secretChars' });
    expect(value(validateOptionalText('  '))).toBe('');
  });
});

describe('validateCampusName', () => {
  it('keeps the name as 42 writes it', () => {
    expect(value(validateCampusName(' Montréal '))).toBe('Montréal');
  });
  it.each(['', '  ', 'x'.repeat(81), 'a\nb'])('refuses %j', (input) => {
    expect(validateCampusName(input)).toEqual({ ok: false, error: 'campus' });
  });
});
