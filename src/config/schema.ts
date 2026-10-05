import { z } from 'zod';

export const SUPPORTED_LOCALES = ['fr', 'en'] as const;

export const NOTIFICATION_CHANNELS = ['email', 'discord', 'slack', 'none'] as const;

/**
 * Notification events wired at this stage of the project. Business modules
 * (events, finances, meetings...) will add their own keys here as they land.
 */
export const NOTIFICATION_EVENTS = ['memberPending', 'memberApproved', 'memberRemoved'] as const;

const hexColor = z
  .string({ error: "la couleur d'accent doit être une chaîne de caractères" })
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
    message: 'doit être une couleur hexadécimale valide, par exemple "#0f766e"',
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
  accentColor: hexColor,
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

const notificationChannel = (event: (typeof NOTIFICATION_EVENTS)[number]) =>
  z.enum(NOTIFICATION_CHANNELS, {
    error: () =>
      `le canal choisi pour "${event}" doit être l'un de : ${NOTIFICATION_CHANNELS.join(', ')}`,
  });

const notificationsSection = z.object({
  memberPending: notificationChannel('memberPending'),
  memberApproved: notificationChannel('memberApproved'),
  memberRemoved: notificationChannel('memberRemoved'),
});

export const bdeConfigSchema = z.object({
  bde: bdeSection,
  auth: authSection,
  modules: modulesSection,
  notifications: notificationsSection,
});

export type BdeConfig = z.infer<typeof bdeConfigSchema>;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
