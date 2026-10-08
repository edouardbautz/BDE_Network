import { validateEnvironment } from '@/config/env';
import { EVENTS_MODULE_KEY, bdeConfigSchema, type BdeConfig } from '@/config/schema';
import { DEFAULT_LOGO_PATH, logoVersionOf } from '@/lib/branding/storage';
import type { PrismaClient } from '@/generated/prisma/client';
import { logAuditEvent } from '@/lib/audit-log';
import { prisma } from '@/lib/prisma';
import { DEFAULT_CATEGORIES, notificationChannels } from '@/lib/setup/install';
import {
  parseNotifications,
  type Channel,
  type NotificationSettings,
} from '@/lib/setup/notifications';
import * as validate from '@/lib/setup/validate';
import { seal, settingsKey, SettingsDecryptError, unseal } from './crypto';
import { syncOwnerAccounts } from './owners';
import { SETTING_KEYS, setRuntimeSettings, type SettingKey, type SettingValues } from './runtime';
import { PLATFORM_ID, splitSettings } from './store';

/**
 * Changing the settings of an installed platform, from the settings page.
 *
 * One change at a time, one section each. A change is validated here (the page's own checks are only a courtesy),
 * applied to the stored row inside ONE transaction together with its audit entry and, for the owners, the
 * accounts it concerns, and then loaded into the running process: it takes effect at once, with no restart.
 * The row is read again inside the transaction and written only if nobody changed it meanwhile (two owners
 * saving two sections at the same moment lose nothing).
 *
 * The audit entries never hold a secret: for a secret, only "it changed".
 */

/** A category as the settings page sends it: a new one has no `key` (the server makes it from the name). */
export interface CategoryInput {
  key?: string;
  label: string;
  color: string;
}

export type SettingsChange =
  /** `contactEmail`: left out keeps the saved one, blank removes it. */
  | {
      section: 'identity';
      name: string;
      accentColor: string;
      messageLocale: string;
      contactEmail?: string;
    }
  /** `logoPath`: the default logo, or the address of an uploaded one (already stored, see `branding/storage`). */
  | { section: 'logo'; logoPath: string }
  /**
   * The categories of the events module and the hour of the reminder. A category taken out while events still
   * use it needs `reassign[key]`: the category those events move to (they are never left without one).
   */
  | {
      section: 'events';
      categories: CategoryInput[];
      reminderHour: number;
      reassign?: Record<string, string>;
    }
  | { section: 'address'; address: string; acceptInsecure?: boolean }
  /** `clientSecret` blank keeps the saved one. */
  | { section: 'oauth'; clientId: string; clientSecret: string }
  | { section: 'campuses'; campuses: string[]; mainCampus: string; timezone: string }
  | { section: 'owner-add'; login: string }
  | { section: 'owner-remove'; login: string }
  | { section: 'modules'; events: boolean }
  | { section: 'notifications'; notifications: unknown };

export interface SettingsActor {
  login: string;
  id?: string | null;
}

export type SettingsResult =
  { ok: true; changed: boolean } | { ok: false; code: string; field?: string; detail?: string };

const fail = (code: string, extra: { field?: string; detail?: string } = {}) =>
  ({ ok: false, code, ...extra }) as const;

type Failure = ReturnType<typeof fail>;

interface State {
  config: BdeConfig;
  values: SettingValues;
}

interface Applied {
  config: BdeConfig;
  values: SettingValues;
  audit: { action: string; targetLabel?: string; metadata: Record<string, unknown> };
  /** Categories taken out by this change: the events that use them move to another one, in the same transaction. */
  removedCategories?: Array<{ key: string; label: string; target?: string }>;
}

const MAX_OWNERS = 30;
const MAX_CATEGORIES = 30;

/** `Soirée de rentrée` → `soiree-de-rentree`: the stable identifier of a new category. */
export function categoryKeyFor(label: string, taken: ReadonlySet<string>): string {
  const base =
    label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30)
      .replace(/-+$/g, '') || 'categorie';
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
  return key;
}
const normalize = (login: string): string => login.trim().toLowerCase();

