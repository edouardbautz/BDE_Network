import '../lib/zod-config';
import { z } from 'zod';
import { SUPPORTED_LOCALES } from './locales';

// The list lives in locales.ts, which client code imports without Zod; it is still exported from here for the code that reads the configuration.
export { SUPPORTED_LOCALES, type SupportedLocale } from './locales';

/** The channels a notification can go through, in the order the tables and the files write them. */
export const NOTIFICATION_CHANNELS = ['discord', 'slack', 'email'] as const;

/**
 * The notifications about the publication of the events on the intra (only while `events.intraPublication` is on): the first three tell
 * the school's staff, the last two tell the author of the event and the BDE's room.
 */
export const INTRA_NOTIFICATION_EVENTS = [
  'intraRequested',
  'intraChanged',
  'intraCancelled',
  'intraPublished',
  'intraRefused',
] as const;

/**
 * Notification events wired at this stage of the project. Business modules
 * (events, finances, meetings...) will add their own keys here as they land.
 */
export const NOTIFICATION_EVENTS = [
  'memberPending',
  'memberApproved',
  'memberRemoved',
  'eventConfirmed',
  'eventReminder',
  'eventProposed',
  'eventApproved',
  'eventRefused',
  ...INTRA_NOTIFICATION_EVENTS,
] as const;

/** Module keys that ship with the platform. `modules.enabled` is free-form on
 * purpose (forks may add their own), but the built-in ones are referenced by
 * key from the config validation below. */
export const EVENTS_MODULE_KEY = 'events';

/** The modules this version ships. A fork that adds its own module adds its key here, which is
 * what keeps a typo in `modules.enabled` from passing unnoticed (see config/env.ts). */
export const KNOWN_MODULE_KEYS: readonly string[] = [EVENTS_MODULE_KEY];

/**
 * The accent of a platform nobody has chosen one for: the installer proposes it, the example configuration writes it. A platform
 * that already has a colour keeps it (the configuration and the settings always carry one).
 */
export const DEFAULT_ACCENT = '#2F5BEA';

const hexColor = z
  .string({ error: "la couleur d'accent doit être une chaîne de caractères" })
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
    message: 'doit être une couleur hexadécimale valide, par exemple "#2F5BEA"',
  });

const loginSlug = z
  .string()
  .trim()
  .min(1, { message: 'ne peut pas être vide' })
  .regex(/^[a-z0-9-]+$/i, {
    message: 'doit être un login 42 valide (lettres, chiffres, tirets)',
  });

const bdeSection = z.object({
  name: z.string().trim().min(1, { message: 'le nom du BDE ne peut pas être vide' }),
  campus: z.string().trim().min(1, { message: 'le campus ne peut pas être vide' }),
  timezone: z.string().refine(
    (value) => {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: value });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'doit être un fuseau horaire IANA valide, par exemple "Europe/Paris"' },
  ),
  defaultLocale: z.enum(SUPPORTED_LOCALES, {
    error: () => `la langue par défaut doit être l'une de : ${SUPPORTED_LOCALES.join(', ')}`,
  }),
  accentColor: hexColor.default(DEFAULT_ACCENT),
  // Where members write about their data (privacy page). Optional: without it the page sends them
  // to an administrator or owner.
  contactEmail: z.email({ message: 'doit être une adresse e-mail valide' }).optional(),
  logoPath: z
    .string()
    .trim()
    .min(1, { message: 'le chemin du logo ne peut pas être vide' })
    .refine((value) => value.startsWith('/'), {
      message: 'doit être un chemin absolu depuis /public, par exemple "/logo.svg"',
    }),
});

const authSection = z.object({
  owners: z
    .array(loginSlug)
    .min(1, { message: 'la liste "owners" doit contenir au moins un login 42' }),
  // Une liste vide signifie "aucun filtre" : tous les campus sont autorisés.
  // Voir bde.config.example.yml et docs/configuration.md.
  allowedCampuses: z.array(z.string().trim().min(1)),
});

const modulesSection = z.object({
  enabled: z.array(z.string().trim().min(1)).default([]),
});

/**
 * What a notification is sent through is a LIST of channels (none, one, or several at once). Before 1.5.0 it was one channel,
 * "none" meant nothing: those values are read as they were meant (`'discord'` is `['discord']`, `'none'` is `[]`, a key left
 * out is `[]`), so a `bde.config.yml` and the settings already stored keep their meaning without being edited. A list is
 * written once, in the order of `NOTIFICATION_CHANNELS`, each channel at most once.
 */
