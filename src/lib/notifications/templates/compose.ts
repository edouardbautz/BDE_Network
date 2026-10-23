import { cascade } from './apply';
import { sharedChannels } from './catalog';
import type { MentionDirectory } from './mentions';
import { validateTemplate, type TemplateIssue } from './schema';
import type { TemplateChannel, TemplateContent, TemplateType } from './types';

/**
 * What the editor has on screen, as the template a channel would be sent with: the draft for that channel over the draft for all of
 * them (when the channel follows it), each checked as it would be saved. A draft that is not valid says so, with the places, and
 * nothing is drawn from it.
 */

export interface Drafts {
  /** The draft of the template for all channels; absent or null: there is none. */
  all?: unknown;
  /** The draft of the channel's own template; absent or null: the channel has none and follows the shared one. */
  own?: unknown;
}

export type Composed =
  | { ok: true; template: TemplateContent | undefined }
  | { ok: false; issues: Array<TemplateIssue & { scope: 'all' | TemplateChannel }> };

export function composeDrafts(
  type: TemplateType,
  channel: TemplateChannel,
  drafts: Drafts,
  directory: MentionDirectory,
): Composed {
  const issues: Array<TemplateIssue & { scope: 'all' | TemplateChannel }> = [];
  const check = (scope: 'all' | TemplateChannel, draft: unknown): TemplateContent | undefined => {
    if (draft === undefined || draft === null) return undefined;
    const result = validateTemplate(type, scope, draft, directory);
    if (result.ok) return result.value;
    for (const issue of result.issues) issues.push({ ...issue, scope });
    return undefined;
  };

  const shared = sharedChannels(type).includes(channel) ? check('all', drafts.all) : undefined;
  const own = check(channel, drafts.own);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, template: cascade(shared, own) };
}

/**
 * The source of a message above a card with its mentions made inert: each one becomes the plain name the BDE gave it, so a test
 * shows where the mention goes without notifying anybody.
 */
export function inertMentions(
  source: string,
  directory: MentionDirectory,
  platform: 'discord' | 'slack',
): string {
  return source.replace(
    /\{@(everyone|here|channel)\}|\{@(role|user|group):([a-z0-9]+(?:-[a-z0-9]+)*)\}/g,
    (_match, word: string | undefined, _kind: string | undefined, key: string | undefined) => {
      if (word) return `@${word}`;
      const entry = key ? directory[`${platform}:${key}`] : undefined;
      return `@${entry?.label ?? key ?? ''}`;
    },
  );
}
