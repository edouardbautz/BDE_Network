import type { MessageKey } from './messages';

/** The answer of a validator: the cleaned-up value, or the message that says what is wrong. */
export type Check<T> = { ok: true; value: T } | { ok: false; error: MessageKey };

const ok = <T>(value: T): Check<T> => ({ ok: true, value });
const fail = (error: MessageKey): Check<never> => ({ ok: false, error });

/** Characters a secret may not hold: they could not be written safely to the .env file. */
const UNSAFE_SECRET = /['\r\n\0]/;

export function validateName(input: string): Check<string> {
  const name = input.trim();
  if (name.length < 1 || name.length > 60 || /[\u0000-\u001f\u007f]/.test(name))
    return fail('errName');
  return ok(name);
}

/** `#0F766E`, `0f766e`, `#0a8` → `#0f766e` / `#00aa88`. */
export function validateColor(input: string): Check<string> {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!match?.[1]) return fail('errColor');
  const digits =
    match[1].length === 3
      ? match[1]
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : match[1];
  return ok(`#${digits.toLowerCase()}`);
}

export function validateTimezone(input: string): Check<string> {
  const zone = input.trim();
  if (!zone) return fail('errTimezone');
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
  } catch {
    return fail('errTimezone');
  }
  return ok(zone);
}

export interface Address {
  /** The public address, without a trailing slash: `http://localhost:3000`, `https://bde.exemple.fr`. */
  url: string;
  host: string;
  /** The port the platform is reached on from this computer, for a local try-out. */
  port: number;
  /** `localhost` or a loopback address: a try-out on this computer. */
  isLocal: boolean;
  /** An explicit `http://` was written for a real domain name. */
  insecureDomain: boolean;
}

const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

/** `localhost`, `localhost:3001`, `bde.exemple.fr`, `https://bde.exemple.fr/` → a public address. */
export function validateAddress(input: string): Check<Address> {
  const match = /^(?:(https?):\/\/)?([^/\s:]+)(?::(\d{1,5}))?\/?$/i.exec(input.trim());
  if (!match?.[2]) return fail('errAddress');

  const host = match[2].toLowerCase();
  const explicitScheme = match[1]?.toLowerCase();
  const port = match[3] === undefined ? undefined : Number(match[3]);
  if (port !== undefined && (port < 1 || port > 65535)) return fail('errAddress');

  const isLocal = host === 'localhost' || host === '127.0.0.1';
  const isIp = IPV4.test(host) && host.split('.').every((part) => Number(part) <= 255);
  if (!isLocal && !isIp && !DOMAIN.test(host)) return fail('errAddress');

  const scheme = explicitScheme ?? (isLocal || isIp ? 'http' : 'https');
  const defaultPort = scheme === 'https' ? 443 : 80;
  const reached = port ?? (isLocal ? 3000 : defaultPort);
  // A local try-out always shows its port; a real address only when it is not the usual one.
  const showPort = isLocal || (port !== undefined && port !== defaultPort);

  return ok({
    url: `${scheme}://${host}${showPort ? `:${reached}` : ''}`,
    host,
    port: reached,
    isLocal,
    insecureDomain: scheme === 'http' && !isLocal && !isIp,
  });
}

/** The exact redirect URL to declare on the 42 intra. */
export function redirectUrl(publicUrl: string): string {
  return `${publicUrl}/api/auth/callback/42-school`;
}

export function validateClientId(input: string): Check<string> {
  const id = input.trim();
  if (id.length < 8 || /\s/.test(id)) return fail('errClientId');
  if (id.startsWith('s-')) return fail('errSwapped');
  return ok(id);
}

export function validateClientSecret(input: string): Check<string> {
  const secret = input.trim();
  if (secret.length < 8 || /\s/.test(secret) || UNSAFE_SECRET.test(secret)) {
    return fail('errClientSecret');
  }
  if (secret.startsWith('u-')) return fail('errSwapped');
  return ok(secret);
}

/** `Jdupont, marie-d  paul` → `['jdupont', 'marie-d', 'paul']` (a login is lower case on the intra). */
export function validateLogins(input: string): Check<string[]> {
  const logins = [
    ...new Set(
      input
        .split(/[\s,;]+/)
        .map((login) => login.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (logins.length === 0 || logins.some((login) => !/^[a-z0-9-]{1,40}$/.test(login))) {
    return fail('errOwners');
  }
  return ok(logins);
}

export function validateDiscordWebhook(input: string): Check<string> {
  const url = input.trim();
  return /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(url)
    ? ok(url)
    : fail('errDiscord');
}

export function validateSlackWebhook(input: string): Check<string> {
  const url = input.trim();
  return /^https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+$/.test(url)
    ? ok(url)
    : fail('errSlack');
}

export function validateSmtpHost(input: string): Check<string> {
  const host = input.trim().toLowerCase();
  return DOMAIN.test(host) || host === 'localhost' || IPV4.test(host)
    ? ok(host)
    : fail('errSmtpHost');
}

export function validatePort(input: string): Check<number> {
  const text = input.trim();
  const port = Number(text);
  return /^\d{1,5}$/.test(text) && port >= 1 && port <= 65535 ? ok(port) : fail('errPort');
}

export function validateEmail(input: string): Check<string> {
  const email = input.trim();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(email) ? ok(email) : fail('errEmail');
}

/** A secret typed for the .env file: anything, as long as it can be written there. */
export function validateSecretText(input: string): Check<string> {
  return UNSAFE_SECRET.test(input) ? fail('errSecretChars') : ok(input);
}

/** An optional single-line text for the .env file (an SMTP user): empty is fine. */
export function validateOptionalText(input: string): Check<string> {
  const text = input.trim();
  return UNSAFE_SECRET.test(text) ? fail('errSecretChars') : ok(text);
}