/** The notification settings as the row holds them (the channel itself is in the configuration). */
export function savedNotifications(values: SettingValues): NotificationSettings {
  const smtp =
    values.SMTP_HOST && values.SMTP_PORT && values.SMTP_FROM
      ? {
          host: values.SMTP_HOST,
          port: Number(values.SMTP_PORT),
          user: values.SMTP_USER ?? '',
          password: values.SMTP_PASSWORD ?? '',
          from: values.SMTP_FROM,
        }
      : undefined;
  return {
    mode: 'none',
    ...(values.DISCORD_WEBHOOK_URL && { discordWebhook: values.DISCORD_WEBHOOK_URL }),
    ...(values.SLACK_WEBHOOK_URL && { slackWebhook: values.SLACK_WEBHOOK_URL }),
    ...(smtp && { smtp }),
  };
}

/** The channel the configuration sends its notifications through. */
export function channelOf(config: BdeConfig): Channel {
  const n = config.notifications;
  return (
    [n.eventConfirmed, n.memberPending, n.memberApproved, n.eventReminder].find(
      (channel) => channel !== 'none',
    ) ?? 'none'
  );
}

function apply(change: SettingsChange, state: State, actor: SettingsActor): Applied | Failure {
  const { config } = state;
  const values: SettingValues = { ...state.values };

  switch (change.section) {
    case 'identity': {
      const name = validate.validateName(change.name);
      if (!name.ok) return fail(name.error, { field: 'name' });
      const color = validate.validateColor(change.accentColor);
      if (!color.ok) return fail(color.error, { field: 'accentColor' });
      if (change.messageLocale !== 'fr' && change.messageLocale !== 'en') return fail('invalid');
      const locale: 'fr' | 'en' = change.messageLocale === 'en' ? 'en' : 'fr';

      let contactEmail = config.bde.contactEmail;
      if (change.contactEmail !== undefined) {
        if (change.contactEmail.trim() === '') {
          contactEmail = undefined;
        } else {
          const email = validate.validateEmail(change.contactEmail);
          if (!email.ok) return fail(email.error, { field: 'contactEmail' });
          contactEmail = email.value;
        }
      }

      const bde = {
        ...config.bde,
        name: name.value,
        accentColor: color.value,
        defaultLocale: locale,
      };
      if (contactEmail) bde.contactEmail = contactEmail;
      else delete bde.contactEmail;
      return {
        config: { ...config, bde },
        values,
        audit: {
          action: 'settings.identity.update',
          metadata: {
            name: { from: config.bde.name, to: name.value },
            accentColor: { from: config.bde.accentColor, to: color.value },
            messageLocale: { from: config.bde.defaultLocale, to: locale },
            contactEmail: { from: config.bde.contactEmail ?? null, to: contactEmail ?? null },
          },
        },
      };
    }

    case 'logo': {
      const uploaded = logoVersionOf(change.logoPath) !== null;
      if (!uploaded && change.logoPath !== DEFAULT_LOGO_PATH) return fail('invalid');
      return {
        config: { ...config, bde: { ...config.bde, logoPath: change.logoPath } },
        values,
        audit: {
          action: 'settings.logo.update',
          metadata: {
            from: logoVersionOf(config.bde.logoPath) ? 'uploaded' : 'default',
            to: uploaded ? 'uploaded' : 'default',
          },
        },
      };
    }

    case 'events': {
      if (!config.events || !config.modules.enabled.includes(EVENTS_MODULE_KEY)) {
        return fail('invalid');
      }
      const hour = change.reminderHour;
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
        return fail('reminderHour', { field: 'reminderHour' });
      }
      if (!Array.isArray(change.categories) || change.categories.length === 0) {
        return fail('categoryLast', { field: 'categories' });
      }
      if (change.categories.length > MAX_CATEGORIES) {
        return fail('tooManyCategories', { field: 'categories' });
      }

      const before = config.events.categories;
      const known = new Map(before.map((category) => [category.key, category]));
      const taken = new Set(known.keys());
      const seen = new Set<string>();
      const labels = new Set<string>();
      const categories: NonNullable<BdeConfig['events']>['categories'] = [];

      for (const input of change.categories) {
        const label = validate.validateCategoryLabel(input.label);
        if (!label.ok) return fail(label.error, { field: 'categories' });
        const color = validate.validateColor(input.color);
        if (!color.ok) return fail('color', { field: 'categories' });
        const folded = label.value.toLocaleLowerCase();
        if (labels.has(folded)) return fail('categoryDuplicate', { field: 'categories' });
        labels.add(folded);

        let key = input.key;
        if (key !== undefined) {
          // An existing category keeps its key for ever (the events refer to it): only a known one may come back.
          if (!known.has(key) || seen.has(key)) return fail('invalid');
        } else {
          key = categoryKeyFor(label.value, taken);
          taken.add(key);
        }
        seen.add(key);
        categories.push({ key, label: label.value, color: color.value });
      }

      const removed = before
        .filter((category) => !seen.has(category.key))
        .map(({ key, label }) => ({ key, label, target: change.reassign?.[key] }));
      for (const gone of removed) {
        if (gone.target !== undefined && !categories.some((c) => c.key === gone.target)) {
          return fail('invalid');
        }
      }

      const renamed = categories
        .filter((c) => known.has(c.key) && known.get(c.key)?.label !== c.label)
        .map((c) => ({ from: known.get(c.key)?.label, to: c.label }));
      const recolored = categories
        .filter((c) => known.has(c.key) && known.get(c.key)?.color !== c.color)
        .map((c) => c.label);

      return {
        config: { ...config, events: { ...config.events, categories, reminderHour: hour } },
        values,
        removedCategories: removed,
        audit: {
          action: 'settings.events.update',
          metadata: {
            added: categories.filter((c) => !known.has(c.key)).map((c) => c.label),
            renamed,
            recolored,
            reminderHour: { from: config.events.reminderHour, to: hour },
          },
        },
      };
    }

    case 'address': {
      const address = validate.validateAddress(change.address);
      if (!address.ok) return fail(address.error, { field: 'address' });
      if (address.value.insecureDomain && !change.acceptInsecure) {
        return fail('insecure', { field: 'address' });
      }
      return {
        config,
        values: { ...values, APP_URL: address.value.url },
        audit: {
          action: 'settings.address.update',
          metadata: { from: values.APP_URL ?? null, to: address.value.url },
        },
      };
    }

    case 'oauth': {
      const id = validate.validateClientId(change.clientId);
      if (!id.ok) return fail(id.error, { field: 'clientId' });
      const typed = change.clientSecret.trim();
      const saved = values.FORTYTWO_CLIENT_SECRET;
      const secret =
        typed === '' && saved
          ? { ok: true as const, value: saved }
          : validate.validateClientSecret(typed);
      if (!secret.ok) return fail(secret.error, { field: 'clientSecret' });
      return {
        config,
        values: {
          ...values,
          FORTYTWO_CLIENT_ID: id.value,
          FORTYTWO_CLIENT_SECRET: secret.value,
        },
        audit: {
          action: 'settings.oauth.update',
          metadata: {
            clientIdChanged: id.value !== values.FORTYTWO_CLIENT_ID,
            secretChanged: secret.value !== saved,
          },
        },
      };
    }

    case 'campuses': {
      const campuses: string[] = [];
      for (const raw of change.campuses) {
        const campus = validate.validateCampusName(raw);
        if (!campus.ok) return fail(campus.error, { field: 'campuses' });
        if (!campuses.includes(campus.value)) campuses.push(campus.value);
      }
      const main = validate.validateCampusName(change.mainCampus);
      if (!main.ok) return fail('campus', { field: 'mainCampus' });
      // The BDE's own campus must be allowed: a list that left it out would lock the BDE out.
      if (campuses.length > 0 && !campuses.includes(main.value)) {
        return fail('campusNotListed', { field: 'mainCampus' });
      }
      const zone = validate.validateTimezone(change.timezone);
      if (!zone.ok) return fail(zone.error, { field: 'timezone' });
      return {
        config: {
          ...config,
          bde: { ...config.bde, campus: main.value, timezone: zone.value },
          auth: { ...config.auth, allowedCampuses: campuses },
        },
        values,
        audit: {
          action: 'settings.campuses.update',
          metadata: {
            allowedCampuses: { from: config.auth.allowedCampuses, to: campuses },
            mainCampus: { from: config.bde.campus, to: main.value },
            timezone: { from: config.bde.timezone, to: zone.value },
          },
        },
      };
    }

    case 'owner-add': {
      const login = validate.validateLogin(change.login);
      if (!login.ok) return fail(login.error, { field: 'login' });
      if (config.auth.owners.some((owner) => normalize(owner) === login.value)) {
        return fail('ownerExists', { field: 'login' });
      }
      if (config.auth.owners.length >= MAX_OWNERS) return fail('tooManyOwners', { field: 'login' });
      return {
        config: {
          ...config,
          auth: { ...config.auth, owners: [...config.auth.owners, login.value] },
        },
        values,
        audit: {
          action: 'settings.owner.add',
          targetLabel: login.value,
          metadata: { owners: config.auth.owners.length + 1 },
        },
      };
    }

    case 'owner-remove': {
      const login = validate.validateLogin(change.login);
      if (!login.ok) return fail(login.error, { field: 'login' });
      if (!config.auth.owners.some((owner) => normalize(owner) === login.value)) {
        return fail('ownerNotFound', { field: 'login' });
      }
      // Never oneself: there is then always an owner left, and nobody locks themselves out by a slip.
      if (login.value === normalize(actor.login)) return fail('ownerSelf', { field: 'login' });
      const owners = config.auth.owners.filter((owner) => normalize(owner) !== login.value);
      if (owners.length === 0) return fail('noOwner', { field: 'login' });
      return {
        config: { ...config, auth: { ...config.auth, owners } },
        values,
        audit: {
          action: 'settings.owner.remove',
          targetLabel: login.value,
          metadata: { owners: owners.length },
        },
      };
    }

    case 'modules': {
      if (typeof change.events !== 'boolean') return fail('invalid');
      const others = config.modules.enabled.filter((key) => key !== EVENTS_MODULE_KEY);
      return {
        config: {
          ...config,
          modules: { enabled: change.events ? [...others, EVENTS_MODULE_KEY] : others },
          // Turned on for the first time: the categories a BDE starts with. Turned off, the section is kept.
          events:
            config.events ??
            (change.events ? { categories: DEFAULT_CATEGORIES, reminderHour: 18 } : undefined),
        },
        values,
        audit: {
          action: 'settings.modules.update',
          metadata: {
            events: {
              from: config.modules.enabled.includes(EVENTS_MODULE_KEY),
              to: change.events,
            },
          },
        },
      };
    }

    case 'notifications': {
      const parsed = parseNotifications(change.notifications, savedNotifications(values));
      if (!parsed.ok) return fail(parsed.code, parsed.field ? { field: parsed.field } : {});
      const { mode, discordWebhook, slackWebhook, smtp } = parsed.value;

      // The settings of a channel that is not chosen are kept: switching back finds them again.
      const next: SettingValues = { ...values };
      if (discordWebhook) next.DISCORD_WEBHOOK_URL = discordWebhook;
      if (slackWebhook) next.SLACK_WEBHOOK_URL = slackWebhook;
      if (smtp) {
        next.SMTP_HOST = smtp.host;
        next.SMTP_PORT = String(smtp.port);
        next.SMTP_FROM = smtp.from;
        if (smtp.user) next.SMTP_USER = smtp.user;
        else delete next.SMTP_USER;
        if (smtp.password) next.SMTP_PASSWORD = smtp.password;
        else delete next.SMTP_PASSWORD;
      }

      const changedSecrets = (
        ['DISCORD_WEBHOOK_URL', 'SLACK_WEBHOOK_URL', 'SMTP_PASSWORD'] as const
      ).filter((key) => next[key] !== values[key]);
      return {
        config: { ...config, notifications: notificationChannels(mode) },
        values: next,
        audit: {
          action: 'settings.notifications.update',
          metadata: {
            channel: { from: channelOf(config), to: mode },
            // which secret changed, never what it is
            changedSecrets,
          },
        },
      };
    }
  }
}

