/**
 * What the installer accepts for each answer. Every validator returns the cleaned-up value or the CODE of
 * what is wrong; the page translates the code (`setup.errors.<code>` in messages/*.json).
 *
 * The browser may run the same checks to show an error early, but the server runs them again: nothing
 * typed in the page is trusted.
 */

export type SetupErrorCode =
  | 'name'
  | 'color'
  | 'timezone'
  | 'address'
  | 'clientId'
  | 'clientSecret'
  | 'swapped'
  | 'login'
  | 'discord'
  | 'slack'
  | 'smtpHost'
  | 'port'
  | 'email'
  | 'secretChars'
  | 'campus';

/** The answer of a validator: the cleaned-up value, or the code of what is wrong. */
export type Check<T> = { ok: true; value: T } | { ok: false; error: SetupErrorCode };

const ok = <T>(value: T): Check<T> => ({ ok: true, value });
const fail = (error: SetupErrorCode): Check<never> => ({ ok: false, error });

/** Characters a secret may not hold: they would break a line of text. */
const UNSAFE_SECRET = /['\r\n\0]/;

export function validateName(input: string): Check<string> {
  const name = input.trim();
  if (name.length < 1 || name.length > 60 || /[\u0000-\u001f\u007f]/.test(name)) {
    return fail('name');
  }
  return ok(name);
}

/** `#0F766E`, `0f766e`, `#0a8` → `#0f766e` / `#00aa88`. */
export function validateColor(input: string): Check<string> {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!match?.[1]) return fail('color');
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
  if (!zone) return fail('timezone');
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
  } catch {
    return fail('timezone');
  }
  return ok(zone);
}

export interface Address {
  /** The public address, without a trailing slash: `http://localhost:3000`, `https://bde.exemple.fr`. */
  url: string;
  host: string;
  /** `localhost` or a loopback address: a try-out on this computer. */
  isLocal: boolean;
  /** An explicit `http://` was written for a real domain name: the secrets would travel in clear. */
  insecureDomain: boolean;
}

const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

/** `localhost`, `localhost:3001`, `bde.exemple.fr`, `https://bde.exemple.fr/` → a public address. */
export function validateAddress(input: string): Check<Address> {
  const match = /^(?:(https?):\/\/)?([^/\s:]+)(?::(\d{1,5}))?\/?$/i.exec(input.trim());
  if (!match?.[2]) return fail('address');

  const host = match[2].toLowerCase();
  const explicitScheme = match[1]?.toLowerCase();
  const port = match[3] === undefined ? undefined : Number(match[3]);
  if (port !== undefined && (port < 1 || port > 65535)) return fail('address');

  const isLocal = host === 'localhost' || host === '127.0.0.1';
  const isIp = IPV4.test(host) && host.split('.').every((part) => Number(part) <= 255);
  if (!isLocal && !isIp && !DOMAIN.test(host)) return fail('address');

  const scheme = explicitScheme ?? (isLocal || isIp ? 'http' : 'https');
  const defaultPort = scheme === 'https' ? 443 : 80;
  // A local try-out always shows its port; a real address only when it is not the usual one.
  const shown = port ?? (isLocal ? 3000 : undefined);
  const showPort = shown !== undefined && (isLocal || shown !== defaultPort);

  return ok({
    url: `${scheme}://${host}${showPort ? `:${shown}` : ''}`,
    host,
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
  if (id.length < 8 || /\s/.test(id) || UNSAFE_SECRET.test(id)) return fail('clientId');
  if (id.startsWith('s-')) return fail('swapped');
  return ok(id);
}

export function validateClientSecret(input: string): Check<string> {
  const secret = input.trim();
  if (secret.length < 8 || /\s/.test(secret) || UNSAFE_SECRET.test(secret)) {
    return fail('clientSecret');
  }
  if (secret.startsWith('u-')) return fail('swapped');
  return ok(secret);
}

/** A 42 login, lower case as on the intra. */
export function validateLogin(input: string): Check<string> {
  const login = input.trim().toLowerCase();
  return /^[a-z0-9-]{1,40}$/.test(login) ? ok(login) : fail('login');
}

export function validateDiscordWebhook(input: string): Check<string> {
  const url = input.trim();
  return /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(url)
    ? ok(url)
    : fail('discord');
}

export function validateSlackWebhook(input: string): Check<string> {
  const url = input.trim();
  return /^https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+$/.test(url)
    ? ok(url)
    : fail('slack');
}

export function validateSmtpHost(input: string): Check<string> {
  const host = input.trim().toLowerCase();
  return DOMAIN.test(host) || host === 'localhost' || IPV4.test(host) ? ok(host) : fail('smtpHost');
}

export function validatePort(input: string): Check<number> {
  const text = input.trim();
  const port = Number(text);
  return /^\d{1,5}$/.test(text) && port >= 1 && port <= 65535 ? ok(port) : fail('port');
}

export function validateEmail(input: string): Check<string> {
  const email = input.trim();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(email) ? ok(email) : fail('email');
}

/** A secret typed in the page (an SMTP password): anything that is one line. */
export function validateSecretText(input: string): Check<string> {
  return UNSAFE_SECRET.test(input) ? fail('secretChars') : ok(input);
}

/** An optional single-line text (an SMTP user): empty is fine. */
export function validateOptionalText(input: string): Check<string> {
  const text = input.trim();
  return UNSAFE_SECRET.test(text) ? fail('secretChars') : ok(text);
}

/** A campus name as 42 gives it. */
export function validateCampusName(input: string): Check<string> {
  const name = input.trim();
  return name.length >= 1 && name.length <= 80 && !/[\u0000-\u001f\u007f]/.test(name)
    ? ok(name)
    : fail('campus');
}
