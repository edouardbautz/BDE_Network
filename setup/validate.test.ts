// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  redirectUrl,
  validateAddress,
  validateClientId,
  validateClientSecret,
  validateColor,
  validateDiscordWebhook,
  validateEmail,
  validateLogins,
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
    expect(value(validateName('a'))).toBe('a');
    expect(value(validateName('x'.repeat(60)))).toBe('x'.repeat(60));
    expect(value(validateName("Bureau d'été #1: ça roule"))).toBe("Bureau d'été #1: ça roule");
  });

  it.each(['', '   ', 'x'.repeat(61), 'deux\nlignes', 'tab\there', 'null\0byte'])(
    'refuses %j',
    (input) => {
      expect(validateName(input)).toEqual({ ok: false, error: 'errName' });
    },
  );
});

describe('validateColor', () => {
  it('accepts three or six hexadecimal digits, with or without the #, and writes #rrggbb', () => {
    expect(value(validateColor('#0F766E'))).toBe('#0f766e');
    expect(value(validateColor('0f766e'))).toBe('#0f766e');
    expect(value(validateColor('#0a8'))).toBe('#00aa88');
    expect(value(validateColor(' #ABC '))).toBe('#aabbcc');
  });

  it.each(['', '#', '#12', '#12345', '#1234567', '#ggg', 'red', '#0f766e;x', 'rgb(1,2,3)'])(
    'refuses %j',
    (input) => {
      expect(validateColor(input)).toEqual({ ok: false, error: 'errColor' });
    },
  );
});

describe('validateTimezone', () => {
  it.each(['Europe/Paris', 'America/Montreal', 'Asia/Seoul', 'UTC'])('accepts %s', (zone) => {
    expect(value(validateTimezone(zone))).toBe(zone);
  });

  it.each(['', 'Paris', 'Mars/Olympus', 'Europe/', '  '])('refuses %j', (zone) => {
    expect(validateTimezone(zone)).toEqual({ ok: false, error: 'errTimezone' });
  });
});

describe('validateAddress', () => {
  const url = (input: string) => {
    const check = validateAddress(input);
    return check.ok ? check.value.url : check.error;
  };

  it('turns localhost into a local try-out on port 3000', () => {
    const check = validateAddress('localhost');
    expect(check).toMatchObject({
      ok: true,
      value: {
        url: 'http://localhost:3000',
        host: 'localhost',
        port: 3000,
        isLocal: true,
        insecureDomain: false,
      },
    });
  });

  it('keeps the port of a local try-out, and shows it in the address', () => {
    expect(url('localhost:3001')).toBe('http://localhost:3001');
    expect(url('http://localhost:8080/')).toBe('http://localhost:8080');
    expect(url('127.0.0.1:3000')).toBe('http://127.0.0.1:3000');
  });

  it('makes a domain name an https address, without a port when it is the usual one', () => {
    expect(url('bde.exemple.fr')).toBe('https://bde.exemple.fr');
    expect(url('BDE.Exemple.FR')).toBe('https://bde.exemple.fr');
    expect(url('https://bde.exemple.fr/')).toBe('https://bde.exemple.fr');
    expect(url('https://bde.exemple.fr:443')).toBe('https://bde.exemple.fr');
  });

  it('keeps an unusual port of a domain name', () => {
    expect(url('bde.exemple.fr:8443')).toBe('https://bde.exemple.fr:8443');
    expect(url('http://bde.exemple.fr:8080')).toBe('http://bde.exemple.fr:8080');
  });

  it('remembers that http was chosen for a real domain', () => {
    expect(validateAddress('http://bde.exemple.fr')).toMatchObject({
      ok: true,
      value: { url: 'http://bde.exemple.fr', insecureDomain: true, isLocal: false },
    });
    expect(validateAddress('https://bde.exemple.fr')).toMatchObject({
      value: { insecureDomain: false },
    });
  });

  it('accepts an IP address, in http, and does not call it insecure', () => {
    expect(validateAddress('192.168.1.20:3000')).toMatchObject({
      ok: true,
      value: { url: 'http://192.168.1.20:3000', insecureDomain: false, isLocal: false },
    });
  });

  it.each([
    '',
    '  ',
    'bde',
    'bde.exemple.fr/chemin',
    'bde.exemple.fr?x=1',
    'ftp://bde.exemple.fr',
    'bde exemple.fr',
    'localhost:0',
    'localhost:70000',
    'bde.exemple.fr:abc',
    '999.1.1.1',
    '-bde.exemple.fr',
    'bde..fr',
    'https://',
    'javascript:alert(1)',
  ])('refuses %j', (input) => {
    expect(validateAddress(input)).toEqual({ ok: false, error: 'errAddress' });
  });
});

