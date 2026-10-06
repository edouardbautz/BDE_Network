import type { Lang } from './messages';
import type { Address } from './validate';

export type Channel = 'discord' | 'slack' | 'email' | 'none';

export interface SmtpAnswers {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

export interface NotificationAnswers {
  /** `keep`: the notification settings already in bde.config.yml are left as they are. */
  mode: Channel | 'keep';
  discordWebhook?: string;
  slackWebhook?: string;
  smtp?: SmtpAnswers;
}

/** Everything the person decided, collected in memory: nothing is written until the very end. */
export interface Answers {
  /** The language of the assistant itself. */
  lang: Lang;
  name: string;
  accentColor: string;
  /** The language of the messages the platform sends (`bde.defaultLocale`). */
  messageLocale: Lang;
  timezone: string;
  address: Address;
  clientId: string;
  clientSecret: string;
  /** Names of the allowed campuses; empty means every campus. */
  campuses: string[];
  mainCampus: string;
  owners: string[];
  events: boolean;
  notifications: NotificationAnswers;
  authSecret: string;
  postgresPassword: string;
}
