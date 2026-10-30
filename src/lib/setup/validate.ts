/**
 * What the installer accepts for each answer. Every validator returns the cleaned-up value or the CODE of
 * what is wrong; the page translates the code (`setup.errors.<code>` in messages/*.json).
 *
 * The browser may run the same checks to show an error early, but the server runs them again: nothing
 * typed in the page is trusted.
 */

import { canonicalHost, isUnspecifiedHost } from '@/lib/public-address';

export type SetupErrorCode =
  | 'name'
  | 'color'
  | 'timezone'
  | 'address'
  | 'addressNoDot'
  | 'addressUnspecified'
  | 'clientId'
  | 'clientSecret'
  | 'swapped'
  | 'login'
  | 'discord'
  | 'slack'
  | 'smtpHost'
  | 'smtpHostScheme'
  | 'smtpHostPath'
  | 'smtpHostPort'
  | 'port'
  | 'email'
  | 'secretChars'
  | 'campus'
  | 'categoryLabel'
  | 'channelNotConfigured'
  | 'removedNotEmailed';

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

/**
 * `localhost`, `localhost:3001`, `bde.exemple.fr`, `https://bde.exemple.fr/`, `192.168.1.10:3000`, `[2001:db8::1]:3000` → a public address.
 * An IPv6 address is written between brackets when a port follows (bare, it has none); a name with no dot is refused
 * (`addressNoDot`): 42 sends people back to this address and browsers do not reliably keep the sign-in cookies for it.
 */
export function validateAddress(input: string): Check<Address> {
  const match =
    /^(?:(https?):\/\/)?(?:\[([0-9a-f:.]+)\]|([0-9a-f]*:[0-9a-f:.]*:[0-9a-f:.]*)|([^/\s:[\]]+))(?::(\d{1,5}))?\/?$/i.exec(
      input.trim(),
    );
  const v6 = match?.[2] ?? match?.[3];
  const written = v6 ?? match?.[4];
  // A bare IPv6 address carries no port (the colons would be ambiguous): the brackets are what allow one.
  if (!match || !written) return fail('address');

  // 127.0.0.1 is written `localhost`: Next.js does the same in every URL it builds (see canonicalHost).
  // An IPv6 address is written the way a URL writes it (compressed, lower case), the way Auth.js will send it.
  let host: string;
  try {
    host = canonicalHost(v6 === undefined ? written : new URL('http://[' + v6 + ']').hostname);
  } catch {
    return fail('address');
  }
  const explicitScheme = match[1]?.toLowerCase();
  const port = match[5] === undefined ? undefined : Number(match[5]);
  if (port !== undefined && (port < 1 || port > 65535)) return fail('address');

  // `0.0.0.0` is where the server listens, not an address anyone can open (nor one 42 can send people back to).
  if (isUnspecifiedHost(host)) return fail('addressUnspecified');

  const isLocal = host === 'localhost';
  const isIp =
    v6 !== undefined || (IPV4.test(host) && host.split('.').every((part) => Number(part) <= 255));
  if (!isLocal && !isIp && !DOMAIN.test(host)) {
    return fail(HOST_LABEL.test(host) && !/^\d+$/.test(host) ? 'addressNoDot' : 'address');
  }

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

/**
 * How the address typed compares with the one the browser is on right now (a warning, never a refusal: the
 * installation may be done from another machine, through a tunnel...). 42 sends the visitor back to the typed
 * address, and the sign-in cookies are kept for the address that started it: when the two differ, signing in
 * from here fails. `unspecified`: the browser itself is on `0.0.0.0`.
 */
export function addressNotice(
  typedUrl: string,
  browserOrigin: string,
): 'unspecified' | 'differs' | null {
  let browser: URL;
  try {
    browser = new URL(browserOrigin);
  } catch {
    return null;
  }
  if (isUnspecifiedHost(browser.hostname)) return 'unspecified';
  return browser.origin === typedUrl ? null : 'differs';
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

// RFC 1123 labels, plus the underscore: Docker names its services with it (`mail_server`).
const HOST_LABEL = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/;
const HEX_GROUP = /^[0-9a-f]{1,4}$/;

function isIPv4(text: string): boolean {
  const parts = text.split('.');
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isIPv6(text: string): boolean {
  const halves = text.split('::');
  if (halves.length > 2) return false;
  const groups = halves.flatMap((half) => (half === '' ? [] : half.split(':')));
  let count = groups.length;
  const last = groups[groups.length - 1];
  if (last?.includes('.')) {
    if (!isIPv4(last)) return false;
    groups.pop();
    count += 1; // an embedded IPv4 stands for two groups
  }
  if (!groups.every((group) => HEX_GROUP.test(group))) return false;
  return halves.length === 2 ? count <= 7 : count === 8;
}

/**
 * The name or address of a mail server (RFC 1123): labels of letters, digits and hyphens, so a name with no dot
 * (`mailpit`, `postfix`, a Docker service) is valid, as are `localhost`, an IPv4 and an IPv6 address (written
 * with or without brackets). The port has its own field: what is not a bare host says what to remove.
 */
export function validateSmtpHost(input: string): Check<string> {
  const text = input.trim().toLowerCase();
  if (text === '') return fail('smtpHost');
  if (text.includes('://')) return fail('smtpHostScheme');
  if (/[/?#\\@]/.test(text)) return fail('smtpHostPath');
  if (/\s/.test(text)) return fail('smtpHost');

  const bracketed = /^\[([^\]]*)\](.*)$/.exec(text);
  if (bracketed) {
    if (bracketed[2] !== '')
      return fail(bracketed[2]?.startsWith(':') ? 'smtpHostPort' : 'smtpHost');
    return isIPv6(bracketed[1] ?? '') ? ok(bracketed[1] ?? '') : fail('smtpHost');
  }
  if (text.includes(':')) {
    if (isIPv6(text)) return ok(text);
    return text.split(':').length === 2 ? fail('smtpHostPort') : fail('smtpHost');
  }

  if (text.length > 253) return fail('smtpHost');
  const labels = text.split('.');
  if (!labels.every((label) => HOST_LABEL.test(label))) return fail('smtpHost');
  // A name made only of digits and dots is an IPv4 address or nothing (RFC 1123: the last label is never all digits).
  if (/^\d+$/.test(labels[labels.length - 1] ?? ''))
    return isIPv4(text) ? ok(text) : fail('smtpHost');
  return ok(text);
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

/** The name of an event category: one line, 40 characters at most. */
export function validateCategoryLabel(input: string): Check<string> {
  const label = input.trim();
  return label.length >= 1 && label.length <= 40 && !/[ -]/.test(label)
    ? ok(label)
    : fail('categoryLabel');
}

/** A campus name as 42 gives it. */
export function validateCampusName(input: string): Check<string> {
  const name = input.trim();
  return name.length >= 1 && name.length <= 80 && !/[\u0000-\u001f\u007f]/.test(name)
    ? ok(name)
    : fail('campus');
}