describe('redirectUrl', () => {
  it('is the address followed by the callback path, with no trailing slash', () => {
    expect(redirectUrl('https://bde.exemple.fr')).toBe(
      'https://bde.exemple.fr/api/auth/callback/42-school',
    );
    expect(redirectUrl('http://localhost:3000')).toBe(
      'http://localhost:3000/api/auth/callback/42-school',
    );
  });
});

describe('OAuth credentials', () => {
  it('accepts an UID and a secret as 42 writes them', () => {
    expect(value(validateClientId('u-s4t2ud-3f2a9c'))).toBe('u-s4t2ud-3f2a9c');
    expect(value(validateClientSecret('s-s4t2ud-9d8c7b'))).toBe('s-s4t2ud-9d8c7b');
  });

  it('trims what was pasted', () => {
    expect(value(validateClientId('  u-s4t2ud-3f2a9c \n'))).toBe('u-s4t2ud-3f2a9c');
  });

  it.each(['', 'short', 'has space inside', 'u-s4t2ud with-space'])(
    'refuses the UID %j',
    (input) => {
      expect(validateClientId(input)).toEqual({ ok: false, error: 'errClientId' });
    },
  );

  it.each(['', 'short', 'has space inside', "s-s4t2ud-with'quote", 's-s4t2ud-line\nbreak'])(
    'refuses the secret %j',
    (input) => {
      expect(validateClientSecret(input)).toEqual({ ok: false, error: 'errClientSecret' });
    },
  );

  it('notices an UID and a secret that were swapped', () => {
    expect(validateClientId('s-s4t2ud-9d8c7b')).toEqual({ ok: false, error: 'errSwapped' });
    expect(validateClientSecret('u-s4t2ud-3f2a9c')).toEqual({ ok: false, error: 'errSwapped' });
  });
});

describe('validateLogins', () => {
  it('splits on commas, spaces and semicolons, lower-cases and removes duplicates', () => {
    expect(value(validateLogins('Jdupont, marie-d  paul;JDUPONT'))).toEqual([
      'jdupont',
      'marie-d',
      'paul',
    ]);
    expect(value(validateLogins('seul'))).toEqual(['seul']);
  });

  it.each(['', '  ,  ', 'bad_login', 'ünïcode', 'a b!', 'x'.repeat(41)])('refuses %j', (input) => {
    expect(validateLogins(input)).toEqual({ ok: false, error: 'errOwners' });
  });
});

describe('webhooks', () => {
  it('accepts a Discord webhook URL, from discord.com or discordapp.com', () => {
    expect(
      validateDiscordWebhook('https://discord.com/api/webhooks/123456789/abc-DEF_ghi').ok,
    ).toBe(true);
    expect(validateDiscordWebhook('https://discordapp.com/api/webhooks/1/x').ok).toBe(true);
    expect(validateDiscordWebhook('  https://discord.com/api/webhooks/1/x  ').ok).toBe(true);
  });

  it.each([
    '',
    'https://discord.com/api/webhooks/',
    'http://discord.com/api/webhooks/1/x',
    'https://evil.example/api/webhooks/1/x',
    'https://discord.com.evil.example/api/webhooks/1/x',
    'https://discord.com/api/webhooks/abc/x',
    'https://hooks.slack.com/services/T1/B1/x',
  ])('refuses %j as a Discord webhook', (input) => {
    expect(validateDiscordWebhook(input)).toEqual({ ok: false, error: 'errDiscord' });
  });

  it('accepts a Slack webhook URL', () => {
    expect(
      validateSlackWebhook('https://hooks.slack.com/services/T0ABC123/B0DEF456/AbC123xyz').ok,
    ).toBe(true);
  });

  it.each([
    '',
    'https://hooks.slack.com/services/',
    'https://hooks.slack.com/services/T1/B1',
    'http://hooks.slack.com/services/T1/B1/x',
    'https://hooks.slack.com.evil.example/services/T1/B1/x',
    'https://discord.com/api/webhooks/1/x',
  ])('refuses %j as a Slack webhook', (input) => {
    expect(validateSlackWebhook(input)).toEqual({ ok: false, error: 'errSlack' });
  });
});