const canonical = (state: State): string =>
  JSON.stringify([
    state.config,
    Object.fromEntries(Object.entries(state.values).sort(([a], [b]) => a.localeCompare(b))),
  ]);

type SettingsDb = Pick<PrismaClient, '$transaction'>;

/**
 * Applies one change. Returns `{ ok: true, changed }` (`changed: false` when the values were already these,
 * nothing is written then), or a code of what is wrong, which the page translates.
 */
export async function updateSettings(
  change: SettingsChange,
  actor: SettingsActor,
  db: SettingsDb = prisma,
): Promise<SettingsResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const outcome = await db.$transaction(async (tx) => {
      const row = await tx.platformSettings.findUnique({ where: { id: PLATFORM_ID } });
      if (!row) return fail('notInstalled');

      const parsed = bdeConfigSchema.safeParse(row.config);
      if (!parsed.success) return fail('storedInvalid');
      let secrets: Record<string, string> = {};
      if (row.secrets) {
        try {
          secrets = unseal(row.secrets, settingsKey());
        } catch (error) {
          if (error instanceof SettingsDecryptError) return fail('secretsUnreadable');
          throw error;
        }
      }
      const environment = row.environment as Record<string, string>;
      const current: State = {
        config: parsed.data,
        values: Object.fromEntries(
          Object.entries({ ...environment, ...secrets }).filter(([key]) =>
            (SETTING_KEYS as readonly string[]).includes(key),
          ),
        ) as SettingValues,
      };

      const applied = apply(change, current, actor);
      if ('ok' in applied) return applied;

      // The whole result must still make a platform that starts: the schema, and the rules of .env.
      const next = bdeConfigSchema.safeParse(applied.config);
      if (!next.success) return fail('invalid', { detail: next.error.issues[0]?.path.join('.') });
      const base = { ...process.env } as Record<string, string | undefined>;
      for (const key of SETTING_KEYS) delete base[key];
      const checked = validateEnvironment({ ...base, ...applied.values }, next.data);
      if (checked.errors.length > 0)
        return fail('invalid', { detail: checked.variables.join(', ') });

      const after: State = { config: next.data, values: applied.values };
      if (canonical(after) === canonical(current)) return { ok: true, changed: false } as const;

      // A category taken out while events still use it: they must have been given another one (never left without).
      const moves: Array<{ key: string; label: string; to: string; events: number }> = [];
      for (const gone of applied.removedCategories ?? []) {
        const events = await tx.event.count({ where: { categoryKey: gone.key } });
        if (events === 0) continue;
        if (!gone.target) return fail('categoryInUse', { field: 'categories', detail: gone.label });
        moves.push({ key: gone.key, label: gone.label, to: gone.target, events });
      }

      const split = splitSettings(after.values);
      const written = await tx.platformSettings.updateMany({
        where: { id: PLATFORM_ID, updatedAt: row.updatedAt },
        data: {
          config: JSON.parse(JSON.stringify(after.config)),
          environment: split.environment,
          secrets:
            Object.keys(split.secrets).length > 0 ? seal(split.secrets, settingsKey()) : null,
        },
      });
      if (written.count === 0) return 'retry' as const; // somebody saved something else first

      let metadata: Record<string, unknown> = applied.audit.metadata;
      if (change.section === 'events') {
        for (const move of moves) {
          await tx.event.updateMany({
            where: { categoryKey: move.key },
            data: { categoryKey: move.to },
          });
        }
        const labelOf = (key: string) =>
          after.config.events?.categories.find((category) => category.key === key)?.label ?? key;
        metadata = {
          ...metadata,
          removed: (applied.removedCategories ?? []).map((gone) => {
            const move = moves.find((m) => m.key === gone.key);
            return {
              label: gone.label,
              events: move?.events ?? 0,
              ...(move && { movedTo: labelOf(move.to) }),
            };
          }),
        };
      }
      if (change.section === 'owner-add' || change.section === 'owner-remove') {
        const accounts = await syncOwnerAccounts(tx, after.config.auth.owners);
        metadata = { ...metadata, promoted: accounts.promoted, demoted: accounts.demoted };
      }
      await logAuditEvent(
        {
          actorLogin: actor.login,
          actorId: actor.id ?? null,
          action: applied.audit.action,
          targetType: 'Settings',
          targetLabel: applied.audit.targetLabel ?? null,
          metadata: metadata as never,
        },
        tx,
      );
      return { ok: true, changed: true, after } as const;
    });

    if (outcome === 'retry') continue;
    if (outcome.ok && outcome.changed && 'after' in outcome) {
      setRuntimeSettings({
        config: outcome.after.config,
        values: outcome.after.values,
        source: 'database',
        secretsStatus: 'ok',
      });
    }
    return outcome.ok ? { ok: true, changed: outcome.changed } : outcome;
  }
  return fail('conflict');
}

export type { SettingKey };
