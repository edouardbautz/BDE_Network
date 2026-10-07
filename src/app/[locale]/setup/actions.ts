'use server';

import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getSetupSession as session } from '@/lib/setup/session';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { installPlatform } from '@/lib/settings/store';
import { forgetDrafts, type SetupDraft } from '@/lib/setup/draft';
import {
  SESSION_TTL_MS,
  SETUP_COOKIE,
  isSetupMode,
  leaveSetupMode,
  verifySetupCode,
} from '@/lib/setup/guard';
import { buildInstallation } from '@/lib/setup/install';
import {
  checkLogin,
  listCampuses,
  realFetch,
  realSleep,
  verifyCredentials,
  type Campus,
} from '@/lib/setup/fortytwo';
import {
  realTransport,
  sendDiscordTest,
  sendSlackTest,
  sendTestMail,
  type SmtpSettings,
} from '@/lib/setup/notify-test';
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
  type SetupErrorCode,
} from '@/lib/setup/validate';

/**
 * The server side of the installer: one action per step. Every one of them
 *   - answers 404 once the platform is installed (`isSetupMode`): the installer is gone for good;
 *   - needs the installer session (the cookie given for the right code), else answers `session`;
 *   - validates what it receives again, whatever the page did: the browser is not trusted;
 *   - keeps the answer in the server's memory (`draft.ts`) and returns only what the page may show: a code of
 *     what is wrong (translated by the page), never a secret.
 */

export type ActionFailure = {
  ok: false;
  /** A validator's code, or one of: session, invalid, invalid-credentials, rate-limited, network, ... */
  code: SetupErrorCode | string;
  field?: string;
  /** A technical reason for a failed test (no address, no secret). */
  detail?: string;
  retryAfterSeconds?: number;
};
export type ActionResult<T = object> = ({ ok: true } & T) | ActionFailure;

const fail = (code: ActionFailure['code'], extra: Partial<ActionFailure> = {}): ActionFailure => ({
  ok: false,
  code,
  ...extra,
});

/** The step the person may now be on: never moves back, never beyond the one after the step just done. */
function reach(draft: SetupDraft, step: number): void {
  draft.step = Math.max(draft.step, step);
}

const stringField = z.string().max(500);

// ---------------------------------------------------------------------------------------------
// The code

