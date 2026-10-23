'use server';

import { getLocale } from 'next-intl/server';
import { z } from 'zod';
import type { ActionTarget } from '@/lib/action-target';
import { getPathname } from '@/i18n/navigation';
import { requireTemplateEditor } from '@/lib/notifications/templates/access';
import type { Notice } from '@/lib/notifications/templates/notice';
import { ITEMS } from '@/lib/notifications/templates/catalog';
import { composeDrafts } from '@/lib/notifications/templates/compose';
import { renderPreview, type Preview } from '@/lib/notifications/templates/preview';
import { TEMPLATE_SCOPES, type TemplateIssue } from '@/lib/notifications/templates/schema';
import * as service from '@/lib/notifications/templates/service';
import { loadMentions } from '@/lib/notifications/templates/store';
import {
  previewOptions,
  sendTemplateTest,
  type TestOutcome,
} from '@/lib/notifications/templates/test-send';
import { TEMPLATE_CHANNELS, type TemplateType } from '@/lib/notifications/templates/types';
import { prisma } from '@/lib/prisma';

/**
 * The server side of the page where the notifications are customised. Every action is an entry point of its own: it checks that the
 * account behind the request holds the permission (and throws `Forbidden` otherwise: a crafted request, not a case the page offers),
 * reads its input again with Zod, and leaves the rules, the transaction and the audit entry to the service. What can happen to
 * somebody who did nothing wrong (somebody saved first, a name still in use) is a code the page says in words, never a throw.
 */

const TYPES = Object.keys(ITEMS) as [TemplateType, ...TemplateType[]];
const type = z.enum(TYPES);
const scope = z.enum(TEMPLATE_SCOPES);
const channel = z.enum(TEMPLATE_CHANNELS);
const version = z.number().int().min(0).max(1_000_000);
const content = z.unknown();
const drafts = z.object({ all: content.optional(), own: content.optional() });

export type Answer<T extends object = object> =
  ({ ok: true } & T) | { ok: false; code: string; issues?: TemplateIssue[]; detail?: string };

/** Where the person lands after an action that changes what the page shows: the same notification, loaded again (rule 2 of "Navigation"). */
async function reload(
  type: TemplateType,
  scope: 'all' | (typeof TEMPLATE_CHANNELS)[number],
  notice: Notice,
): Promise<ActionTarget> {
  return {
    href: getPathname({
      href: { pathname: '/notifications', query: { type, scope, notice } },
      locale: await getLocale(),
    }),
  };
}

/** What the page needs from a service answer: the same shape, `undefined` fields dropped so it crosses the wire. */
function answer<T extends object>(result: service.TemplateResult<T>): Answer<T> {
  return result as Answer<T>;
}

export async function saveTemplate(input: unknown) {
  const editor = await requireTemplateEditor();
  const parsed = z.object({ type, scope, content, expectedVersion: version }).parse(input);
  return answer(
    await service.saveTemplate(parsed, { login: editor.user.login, id: editor.user.id }),
  );
}

export async function customizeChannel(input: unknown): Promise<Answer | ActionTarget> {
  const editor = await requireTemplateEditor();
  const parsed = z.object({ type, channel }).parse(input);
  const result = await service.customizeChannel(parsed, {
    login: editor.user.login,
    id: editor.user.id,
  });
  return result.ok ? reload(parsed.type, parsed.channel, 'customised') : answer(result);
}

export async function resetTemplate(input: unknown): Promise<Answer | ActionTarget> {
  const editor = await requireTemplateEditor();
  const parsed = z.object({ type, scope }).parse(input);
  const result = await service.resetTemplate(parsed, {
    login: editor.user.login,
    id: editor.user.id,
  });
  return result.ok ? reload(parsed.type, parsed.scope, 'reset') : answer(result);
}

export async function resetNotification(input: unknown): Promise<Answer | ActionTarget> {
  const editor = await requireTemplateEditor();
  const parsed = z.object({ type }).parse(input);
  const result = await service.resetType(parsed, { login: editor.user.login, id: editor.user.id });
  return result.ok ? reload(parsed.type, 'all', 'resetAll') : answer(result);
}