describe('SMTP settings', () => {
  it('accepts a host name, localhost or an IP address, lower-cased', () => {
    expect(value(validateSmtpHost('SMTP.Gmail.com'))).toBe('smtp.gmail.com');
    expect(value(validateSmtpHost('localhost'))).toBe('localhost');
    expect(value(validateSmtpHost('10.0.0.5'))).toBe('10.0.0.5');
  });

  it.each(['', 'http://smtp.gmail.com', 'smtp gmail', 'smtp.gmail.com:587', 'smtp'])(
    'refuses the host %j',
    (input) => {
      expect(validateSmtpHost(input)).toEqual({ ok: false, error: 'errSmtpHost' });
    },
  );

  it('accepts a port from 1 to 65535', () => {
    expect(value(validatePort('587'))).toBe(587);
    expect(value(validatePort(' 25 '))).toBe(25);
    expect(value(validatePort('65535'))).toBe(65535);
  });

  it.each(['', '0', '65536', 'abc', '5.5', '-1', '587x'])('refuses the port %j', (input) => {
    expect(validatePort(input)).toEqual({ ok: false, error: 'errPort' });
  });

  it('accepts an e-mail address', () => {
    expect(value(validateEmail(' bde@exemple.fr '))).toBe('bde@exemple.fr');
  });

  it.each(['', 'bde', 'bde@', '@exemple.fr', 'bde@exemple', 'a b@exemple.fr', 'bde@exemple.fr>'])(
    'refuses the address %j',
    (input) => {
      expect(validateEmail(input)).toEqual({ ok: false, error: 'errEmail' });
    },
  );
});

describe('texts written to the .env file', () => {
  it('keeps a secret as typed, spaces and symbols included', () => {
    expect(value(validateSecretText('p@ss w0rd $#!'))).toBe('p@ss w0rd $#!');
  });

  it.each(["it's", 'a\nb', 'a\rb', 'a\0b'])(
    'refuses %j, which cannot be written safely',
    (input) => {
      expect(validateSecretText(input)).toEqual({ ok: false, error: 'errSecretChars' });
      expect(validateOptionalText(input)).toEqual({ ok: false, error: 'errSecretChars' });
    },
  );

  it('allows an optional text to be empty, and trims it', () => {
    expect(value(validateOptionalText('  '))).toBe('');
    expect(value(validateOptionalText(' user@x.fr '))).toBe('user@x.fr');
  });
});

describe('boundaries', () => {
  it('accepts an UID or a secret of exactly 8 characters, and refuses 7', () => {
    expect(validateClientId('u-123456').ok).toBe(true);
    expect(validateClientId('u-12345').ok).toBe(false);
    expect(validateClientSecret('s-123456').ok).toBe(true);
    expect(validateClientSecret('s-12345').ok).toBe(false);
  });

  it('accepts ports 1 and 65535 and refuses 0 and 65536, in an address and as a port', () => {
    expect(validateAddress('localhost:1').ok).toBe(true);
    expect(validateAddress('localhost:65535').ok).toBe(true);
    expect(validateAddress('localhost:0').ok).toBe(false);
    expect(validateAddress('localhost:65536').ok).toBe(false);
    expect(validatePort('1').ok).toBe(true);
    expect(validatePort('65535').ok).toBe(true);
    expect(validatePort('0').ok).toBe(false);
    expect(validatePort('65536').ok).toBe(false);
  });

  it('accepts an IP address with 255 in it and refuses 256', () => {
    expect(validateAddress('255.255.255.255:3000').ok).toBe(true);
    expect(validateAddress('10.0.0.256').ok).toBe(false);
  });
});
