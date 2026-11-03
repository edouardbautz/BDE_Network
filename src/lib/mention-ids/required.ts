import { getConfig } from '@/config';
import { EVENTS_INTRA_PUBLISH } from '@/lib/events/access';
import { intraPublicationEnabled } from '@/lib/events/intra-config';
import { can, type PermissionHolder } from '@/lib/permissions';
import { setting } from '@/lib/settings/runtime';

/**
 * Which Discord and Slack identifiers a person MUST give (docs/architecture.md, "The identifiers asked of everybody").
 *
 * The platform mentions people in what it posts (their proposal validated, the messages for the school's staff): it needs their id on each
 * platform the BDE posts on. So, for each platform:
 * - **the BDE's own webhook is saved** (Discord, Slack): everybody gives that id, whoever they are;
 * - **the staff's room has a webhook of its own** (publication on the intra on, Discord or Slack): the people who hold the right to publish on the intra
 *   give that id too, so that `{@staff}` can ping them.
 * A platform nobody posts on is not asked, and when none is configured nothing is asked at all.
 */

export type MentionPlatform = 'discord' | 'slack';
export const MENTION_PLATFORMS: readonly MentionPlatform[] = ['discord', 'slack'];

/** Where the BDE posts, as the settings say it. */
export interface PostingFacts {
  /** The BDE's own webhook is saved. */
  main: Record<MentionPlatform, boolean>;
  /** The staff's room has a webhook of its own, and the platform publishes on the intra (the section only exists then). */
  staff: Record<MentionPlatform, boolean>;
}

/** Read from the settings of the moment (they change without a restart). */
export function postingFacts(): PostingFacts {
  const staffRoom = getConfig().modules.enabled.includes('events') && intraPublicationEnabled();
  return {
    main: { discord: !!setting('DISCORD_WEBHOOK_URL'), slack: !!setting('SLACK_WEBHOOK_URL') },
    staff: {
      discord: staffRoom && !!setting('DISCORD_STAFF_WEBHOOK_URL'),
      slack: staffRoom && !!setting('SLACK_STAFF_WEBHOOK_URL'),
    },
  };
}

/** The platforms this person must give an id for. Pure: the facts and whether they hold the right to publish on the intra. */
export function requiredPlatforms(
  facts: PostingFacts,
  holdsIntraRight: boolean,
): MentionPlatform[] {
  return MENTION_PLATFORMS.filter(
    (platform) => facts.main[platform] || (holdsIntraRight && facts.staff[platform]),
  );
}

export interface HeldIds {
  discordUserId: string | null;
  slackUserId: string | null;
}

/** What is still to give: the required platforms with no id. */
export function missingPlatforms(
  required: readonly MentionPlatform[],
  held: HeldIds,
): MentionPlatform[] {
  return required.filter((platform) =>
    platform === 'discord' ? !held.discordUserId : !held.slackUserId,
  );
}

/** The platforms asked of an account, from its real access (not the downgraded one a missing id gives the session). */
export function requiredFor(access: PermissionHolder): MentionPlatform[] {
  return requiredPlatforms(postingFacts(), can(access, EVENTS_INTRA_PUBLISH));
}