export async function restoreVersion(input: unknown): Promise<Answer | ActionTarget> {
  const editor = await requireTemplateEditor();
  const parsed = z.object({ type, scope, version }).parse(input);
  const result = await service.restoreVersion(parsed, {
    login: editor.user.login,
    id: editor.user.id,
  });
  return result.ok ? reload(parsed.type, parsed.scope, 'restored') : answer(result);
}

export async function acknowledgeRevision(input: unknown): Promise<Answer | ActionTarget> {
  const editor = await requireTemplateEditor();
  const parsed = z.object({ type, scope }).parse(input);
  const result = await service.acknowledgeRevision(parsed, {
    login: editor.user.login,
    id: editor.user.id,
  });
  return result.ok ? reload(parsed.type, parsed.scope, 'acknowledged') : answer(result);
}

export async function addMention(input: unknown) {
  const editor = await requireTemplateEditor();
  const parsed = z
    .object({
      platform: z.enum(['discord', 'slack']),
      kind: z.enum(['role', 'user', 'group']),
      key: z.string().max(80),
      label: z.string().max(200),
      externalId: z.string().max(80),
    })
    .parse(input);
  return answer(await service.addMention(parsed, { login: editor.user.login, id: editor.user.id }));
}

export async function removeMention(input: unknown) {
  const editor = await requireTemplateEditor();
  const parsed = z.object({ id: z.string().max(80) }).parse(input);
  return answer(
    await service.removeMention(parsed, { login: editor.user.login, id: editor.user.id }),
  );
}

/** The notification drawn with the example, for what is on the screen: nothing is written. */
export async function previewTemplate(input: unknown): Promise<Answer<{ preview: Preview }>> {
  await requireTemplateEditor();
  const parsed = z.object({ type, channel, drafts }).parse(input);
  const { directory } = await loadMentions();
  const composed = composeDrafts(parsed.type, parsed.channel, parsed.drafts, directory);
  if (!composed.ok) return { ok: false, code: 'invalid', issues: composed.issues };
  const preview = await renderPreview(parsed.type, parsed.channel, composed.template, {
    ...(await previewOptions()),
    mentions: directory,
  });
  return { ok: true, preview };
}

/** The test of a channel: see `sendTemplateTest`. */
export async function sendTemplateTestMessage(input: unknown): Promise<TestOutcome> {
  const editor = await requireTemplateEditor();
  const parsed = z.object({ type, channel, drafts, withMentions: z.boolean() }).parse(input);
  return sendTemplateTest({ ...parsed, to: editor.user.email ?? null });
}

export interface HistoryEntry {
  version: number;
  /** What made this version: a save, a return to the platform's own, or the restoring of an older version. */
  action: 'save' | 'reset' | 'restore';
  restoredFrom?: number;
  authorLogin: string;
  createdAt: string;
  /** Nothing to restore: this version was a return to the platform's own. */
  reset: boolean;
}

/** The versions kept for a notification and a scope, newest first. */
export async function loadHistory(input: unknown): Promise<{ entries: HistoryEntry[] }> {
  await requireTemplateEditor();
  const parsed = z.object({ type, scope }).parse(input);
  const rows = await prisma.notificationTemplateVersion.findMany({
    where: { type: parsed.type, scope: parsed.scope },
    orderBy: { version: 'desc' },
    select: { version: true, action: true, authorLogin: true, createdAt: true, content: true },
  });
  return {
    entries: rows.map((row) => ({
      version: row.version,
      action: row.action.startsWith('restore')
        ? 'restore'
        : row.action === 'reset'
          ? 'reset'
          : 'save',
      ...(row.action.startsWith('restore:') && { restoredFrom: Number(row.action.slice(8)) }),
      authorLogin: row.authorLogin,
      createdAt: row.createdAt.toISOString(),
      reset: row.content === null,
    })),
  };
}
