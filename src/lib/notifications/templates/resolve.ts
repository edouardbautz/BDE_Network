import { getConfig } from '@/config';
import { prisma } from '@/lib/prisma';
import { cascade } from './apply';
import { sharedChannels } from './catalog';
import type { MentionDirectory } from './mentions';
import { validateTemplate, type TemplateScope } from './schema';
import { loadMentions, loadTemplates, type StoredTemplate } from './store';
import {
  TEMPLATE_CHANNELS,
  type TemplateChannel,
  type TemplateContent,
  type TemplateContext,
  type TemplateType,
} from './types';

/**
 * The template a notification is sent with, found when it is sent.
 *
 * - For a channel: what the BDE wrote for that channel over what it wrote for all of them, over the platform's own, field by field
 *   (`cascade`). A BDE that wrote nothing gets the platform's own, which is the notification as it has always been.
 * - **A template that cannot be used is not used: the platform's own is sent instead**, and the editor says so. It can be unusable
 *   because the content is no longer valid (a variable a version removed, a mention whose name was deleted, a row edited by hand), or
 *   because building the notification with it fails. A notification is never lost to a template.
 * - Reading the templates can fail (the database is not reachable): the platform's own are sent, and it is logged.
 */

export interface SendTemplates {
  /** What a channel's builders are given. */
  context(channel: TemplateChannel): TemplateContext;
  /** Builds with the template, and with the platform's own when that fails. */
  build<T>(channel: TemplateChannel, make: (context: TemplateContext) => T): T;
}

/** A row is told at most this often that it was not used: it is the same fault on every send until it is fixed. */
const NOTICE_EVERY_MS = 60 * 60 * 1000;

/** Notes, for the editor, that a template could not be used. Never throws: this is a courtesy to the BDE, not part of sending. */
async function recordFallback(
  type: TemplateType,
  scope: TemplateScope,
  reason: string,
  previous?: StoredTemplate,
): Promise<void> {
  try {
    const recent =
      previous?.lastFallbackAt && Date.now() - previous.lastFallbackAt.getTime() < NOTICE_EVERY_MS;
    if (recent && previous?.lastFallbackReason === reason) return;
    await prisma.notificationTemplate.update({
      where: { type_scope: { type, scope } },
      data: { lastFallbackAt: new Date(), lastFallbackReason: reason.slice(0, 200) },
    });
  } catch {
    // the template may have been reset meanwhile
  }
}

export async function templatesFor(type: TemplateType): Promise<SendTemplates> {
  const { bde } = getConfig();
  const base: TemplateContext = { bdeName: bde.name, locale: bde.defaultLocale };

  let rows: StoredTemplate[] = [];
  let directory: MentionDirectory = {};
  try {
    rows = await loadTemplates(type);
    directory = (await loadMentions()).directory;
  } catch (error) {
    console.error(
      `[notifications] ${type}: the templates could not be read, the platform's own are used`,
      error,
    );
  }

  const contexts = new Map<TemplateChannel, TemplateContext>();
  for (const channel of TEMPLATE_CHANNELS) {
    const used: TemplateContent[] = [];
    let unusable: { row: StoredTemplate; reason: string } | undefined;
    const scopes: TemplateScope[] = sharedChannels(type).includes(channel)
      ? ['all', channel]
      : [channel];
    for (const scope of scopes) {
      const row = rows.find((candidate) => candidate.scope === scope);
      if (!row) continue;
      const checked = validateTemplate(type, scope, row.content, directory);
      if (checked.ok) used.push(checked.value);
      else {
        const first = checked.issues[0];
        unusable = { row, reason: `${first?.path ?? ''}:${first?.code ?? 'invalid'}` };
      }
    }

    if (unusable) {
      console.error(
        `[notifications] ${type}/${channel}: the template of the BDE is not valid (${unusable.reason}), the platform's own is sent`,
      );
      void recordFallback(type, unusable.row.scope, unusable.reason, unusable.row);
      contexts.set(channel, { ...base, mentions: directory });
      continue;
    }
    const template = used.length === 2 ? cascade(used[0], used[1]) : used[0];
    contexts.set(channel, { ...base, mentions: directory, ...(template && { template }) });
  }

  const context = (channel: TemplateChannel) => contexts.get(channel) ?? base;
  return {
    context,
    build(channel, make) {
      const own = context(channel);
      if (!own.template) return make(own);
      try {
        return make(own);
      } catch (error) {
        console.error(
          `[notifications] ${type}/${channel}: building with the template of the BDE failed, the platform's own is sent`,
          error,
        );
        for (const scope of sharedChannels(type).includes(channel) ? ['all', channel] : [channel]) {
          if (rows.some((row) => row.scope === scope)) {
            void recordFallback(type, scope as TemplateScope, 'render:failed');
          }
        }
        return make({ ...base, mentions: directory });
      }
    },
  };
}
