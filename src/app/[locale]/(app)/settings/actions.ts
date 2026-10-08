'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { getConfig } from '@/config';
import type { ActionResult, CampusOption } from '@/app/[locale]/setup/actions';
import { startEventReminderScheduler, stopEventReminderScheduler } from '@/lib/events/scheduler';
import { isSettingsEditable, requireSettingsManager } from '@/lib/settings/access';
import { applicationToken } from '@/lib/settings/fortytwo-token';
import { setting } from '@/lib/settings/runtime';
import {
  savedNotifications,
  updateSettings,
  type SettingsChange,
  type SettingsResult,
} from '@/lib/settings/update';
import {
  checkLogin,
  listCampuses,
  realFetch,
  realSleep,
  verifyCredentials,
} from '@/lib/setup/fortytwo';
import { parseNotifications } from '@/lib/setup/notifications';
import {
  realTransport,
  sendDiscordTest,
  sendSlackTest,
  sendTestMail,
} from '@/lib/setup/notify-test';
import {
  redirectUrl,
  validateAddress,
  validateClientId,
  validateClientSecret,
  validateEmail,
  validateLogin,
} from '@/lib/setup/validate';

/**
 * The server side of the settings page: one action per form. The forms are the installer's (`components/setup`),
 * so these answer the way the installer's actions do (`ActionResult`, the same names), with the same codes.
 *
 * Every one of them is an entry point of its own: it checks that the account behind the request is an OWNER (and
 * throws `Forbidden` otherwise: a crafted request, not a case the page offers), validates what it receives again,
 * and leaves the writing, the audit entry and the loading of the new settings to `updateSettings`.
 */

const text = z.string().max(500);

const failure = (
  code: string,
  extra: { field?: string; detail?: string } = {},
): { ok: false; code: string; field?: string; detail?: string } => ({ ok: false, code, ...extra });

/** The owner, or a "read only" answer when the settings are still in the files. */
async function owner() {
  const session = await requireSettingsManager();
  return isSettingsEditable()
    ? { actor: { login: session.user.login, id: session.user.id } }
    : null;
}

const readOnly = failure('readOnly');

function answer<T extends object = object>(result: SettingsResult, extra?: T): ActionResult<T> {
  if (!result.ok) {
    return failure(result.code, {
      ...(result.field && { field: result.field }),
      ...(result.detail && { detail: result.detail }),
    });
  }
  // What the layout shows (the name, the colour, the menu) comes from the settings too.
  revalidatePath('/', 'layout');
  return { ok: true, ...(extra ?? ({} as T)) };
}

async function change<T extends object = object>(
  change: SettingsChange,
  extra?: T,
): Promise<ActionResult<T>> {
  const context = await owner();
  if (!context) return readOnly;
  return answer(await updateSettings(change, context.actor), extra);
}

// ---------------------------------------------------------------------------------------------

const identitySchema = z.object({
  name: text,
  accentColor: text,
  messageLocale: z.string().max(10),
});

export async function saveIdentity(input: unknown): Promise<ActionResult> {
  await requireSettingsManager();
  const parsed = identitySchema.safeParse(input);
  if (!parsed.success) return failure('invalid');
  return change({ section: 'identity', ...parsed.data });
}

const addressSchema = z.object({ address: text, acceptInsecure: z.boolean().optional() });

export async function saveAddress(
  input: unknown,
): Promise<ActionResult<{ url: string; redirectUrl: string }>> {
  await requireSettingsManager();
  const parsed = addressSchema.safeParse(input);
  if (!parsed.success) return failure('invalid');
  const address = validateAddress(parsed.data.address);
  if (!address.ok) return failure(address.error, { field: 'address' });
  return change(
    {
      section: 'address',
      address: parsed.data.address,
      acceptInsecure: parsed.data.acceptInsecure,
    },
    { url: address.value.url, redirectUrl: redirectUrl(address.value.url) },
  );
}

// ---------------------------------------------------------------------------------------------
// The 42 application: asked to 42 BEFORE it is saved, because a wrong pair would lock everybody out.

const credentialsSchema = z.object({ clientId: text, clientSecret: text });

function credentialsOf(input: unknown) {
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) return failure('invalid');
  const id = validateClientId(parsed.data.clientId);
  if (!id.ok) return failure(id.error, { field: 'clientId' });
  // Blank: the saved secret, which the page never gets.
  const typed = parsed.data.clientSecret.trim();
  const saved = setting('FORTYTWO_CLIENT_SECRET');
  const secret =
    typed === '' && saved ? { ok: true as const, value: saved } : validateClientSecret(typed);
  if (!secret.ok) return failure(secret.error, { field: 'clientSecret' });
  return {
    ok: true as const,
    clientId: id.value,
    clientSecret: secret.value,
    typed: parsed.data.clientSecret,
  };
}

export async function verifyFortyTwo(input: unknown): Promise<ActionResult> {
  await requireSettingsManager();
  const credentials = credentialsOf(input);
  if (!credentials.ok) return credentials;

  const check = await verifyCredentials(realFetch, credentials.clientId, credentials.clientSecret);
  if (!check.ok) {
    if (check.reason === 'invalid') return failure('invalidCredentials', { field: 'clientSecret' });
    if (check.reason === 'rate-limited') return failure('rateLimited');
    return failure('network', {
      detail: check.reason === 'network' ? check.detail : `HTTP ${check.status}`,
    });
  }
  return change({
    section: 'oauth',
    clientId: credentials.clientId,
    clientSecret: credentials.typed,
  });
}

