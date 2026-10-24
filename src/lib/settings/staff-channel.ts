import type { SettingValues } from './runtime';
import { validateDiscordWebhook, validateSlackWebhook } from '@/lib/setup/validate';

/**
 * The room of the school's staff: a Discord and/or a Slack webhook of its own, because the staff is not necessarily on the
 * BDE's server. What the platform posts for the staff goes there when it is set, otherwise to the BDE's own room. Two secrets of
 * the settings (`DISCORD_STAFF_WEBHOOK_URL`, `SLACK_STAFF_WEBHOOK_URL`), kept like the BDE's: sealed, never sent back to the page.
 */

export interface StaffChannelInput {
  /** Blank keeps the saved address (the page never gets one back). */
  discordWebhook: string;
  slackWebhook: string;
  /** Forget the saved address (and ignore what was typed for it). */
  removeDiscord?: boolean;
  removeSlack?: boolean;
}

export type StaffChannelResult =
  | { ok: true; values: SettingValues; changedSecrets: string[] }
  | { ok: false; code: 'discord' | 'slack'; field: 'discordWebhook' | 'slackWebhook' };

const KEYS = {
  discord: 'DISCORD_STAFF_WEBHOOK_URL',
  slack: 'SLACK_STAFF_WEBHOOK_URL',
} as const;

/** What the staff room holds after this change, from what is saved and what was typed. */
export function applyStaffChannel(
  values: SettingValues,
  input: StaffChannelInput,
): StaffChannelResult {
  const next: SettingValues = { ...values };

  for (const [channel, typed, remove, validate] of [
    ['discord', input.discordWebhook, input.removeDiscord, validateDiscordWebhook],
    ['slack', input.slackWebhook, input.removeSlack, validateSlackWebhook],
  ] as const) {
    const key = KEYS[channel];
    const address = typed.trim();
    if (remove) {
      delete next[key];
    } else if (address !== '') {
      const checked = validate(address);
      if (!checked.ok) {
        return {
          ok: false,
          code: channel,
          field: channel === 'discord' ? 'discordWebhook' : 'slackWebhook',
        };
      }
      next[key] = checked.value;
    }
  }

  const changedSecrets = Object.values(KEYS).filter((key) => next[key] !== values[key]);
  return { ok: true, values: next, changedSecrets };
}