export async function submitCode(code: string): Promise<ActionResult> {
  if (!isSetupMode()) notFound();
  if (typeof code !== 'string' || code.length > 64) return fail('wrong');

  const result = verifySetupCode(code);
  if (!result.ok) {
    return result.reason === 'locked'
      ? fail('locked', { retryAfterSeconds: result.retryAfterSeconds })
      : fail('wrong');
  }

  const requestHeaders = await headers();
  const secure = requestHeaders.get('x-forwarded-proto') === 'https';
  (await cookies()).set(SETUP_COOKIE, result.token, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// 1. The BDE

const identitySchema = z.object({
  name: stringField,
  accentColor: stringField,
  messageLocale: z.enum(['fr', 'en']),
});

export async function saveIdentity(input: unknown): Promise<ActionResult> {
  const ctx = await session();
  if (!ctx) return fail('session');
  const parsed = identitySchema.safeParse(input);
  if (!parsed.success) return fail('invalid');

  const name = validateName(parsed.data.name);
  if (!name.ok) return fail(name.error, { field: 'name' });
  const color = validateColor(parsed.data.accentColor);
  if (!color.ok) return fail(color.error, { field: 'accentColor' });

  ctx.draft.name = name.value;
  ctx.draft.accentColor = color.value;
  ctx.draft.messageLocale = parsed.data.messageLocale;
  reach(ctx.draft, 1);
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// 2. The public address

const addressSchema = z.object({ address: stringField, acceptInsecure: z.boolean().optional() });

export async function saveAddress(
  input: unknown,
): Promise<ActionResult<{ url: string; redirectUrl: string }>> {
  const ctx = await session();
  if (!ctx) return fail('session');
  const parsed = addressSchema.safeParse(input);
  if (!parsed.success) return fail('invalid');

  const address = validateAddress(parsed.data.address);
  if (!address.ok) return fail(address.error, { field: 'address' });
  // An http:// address for a real domain name: the 42 secret and the owners would travel in clear.
  if (address.value.insecureDomain && !parsed.data.acceptInsecure) {
    return fail('insecure', { field: 'address' });
  }

  ctx.draft.address = address.value;
  reach(ctx.draft, 2);
  return { ok: true, url: address.value.url, redirectUrl: redirectUrl(address.value.url) };
}

// ---------------------------------------------------------------------------------------------
// 3. The 42 application

const credentialsSchema = z.object({
  clientId: stringField,
  /** Blank: keep the one typed before (the page never gets it back). */
  clientSecret: stringField,
});

function takeCredentials(
  draft: SetupDraft,
  input: unknown,
): { ok: true; clientId: string; clientSecret: string } | ActionFailure {
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) return fail('invalid');

  const id = validateClientId(parsed.data.clientId);
  if (!id.ok) return fail(id.error, { field: 'clientId' });

  const typed = parsed.data.clientSecret.trim();
  const secret =
    typed === '' && draft.clientSecret
      ? { ok: true as const, value: draft.clientSecret }
      : validateClientSecret(typed);
  if (!secret.ok) return fail(secret.error, { field: 'clientSecret' });
  return { ok: true, clientId: id.value, clientSecret: secret.value };
}

export async function verifyFortyTwo(input: unknown): Promise<ActionResult> {
  const ctx = await session();
  if (!ctx) return fail('session');
  const taken = takeCredentials(ctx.draft, input);
  if (!taken.ok) return taken;

  const check = await verifyCredentials(realFetch, taken.clientId, taken.clientSecret);
  if (!check.ok) {
    if (check.reason === 'invalid') return fail('invalidCredentials', { field: 'clientSecret' });
    if (check.reason === 'rate-limited') return fail('rateLimited');
    return fail('network', {
      detail: check.reason === 'network' ? check.detail : `HTTP ${check.status}`,
    });
  }

  Object.assign(ctx.draft, {
    clientId: taken.clientId,
    clientSecret: taken.clientSecret,
    credentialsVerified: true,
    credentialsSkipped: false,
    fortyTwoToken: check.token,
    campusList: undefined,
  });
  reach(ctx.draft, 3);
  return { ok: true };
}

/** 42 cannot be reached from this machine: the person goes on without the check (and without the campus list). */
export async function skipFortyTwoVerification(input: unknown): Promise<ActionResult> {
  const ctx = await session();
  if (!ctx) return fail('session');
  const taken = takeCredentials(ctx.draft, input);
  if (!taken.ok) return taken;

  Object.assign(ctx.draft, {
    clientId: taken.clientId,
    clientSecret: taken.clientSecret,
    credentialsVerified: false,
    credentialsSkipped: true,
    fortyTwoToken: undefined,
    campusList: null,
  });
  reach(ctx.draft, 3);
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// 4. The campuses

export type CampusOption = Pick<Campus, 'name' | 'country' | 'timeZone'>;

/** The campuses of the network, or null when 42 cannot give them (the page then asks for names by hand). */
export async function loadCampuses(): Promise<ActionResult<{ campuses: CampusOption[] | null }>> {
  const ctx = await session();
  if (!ctx) return fail('session');
  const { draft } = ctx;

  if (draft.campusList === undefined) {
    draft.campusList = draft.fortyTwoToken
      ? await listCampuses(realFetch, draft.fortyTwoToken, realSleep)
      : null;
  }
  const list = draft.campusList;
  return {
    ok: true,
    campuses: list
      ? list.map(({ name, country, timeZone }) => ({ name, country, timeZone }))
      : null,
  };
}

const campusesSchema = z.object({
  campuses: z.array(stringField).max(200),
  mainCampus: stringField,
  timezone: stringField,
});

export async function saveCampuses(input: unknown): Promise<ActionResult> {
  const ctx = await session();
  if (!ctx) return fail('session');
  const parsed = campusesSchema.safeParse(input);
  if (!parsed.success) return fail('invalid');

  const campuses: string[] = [];
  for (const raw of parsed.data.campuses) {
    const campus = validateCampusName(raw);
    if (!campus.ok) return fail(campus.error, { field: 'campuses' });
    if (!campuses.includes(campus.value)) campuses.push(campus.value);
  }
  const main = validateCampusName(parsed.data.mainCampus);
  if (!main.ok) return fail('campus', { field: 'mainCampus' });
  // The campuses allowed to sign in include the BDE's own: a list that left it out would lock the BDE out.
  if (campuses.length > 0 && !campuses.includes(main.value)) {
    return fail('campusNotListed', { field: 'mainCampus' });
  }
  const zone = validateTimezone(parsed.data.timezone);
  if (!zone.ok) return fail(zone.error, { field: 'timezone' });

  ctx.draft.campuses = campuses;
  ctx.draft.mainCampus = main.value;
  ctx.draft.timezone = zone.value;
  reach(ctx.draft, 4);
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// 5. The owners

const loginSchema = z.object({ login: stringField });

/** Whether a login exists on the intra, before it is added to the owners. `unknown`: 42 could not say. */
export async function checkOwner(
  input: unknown,
): Promise<ActionResult<{ login: string; status: 'exists' | 'unknown' }>> {
  const ctx = await session();
  if (!ctx) return fail('session');
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return fail('invalid');
  const login = validateLogin(parsed.data.login);
  if (!login.ok) return fail(login.error, { field: 'login' });

  if (!ctx.draft.fortyTwoToken) return { ok: true, login: login.value, status: 'unknown' };
  const status = await checkLogin(realFetch, ctx.draft.fortyTwoToken, login.value, realSleep);
  if (status === 'missing') return fail('loginMissing', { field: 'login' });
  return { ok: true, login: login.value, status: status === 'exists' ? 'exists' : 'unknown' };
}

const ownersSchema = z.object({ owners: z.array(stringField).min(1).max(30) });

export async function saveOwners(input: unknown): Promise<ActionResult> {
  const ctx = await session();
  if (!ctx) return fail('session');
  const parsed = ownersSchema.safeParse(input);
  if (!parsed.success) return fail('noOwner', { field: 'login' });

  const owners: string[] = [];
  for (const raw of parsed.data.owners) {
    const login = validateLogin(raw);
    if (!login.ok) return fail(login.error, { field: 'login' });
    if (!owners.includes(login.value)) owners.push(login.value);
  }
  ctx.draft.owners = owners;
  reach(ctx.draft, 5);
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// 6. The modules

const modulesSchema = z.object({ events: z.boolean() });

export async function saveModules(input: unknown): Promise<ActionResult> {
  const ctx = await session();
  if (!ctx) return fail('session');
  const parsed = modulesSchema.safeParse(input);
  if (!parsed.success) return fail('invalid');
  ctx.draft.events = parsed.data.events;
  reach(ctx.draft, 6);
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// 7. The notifications

const notificationsSchema = z.object({
  mode: z.enum(['none', 'discord', 'slack', 'email']),
  /** Blank: keep the one typed before. */
  discordWebhook: stringField.optional(),
  slackWebhook: stringField.optional(),
  smtp: z
    .object({
      host: stringField,
      port: stringField,
      user: stringField,
      password: stringField,
      from: stringField,
    })
    .optional(),
});

type Notifications = NonNullable<SetupDraft['notifications']>;

function takeNotifications(
  draft: SetupDraft,
  input: unknown,
): { ok: true; value: Notifications } | ActionFailure {
  const parsed = notificationsSchema.safeParse(input);
  if (!parsed.success) return fail('invalid');
  const { mode } = parsed.data;
  const before = draft.notifications;

  if (mode === 'none') return { ok: true, value: { mode } };

  if (mode === 'discord') {
    const typed = (parsed.data.discordWebhook ?? '').trim();
    const url =
      typed === '' && before?.discordWebhook
        ? { ok: true as const, value: before.discordWebhook }
        : validateDiscordWebhook(typed);
    return url.ok
      ? { ok: true, value: { mode, discordWebhook: url.value } }
      : fail(url.error, { field: 'discordWebhook' });
  }

  if (mode === 'slack') {
    const typed = (parsed.data.slackWebhook ?? '').trim();
    const url =
      typed === '' && before?.slackWebhook
        ? { ok: true as const, value: before.slackWebhook }
        : validateSlackWebhook(typed);
    return url.ok
      ? { ok: true, value: { mode, slackWebhook: url.value } }
      : fail(url.error, { field: 'slackWebhook' });
  }

  const smtp = parsed.data.smtp;
  if (!smtp) return fail('invalid');
  const host = validateSmtpHost(smtp.host);
  if (!host.ok) return fail(host.error, { field: 'smtpHost' });
  const port = validatePort(smtp.port);
  if (!port.ok) return fail(port.error, { field: 'smtpPort' });
  const user = validateOptionalText(smtp.user);
  if (!user.ok) return fail(user.error, { field: 'smtpUser' });
  const from = validateEmail(smtp.from);
  if (!from.ok) return fail(from.error, { field: 'smtpFrom' });
  const typedPassword = smtp.password;
  const password =
    typedPassword === '' && before?.smtp?.password
      ? { ok: true as const, value: before.smtp.password }
      : validateSecretText(typedPassword);
  if (!password.ok) return fail(password.error, { field: 'smtpPassword' });

  const settings: SmtpSettings = {
    host: host.value,
    port: port.value,
    user: user.value,
    password: password.value,
    from: from.value,
  };
  return { ok: true, value: { mode, smtp: settings } };
}

export async function saveNotifications(input: unknown): Promise<ActionResult> {
  const ctx = await session();
  if (!ctx) return fail('session');
  const taken = takeNotifications(ctx.draft, input);
  if (!taken.ok) return taken;
  ctx.draft.notifications = taken.value;
  reach(ctx.draft, 7);
  return { ok: true };
}

const testSchema = z.object({ locale: z.enum(['fr', 'en']), to: stringField.optional() });

/** Sends one test message through what was typed (not saved yet), so the person sees it arrive. */
export async function testNotification(
  notifications: unknown,
  input: unknown,
): Promise<ActionResult> {
  const ctx = await session();
  if (!ctx) return fail('session');
  const taken = takeNotifications(ctx.draft, notifications);
  if (!taken.ok) return taken;
  const parsed = testSchema.safeParse(input);
  if (!parsed.success) return fail('invalid');

  const t = await getTranslations({ locale: parsed.data.locale, namespace: 'setup.test' });
  const text = t('message', { name: ctx.draft.name ?? 'BDE' });
  const value = taken.value;

  let result: { ok: true } | { ok: false; detail: string } = { ok: true };
  if (value.mode === 'discord' && value.discordWebhook) {
    result = await sendDiscordTest(realFetch, value.discordWebhook, text);
  } else if (value.mode === 'slack' && value.slackWebhook) {
    result = await sendSlackTest(realFetch, value.slackWebhook, text);
  } else if (value.mode === 'email' && value.smtp) {
    const to = validateEmail(parsed.data.to ?? '');
    if (!to.ok) return fail('email', { field: 'testTo' });
    result = await sendTestMail(
      realTransport,
      value.smtp,
      to.value,
      t('subject', { name: ctx.draft.name ?? 'BDE' }),
      text,
    );
  }
  return result.ok ? { ok: true } : fail('testFailed', { detail: result.detail });
}

// ---------------------------------------------------------------------------------------------
// 8. Install

export async function finishInstallation(): Promise<ActionResult> {
  const ctx = await session();
  if (!ctx) return fail('session');

  const installation = buildInstallation(ctx.draft);
  if (!installation.ok) {
    return installation.reason === 'incomplete'
      ? fail('incomplete')
      : fail('invalid', { detail: installation.issues.join(', ') });
  }

  const outcome = await installPlatform({
    config: installation.config,
    values: installation.values,
  });
  // Installed by someone else a moment ago: the installer is over for everybody.
  if (outcome === 'already-installed') {
    leaveSetupMode();
    forgetDrafts();
    notFound();
  }

  leaveSetupMode();
  forgetDrafts();
  // The cookie is left to expire: changing a cookie would make Next.js reload this page, which no longer exists,
  // before the person has read the last screen. Its session is forgotten by the server anyway.

  // The reminders of the events module start now that the platform has a configuration.
  const { startEventReminderScheduler } = await import('@/lib/events/scheduler');
  startEventReminderScheduler();
  return { ok: true };
}