/** 42 cannot be reached from here: the owner saves without the check, knowing a wrong pair would lock the sign-in. */
export async function skipFortyTwoVerification(input: unknown): Promise<ActionResult> {
  await requireSettingsManager();
  const credentials = credentialsOf(input);
  if (!credentials.ok) return credentials;
  return change({
    section: 'oauth',
    clientId: credentials.clientId,
    clientSecret: credentials.typed,
  });
}

// ---------------------------------------------------------------------------------------------

export async function loadCampuses(): Promise<ActionResult<{ campuses: CampusOption[] | null }>> {
  await requireSettingsManager();
  const token = await applicationToken();
  const list = token ? await listCampuses(realFetch, token, realSleep) : null;
  return {
    ok: true,
    campuses: list
      ? list.map(({ name, country, timeZone }) => ({ name, country, timeZone }))
      : null,
  };
}

const campusesSchema = z.object({
  campuses: z.array(text).max(200),
  mainCampus: text,
  timezone: text,
});

export async function saveCampuses(input: unknown): Promise<ActionResult> {
  await requireSettingsManager();
  const parsed = campusesSchema.safeParse(input);
  if (!parsed.success) return failure('invalid');
  return change({ section: 'campuses', ...parsed.data });
}

// ---------------------------------------------------------------------------------------------
// The owners

const loginSchema = z.object({ login: text, acceptUnverified: z.boolean().optional() });

/** Whether a login exists on the intra, before the owner confirms making it an owner. */
export async function checkOwner(
  input: unknown,
): Promise<ActionResult<{ login: string; status: 'exists' | 'unknown' }>> {
  await requireSettingsManager();
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return failure('invalid');
  const login = validateLogin(parsed.data.login);
  if (!login.ok) return failure(login.error, { field: 'login' });

  const token = await applicationToken();
  if (!token) return { ok: true, login: login.value, status: 'unknown' };
  const status = await checkLogin(realFetch, token, login.value, realSleep);
  if (status === 'missing') return failure('loginMissing', { field: 'login' });
  return { ok: true, login: login.value, status: status === 'exists' ? 'exists' : 'unknown' };
}

export async function addOwner(input: unknown): Promise<ActionResult> {
  await requireSettingsManager();
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return failure('invalid');
  const login = validateLogin(parsed.data.login);
  if (!login.ok) return failure(login.error, { field: 'login' });

  // Asked again here, not trusted from the page: a wrong login can never sign in, and the owner who adds it
  // thinks somebody has all the rights.
  const token = await applicationToken();
  if (token) {
    const status = await checkLogin(realFetch, token, login.value, realSleep);
    if (status === 'missing') return failure('loginMissing', { field: 'login' });
    if (status === 'unknown' && !parsed.data.acceptUnverified) {
      return failure('loginUnverified', { field: 'login' });
    }
  } else if (!parsed.data.acceptUnverified) {
    return failure('loginUnverified', { field: 'login' });
  }
  return change({ section: 'owner-add', login: login.value });
}

export async function removeOwner(input: unknown): Promise<ActionResult> {
  await requireSettingsManager();
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return failure('invalid');
  return change({ section: 'owner-remove', login: parsed.data.login });
}

// ---------------------------------------------------------------------------------------------

const modulesSchema = z.object({ events: z.boolean() });

export async function saveModules(input: unknown): Promise<ActionResult> {
  await requireSettingsManager();
  const parsed = modulesSchema.safeParse(input);
  if (!parsed.success) return failure('invalid');
  const result = await change({ section: 'modules', events: parsed.data.events });
  // The reminders of the events module start now, or stop with it.
  if (result.ok) {
    if (parsed.data.events) startEventReminderScheduler();
    else stopEventReminderScheduler();
  }
  return result;
}

export async function saveNotifications(input: unknown): Promise<ActionResult> {
  await requireSettingsManager();
  return change({ section: 'notifications', notifications: input });
}

const testSchema = z.object({ locale: z.enum(['fr', 'en']), to: text.optional() });

/** One test message through what was typed (not saved yet), so the owner sees it arrive. */
export async function testNotification(
  notifications: unknown,
  input: unknown,
): Promise<ActionResult> {
  await requireSettingsManager();
  const parsed = parseNotifications(notifications, savedNotifications(currentValues()));
  if (!parsed.ok) return failure(parsed.code, parsed.field ? { field: parsed.field } : {});
  const options = testSchema.safeParse(input);
  if (!options.success) return failure('invalid');

  const name = getConfig().bde.name;
  const t = await getTranslations({ locale: options.data.locale, namespace: 'setup.test' });
  const body = t('message', { name });
  const value = parsed.value;

  let result: { ok: true } | { ok: false; detail: string } = { ok: true };
  if (value.mode === 'discord' && value.discordWebhook) {
    result = await sendDiscordTest(realFetch, value.discordWebhook, body);
  } else if (value.mode === 'slack' && value.slackWebhook) {
    result = await sendSlackTest(realFetch, value.slackWebhook, body);
  } else if (value.mode === 'email' && value.smtp) {
    const to = validateEmail(options.data.to ?? '');
    if (!to.ok) return failure('email', { field: 'testTo' });
    result = await sendTestMail(realTransport, value.smtp, to.value, t('subject', { name }), body);
  }
  return result.ok ? { ok: true } : failure('testFailed', { detail: result.detail });
}

function currentValues() {
  const values: Record<string, string> = {};
  for (const key of [
    'DISCORD_WEBHOOK_URL',
    'SLACK_WEBHOOK_URL',
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_USER',
    'SMTP_PASSWORD',
    'SMTP_FROM',
  ] as const) {
    const value = setting(key);
    if (value) values[key] = value;
  }
  return values;
}
