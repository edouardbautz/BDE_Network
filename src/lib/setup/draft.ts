import type { Address } from './validate';
import type { Campus } from './fortytwo';
import type { SmtpSettings } from './notify-test';

export type Channel = 'none' | 'discord' | 'slack' | 'email';
export type Language = 'fr' | 'en';

/** What the person has answered so far. Kept in the server's memory, per installer session: never sent back
 * to the browser as it is (see `toView`), never written anywhere before the very end. */
export interface SetupDraft {
  /** The step the person may be on: every earlier one is done. */
  step: number;
  name?: string;
  accentColor?: string;
  messageLocale?: Language;
  address?: Address;
  clientId?: string;
  clientSecret?: string;
  /** 42 accepted the identifier and the secret. */
  credentialsVerified?: boolean;
  /** 42 could not be asked (no network): the person went on without the check. */
  credentialsSkipped?: boolean;
  /** The application's own token, to ask the campuses and check the logins. Server side only. */
  fortyTwoToken?: string;
  campusList?: Campus[] | null;
  /** Empty: every campus. */
  campuses?: string[];
  mainCampus?: string;
  timezone?: string;
  owners?: string[];
  events?: boolean;
  notifications?: {
    mode: Channel;
    discordWebhook?: string;
    slackWebhook?: string;
    smtp?: SmtpSettings;
  };
}

export const STEP_COUNT = 8;

const SLOT = Symbol.for('bde-network.setup-drafts');
type Holder = typeof globalThis & { [SLOT]?: Map<string, SetupDraft> };

function drafts(): Map<string, SetupDraft> {
  const holder = globalThis as Holder;
  holder[SLOT] ??= new Map();
  return holder[SLOT];
}

export function draftFor(sessionKey: string): SetupDraft {
  const store = drafts();
  let draft = store.get(sessionKey);
  if (!draft) {
    draft = { step: 0 };
    store.set(sessionKey, draft);
  }
  return draft;
}

export function forgetDrafts(): void {
  drafts().clear();
}

/** The part of the draft the browser may see: no secret, only whether there is one. */
export interface DraftView {
  step: number;
  name: string;
  accentColor: string;
  messageLocale: Language;
  addressUrl: string;
  clientId: string;
  hasClientSecret: boolean;
  credentialsVerified: boolean;
  credentialsSkipped: boolean;
  campuses: string[];
  mainCampus: string;
  timezone: string;
  owners: string[];
  events: boolean;
  notifications: {
    mode: Channel;
    hasDiscordWebhook: boolean;
    hasSlackWebhook: boolean;
    smtp: { host: string; port: string; user: string; from: string; hasPassword: boolean };
  };
}

export const DEFAULT_ACCENT = '#0f766e';

export function toView(draft: SetupDraft, defaults: { addressUrl: string }): DraftView {
  const notifications = draft.notifications;
  return {
    step: draft.step,
    name: draft.name ?? '',
    accentColor: draft.accentColor ?? DEFAULT_ACCENT,
    messageLocale: draft.messageLocale ?? 'fr',
    addressUrl: draft.address?.url ?? defaults.addressUrl,
    clientId: draft.clientId ?? '',
    hasClientSecret: Boolean(draft.clientSecret),
    credentialsVerified: Boolean(draft.credentialsVerified),
    credentialsSkipped: Boolean(draft.credentialsSkipped),
    campuses: draft.campuses ?? [],
    mainCampus: draft.mainCampus ?? '',
    timezone: draft.timezone ?? '',
    owners: draft.owners ?? [],
    events: draft.events ?? true,
    notifications: {
      mode: notifications?.mode ?? 'none',
      hasDiscordWebhook: Boolean(notifications?.discordWebhook),
      hasSlackWebhook: Boolean(notifications?.slackWebhook),
      smtp: {
        host: notifications?.smtp?.host ?? '',
        port: notifications?.smtp ? String(notifications.smtp.port) : '587',
        user: notifications?.smtp?.user ?? '',
        from: notifications?.smtp?.from ?? '',
        hasPassword: Boolean(notifications?.smtp?.password),
      },
    },
  };
}