function readChannels(value: unknown): unknown {
  if (value === undefined || value === null || value === 'none') return [];
  if (typeof value === 'string') return [value];
  return value;
}

const readNotifications = (value: unknown): unknown => {
  const given =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return Object.fromEntries(
    NOTIFICATION_EVENTS.map((event) => [event, readChannels(given[event])]),
  );
};

const notificationChannels = (event: (typeof NOTIFICATION_EVENTS)[number]) =>
  z
    .array(
      z.enum(NOTIFICATION_CHANNELS, {
        error: () =>
          `les canaux choisis pour "${event}" doivent être parmi : ${NOTIFICATION_CHANNELS.join(', ')} (ou "none" pour aucun)`,
      }),
      {
        error: () =>
          `les canaux choisis pour "${event}" doivent être une liste (ou "none" pour aucun)`,
      },
    )
    .transform((channels) => NOTIFICATION_CHANNELS.filter((channel) => channels.includes(channel)));

// Every notification defaults to nothing: a BDE that has not set up e-mail, Discord or Slack
// (most, at first) writes nothing, and an older bde.config.yml keeps validating without edits.
const notificationsSection = z.preprocess(
  readNotifications,
  z.object({
    memberPending: notificationChannels('memberPending'),
    memberApproved: notificationChannels('memberApproved'),
    memberRemoved: notificationChannels('memberRemoved'),
    eventConfirmed: notificationChannels('eventConfirmed'),
    eventReminder: notificationChannels('eventReminder'),
    eventProposed: notificationChannels('eventProposed'),
    eventApproved: notificationChannels('eventApproved'),
    eventRefused: notificationChannels('eventRefused'),
    intraRequested: notificationChannels('intraRequested'),
    intraChanged: notificationChannels('intraChanged'),
    intraCancelled: notificationChannels('intraCancelled'),
    intraPublished: notificationChannels('intraPublished'),
    intraRefused: notificationChannels('intraRefused'),
  }),
);

const updatesSection = z.object({
  // Whether the owners are told when a newer version of the platform is published (a request to GitHub that
  // carries nothing of the BDE: see docs/en/configuration.md). On by default; absent means on.
  check: z.boolean().default(true),
});

const categoryKey = z
  .string()
  .trim()
  .min(1, { message: 'ne peut pas être vide' })
  .regex(/^[a-z0-9-]+$/, {
    message: 'doit contenir uniquement des minuscules, chiffres et tirets (ex. "soiree")',
  });

const eventCategory = z.object({
  key: categoryKey,
  label: z.string().trim().min(1, { message: 'le libellé de la catégorie ne peut pas être vide' }),
  color: hexColor,
});

const eventsSection = z.object({
  categories: z
    .array(eventCategory)
    .min(1, { message: "définissez au moins une catégorie d'événement" })
    .refine((categories) => new Set(categories.map((c) => c.key)).size === categories.length, {
      message: 'chaque catégorie doit avoir une clé (key) unique',
    }),
  // Heure locale (fuseau de bde.timezone) à laquelle part le rappel de la veille.
  reminderHour: z
    .number({ error: "l'heure du rappel doit être un nombre entier entre 0 et 23" })
    .int()
    .min(0)
    .max(23)
    .default(18),
  // The platform publishes the events on the intra 42 through the school's staff: every event then carries the fields of
  // the intra's form, and confirming one asks the staff to publish it. Off unless the BDE turns it on.
  intraPublication: z.boolean().default(false),
});

export const bdeConfigSchema = z
  .object({
    bde: bdeSection,
    auth: authSection,
    modules: modulesSection,
    events: eventsSection.optional(),
    // The whole section is optional too: absent means every notification is off.
    notifications: notificationsSection,
    updates: updatesSection.prefault({}),
  })
  .superRefine((config, ctx) => {
    if (config.modules.enabled.includes(EVENTS_MODULE_KEY) && !config.events) {
      ctx.addIssue({
        code: 'custom',
        path: ['events'],
        message: 'ce champ est requis quand le module "events" est activé (voir categories)',
      });
    }
  });

export type BdeConfig = z.infer<typeof bdeConfigSchema>;
export type EventCategory = z.infer<typeof eventCategory>;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/**
 * The channels a notification really goes through: what the configuration lists, except that the e-mail of `memberRemoved` is
 * never sent (the person removed is not written to; an older configuration could list it, and it stayed without effect).
 */
export function channelsFor(
  config: Pick<BdeConfig, 'notifications'>,
  event: NotificationEvent,
): NotificationChannel[] {
  return config.notifications[event].filter(
    (channel) => !(event === 'memberRemoved' && channel === 'email'),
  );
}
