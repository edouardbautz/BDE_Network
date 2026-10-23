import type { Prisma } from '@/generated/prisma/client';
import { logAuditEvent } from '@/lib/audit-log';
import { prisma } from '@/lib/prisma';
import { channelsOfType } from './catalog';
import { directoryOf } from './store';
import { mentionsIn, type MentionKind, type MentionPlatform } from './mentions';
import { REVISIONS } from './revisions';
import { validateTemplate, type TemplateIssue, type TemplateScope } from './schema';
import type { TemplateChannel, TemplateContent, TemplateType } from './types';

/**
 * What the people who customise the notifications do, as the database sees it. Every operation:
 *
 * - **runs in one transaction with its audit entry**, which says who, what and for which notification, never the whole text;
 * - **checks again what it is given** (the browser is not trusted) with the very function the editor uses;
 * - **keeps the history**: each save, reset and restore is a version, nothing is edited, and the last {@link HISTORY_KEPT} are kept;
 * - **answers a code, not an error**, for what can happen to somebody who did nothing wrong: somebody saved first (`conflict`), the
 *   version asked for is gone (`notFound`).
 *
 * Who may call these is the business of the actions that do (`requireTemplateEditor`): here the actor is given.
 */

export const HISTORY_KEPT = 50;

export interface TemplateActor {
  login: string;
  id?: string | null;
}

export type TemplateResult<T extends object = object> =
  ({ ok: true } & T) | { ok: false; code: string; issues?: TemplateIssue[]; detail?: string };

const fail = (code: string, extra: { issues?: TemplateIssue[]; detail?: string } = {}) =>
  ({ ok: false, code, ...extra }) as const;

type Tx = Prisma.TransactionClient;

const TARGET = 'NotificationTemplate';
const label = (type: TemplateType, scope: TemplateScope) => `${type} · ${scope}`;
const idOf = (type: TemplateType, scope: TemplateScope) => `${type}:${scope}`;

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The top-level fields that differ, for the audit entry. */
function changedFields(before: unknown, after: unknown): string[] {
  const a = (before ?? {}) as Record<string, unknown>;
  const b = (after ?? {}) as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((key) => !equal(a[key], b[key]))
    .sort();
}

/** The mentions and the address a content holds: what the audit entry says besides the fields, since both reach other people. */
function reachOf(content: TemplateContent | null | undefined) {
  const mentions = content?.above
    ? mentionsIn(content.above).map((token) =>
        'key' in token ? `${token.kind}:${token.key}` : token.kind,
      )
    : [];
  return {
    ...(mentions.length > 0 && { mentions: [...new Set(mentions)] }),
    ...(content?.button?.url && { buttonUrl: content.button.url }),
  };
}

/** A template written for all channels, as the start of one channel's: what that channel cannot hold is left out. */
export function forChannel(content: TemplateContent, channel: TemplateChannel): TemplateContent {
  const copy: TemplateContent = JSON.parse(JSON.stringify(content));
  if (channel === 'email') delete copy.above;
  else {
    delete copy.subject;
    delete copy.preheader;
    delete copy.note;
  }
  return copy;
}

function scopeApplies(type: TemplateType, scope: TemplateScope): boolean {
  return scope === 'all' || channelsOfType(type).includes(scope);
}

async function directoryIn(tx: Tx) {
  return directoryOf(
    (await tx.notificationMention.findMany()) as unknown as Parameters<typeof directoryOf>[0],
  );
}

const MAX_ATTEMPTS = 3;

/**
 * Runs the work in a transaction that is SERIALIZABLE, and retried: two people saving the same notification at the same time could
 * both read the version they were shown before either wrote, and the second would silently replace the first. A save the
 * database cannot serialize after the last try, and a unique violation (the same version written twice), are a conflict: the
 * answer for somebody who did nothing wrong, not an error.
 */
async function transact<T extends object>(
  work: (tx: Tx) => Promise<TemplateResult<T>>,
): Promise<TemplateResult<T>> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction(work, { isolationLevel: 'Serializable' });
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
      if (code === 'P2002') return fail('conflict');
      if (code !== 'P2034') throw error;
      if (attempt >= MAX_ATTEMPTS) return fail('conflict');
    }
  }
}

/** Writes a version into the history and keeps only the last ones. */
async function record(
  tx: Tx,
  input: {
    type: TemplateType;
    scope: TemplateScope;
    version: number;
    content: TemplateContent | null;
    basedOnRevision: number;
    action: string;
    actor: TemplateActor;
  },
) {
  await tx.notificationTemplateVersion.create({
    data: {
      type: input.type,
      scope: input.scope,
      version: input.version,
      content: input.content === null ? undefined : (input.content as Prisma.InputJsonValue),
      basedOnRevision: input.basedOnRevision,
      action: input.action,
      authorLogin: input.actor.login,
      authorId: input.actor.id ?? null,
    },
  });
  await tx.notificationTemplateVersion.deleteMany({
    where: { type: input.type, scope: input.scope, version: { lte: input.version - HISTORY_KEPT } },
  });
}

/** The version a new row of the history takes: the history is the counter, so a version number is never reused after a reset. */
async function nextVersion(tx: Tx, type: TemplateType, scope: TemplateScope): Promise<number> {
  const last = await tx.notificationTemplateVersion.aggregate({
    where: { type, scope },
    _max: { version: true },
  });
  return (last._max.version ?? 0) + 1;
}

async function put(
  tx: Tx,
  input: {
    type: TemplateType;
    scope: TemplateScope;
    content: TemplateContent;
    version: number;
    basedOnRevision: number;
    actor: TemplateActor;
  },
) {
  const data = {
    content: input.content as Prisma.InputJsonValue,
    version: input.version,
    basedOnRevision: input.basedOnRevision,
    updatedByLogin: input.actor.login,
    updatedById: input.actor.id ?? null,
    lastFallbackAt: null,
    lastFallbackReason: null,
  };
  await tx.notificationTemplate.upsert({
    where: { type_scope: { type: input.type, scope: input.scope } },
    create: { type: input.type, scope: input.scope, ...data },
    update: data,
  });
}

export interface SaveInput {
  type: TemplateType;
  scope: TemplateScope;
  content: unknown;
  /** The version the editor was showing (0 when there was none): a save over somebody else's newer one is refused. */
  expectedVersion: number;
}

/** Saves what the BDE wrote for a notification. */
export function saveTemplate(
  input: SaveInput,
  actor: TemplateActor,
): Promise<TemplateResult<{ version: number; changed: boolean }>> {
  const { type, scope } = input;
  if (!scopeApplies(type, scope)) return Promise.resolve(fail('channelNotForType'));

  return transact<{ version: number; changed: boolean }>(async (tx) => {
    const checked = validateTemplate(type, scope, input.content, await directoryIn(tx));
    if (!checked.ok) return fail('invalid', { issues: checked.issues });

    const current = await tx.notificationTemplate.findUnique({
      where: { type_scope: { type, scope } },
    });
    if ((current?.version ?? 0) !== input.expectedVersion) return fail('conflict');
    if (current && equal(current.content, checked.value)) {
      return { ok: true, version: current.version, changed: false };
    }

    const version = await nextVersion(tx, type, scope);
    const basedOnRevision = current?.basedOnRevision ?? REVISIONS[type];
    await put(tx, { type, scope, content: checked.value, version, basedOnRevision, actor });
    await record(tx, {
      type,
      scope,
      version,
      content: checked.value,
      basedOnRevision,
      action: 'save',
      actor,
    });
    await logAuditEvent(
      {
        actorLogin: actor.login,
        actorId: actor.id,
        action: 'notification_template.update',
        targetType: TARGET,
        targetId: idOf(type, scope),
        targetLabel: label(type, scope),
        metadata: {
          type,
          scope,
          version,
          fields: changedFields(current?.content, checked.value),
          ...reachOf(checked.value),
        },
      },
      tx,
    );
    return { ok: true, version, changed: true };
  });
}

/**
 * Makes a channel different from the others: its own template, starting as a copy of what was written for all of them, which the
 * channel then no longer follows.
 */
export function customizeChannel(
  input: { type: TemplateType; channel: TemplateChannel },
  actor: TemplateActor,
): Promise<TemplateResult<{ version: number }>> {
  const { type, channel } = input;
  if (!scopeApplies(type, channel)) return Promise.resolve(fail('channelNotForType'));

  return transact<{ version: number }>(async (tx) => {
    if (
      await tx.notificationTemplate.findUnique({ where: { type_scope: { type, scope: channel } } })
    ) {
      return fail('conflict');
    }
    const shared = await tx.notificationTemplate.findUnique({
      where: { type_scope: { type, scope: 'all' } },
    });
    const content = forChannel((shared?.content ?? {}) as TemplateContent, channel);
    const checked = validateTemplate(type, channel, content, await directoryIn(tx));
    if (!checked.ok) return fail('invalid', { issues: checked.issues });

    const version = await nextVersion(tx, type, channel);
    const basedOnRevision = shared?.basedOnRevision ?? REVISIONS[type];
    await put(tx, {
      type,
      scope: channel,
      content: checked.value,
      version,
      basedOnRevision,
      actor,
    });
    await record(tx, {
      type,
      scope: channel,
      version,
      content: checked.value,
      basedOnRevision,
      action: 'save',
      actor,
    });
    await logAuditEvent(
      {
        actorLogin: actor.login,
        actorId: actor.id,
        action: 'notification_template.customize',
        targetType: TARGET,
        targetId: idOf(type, channel),
        targetLabel: label(type, channel),
        metadata: { type, scope: channel, version, ...reachOf(checked.value) },
      },
      tx,
    );
    return { ok: true, version };
  });
}

/** Back to the platform's own, for one scope. */
async function resetIn(tx: Tx, type: TemplateType, scope: TemplateScope, actor: TemplateActor) {
  const current = await tx.notificationTemplate.findUnique({
    where: { type_scope: { type, scope } },
  });
  if (!current) return false;
  const version = await nextVersion(tx, type, scope);
  await tx.notificationTemplate.delete({ where: { type_scope: { type, scope } } });
  await record(tx, {
    type,
    scope,
    version,
    content: null,
    basedOnRevision: current.basedOnRevision,
    action: 'reset',
    actor,
  });
  return true;
}

/** Back to the platform's own for one scope: "all channels", or one channel. */
export function resetTemplate(
  input: { type: TemplateType; scope: TemplateScope },
  actor: TemplateActor,
): Promise<TemplateResult<{ changed: boolean }>> {
  const { type, scope } = input;
  return transact<{ changed: boolean }>(async (tx) => {
    const changed = await resetIn(tx, type, scope, actor);
    if (changed) {
      await logAuditEvent(
        {
          actorLogin: actor.login,
          actorId: actor.id,
          action: 'notification_template.reset',
          targetType: TARGET,
          targetId: idOf(type, scope),
          targetLabel: label(type, scope),
          metadata: { type, scope },
        },
        tx,
      );
    }
    return { ok: true, changed };
  });
}

/** Back to the platform's own for a whole notification: every scope at once. */
export function resetType(
  input: { type: TemplateType },
  actor: TemplateActor,
): Promise<TemplateResult<{ scopes: TemplateScope[] }>> {
  const { type } = input;
  return transact<{ scopes: TemplateScope[] }>(async (tx) => {
    const reset: TemplateScope[] = [];
    for (const scope of ['all', 'discord', 'slack', 'email'] as const) {
      if (await resetIn(tx, type, scope, actor)) reset.push(scope);
    }
    if (reset.length > 0) {
      await logAuditEvent(
        {
          actorLogin: actor.login,
          actorId: actor.id,
          action: 'notification_template.reset_type',
          targetType: TARGET,
          targetId: type,
          targetLabel: type,
          metadata: { type, scopes: reset },
        },
        tx,
      );
    }
    return { ok: true, scopes: reset };
  });
}

/** Puts an earlier version back as a new one (the history is never rewritten). */
export function restoreVersion(
  input: { type: TemplateType; scope: TemplateScope; version: number },
  actor: TemplateActor,
): Promise<TemplateResult<{ version: number }>> {
  const { type, scope } = input;
  return transact<{ version: number }>(async (tx) => {
    const old = await tx.notificationTemplateVersion.findUnique({
      where: { type_scope_version: { type, scope, version: input.version } },
    });
    if (!old) return fail('notFound');

    const version = await nextVersion(tx, type, scope);
    if (old.content === null) {
      // an earlier reset: restoring it is resetting again
      const current = await tx.notificationTemplate.findUnique({
        where: { type_scope: { type, scope } },
      });
      if (current) {
        await tx.notificationTemplate.delete({ where: { type_scope: { type, scope } } });
        await record(tx, {
          type,
          scope,
          version,
          content: null,
          basedOnRevision: current.basedOnRevision,
          action: `restore:${input.version}`,
          actor,
        });
      }
    } else {
      // what was valid then may not be now (a mention was deleted): it is checked again, never put back as it is
      const checked = validateTemplate(type, scope, old.content, await directoryIn(tx));
      if (!checked.ok) return fail('restoreInvalid', { issues: checked.issues });
      await put(tx, {
        type,
        scope,
        content: checked.value,
        version,
        basedOnRevision: old.basedOnRevision,
        actor,
      });
      await record(tx, {
        type,
        scope,
        version,
        content: checked.value,
        basedOnRevision: old.basedOnRevision,
        action: `restore:${input.version}`,
        actor,
      });
    }
    await logAuditEvent(
      {
        actorLogin: actor.login,
        actorId: actor.id,
        action: 'notification_template.restore',
        targetType: TARGET,
        targetId: idOf(type, scope),
        targetLabel: label(type, scope),
        metadata: { type, scope, version, restored: input.version },
      },
      tx,
    );
    return { ok: true, version };
  });
}

/**
 * The BDE has read what the platform changed since it wrote its template, and keeps it as it is: the editor stops saying so until
 * the platform changes again.
 */
export function acknowledgeRevision(
  input: { type: TemplateType; scope: TemplateScope },
  actor: TemplateActor,
): Promise<TemplateResult> {
  const { type, scope } = input;
  return transact<object>(async (tx) => {
    const current = await tx.notificationTemplate.findUnique({
      where: { type_scope: { type, scope } },
    });
    if (!current) return fail('notFound');
    await tx.notificationTemplate.update({
      where: { type_scope: { type, scope } },
      data: { basedOnRevision: REVISIONS[type] },
    });
    await logAuditEvent(
      {
        actorLogin: actor.login,
        actorId: actor.id,
        action: 'notification_template.acknowledge',
        targetType: TARGET,
        targetId: idOf(type, scope),
        targetLabel: label(type, scope),
        metadata: { type, scope, revision: REVISIONS[type] },
      },
      tx,
    );
    return { ok: true };
  });
}

export interface MentionInput {
  platform: MentionPlatform;
  kind: MentionKind;
  key: string;
  label: string;
  externalId: string;
}

const MENTION_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MENTION_ID: Record<MentionPlatform, RegExp> = {
  discord: /^[0-9]{17,20}$/,
  slack: /^[UWS][A-Z0-9]{8,14}$/,
};
const KINDS: Record<MentionPlatform, readonly MentionKind[]> = {
  discord: ['role', 'user'],
  slack: ['group', 'user'],
};

/** Adds somebody, a role or a group to what templates can mention. */
export function addMention(
  input: MentionInput,
  actor: TemplateActor,
): Promise<TemplateResult<{ id: string }>> {
  const label = input.label.trim();
  const key = input.key.trim();
  const externalId = input.externalId.trim();
  const issues: TemplateIssue[] = [];
  if (!KINDS[input.platform]?.includes(input.kind)) issues.push({ path: 'kind', code: 'invalid' });
  if (key.length === 0 || key.length > 40 || !MENTION_KEY.test(key)) {
    issues.push({ path: 'key', code: 'badMentionKey' });
  }
  if (label.length === 0 || label.length > 60) issues.push({ path: 'label', code: 'invalid' });
  if (!MENTION_ID[input.platform]?.test(externalId))
    issues.push({ path: 'externalId', code: 'badMentionId' });
  if (issues.length > 0) return Promise.resolve(fail('invalid', { issues }));

  return transact<{ id: string }>(async (tx) => {
    const taken = await tx.notificationMention.findUnique({
      where: { platform_key: { platform: input.platform, key } },
    });
    if (taken) return fail('mentionExists');
    const created = await tx.notificationMention.create({
      data: {
        key,
        platform: input.platform,
        kind: input.kind,
        label,
        externalId,
        createdByLogin: actor.login,
      },
    });
    await logAuditEvent(
      {
        actorLogin: actor.login,
        actorId: actor.id,
        action: 'notification_mention.add',
        targetType: 'NotificationMention',
        targetId: created.id,
        targetLabel: `${input.platform}:${key}`,
        metadata: { platform: input.platform, kind: input.kind, key },
      },
      tx,
    );
    return { ok: true, id: created.id };
  });
}

/** The templates that mention somebody by this name: what stops it being taken away. */
async function usersOfMention(tx: Tx, platform: MentionPlatform, key: string): Promise<string[]> {
  const rows = await tx.notificationTemplate.findMany();
  const spelled = (content: unknown) =>
    mentionsIn(
      typeof (content as TemplateContent)?.above === 'string'
        ? (content as TemplateContent).above!
        : '',
    ).some((token) => 'key' in token && token.key === key);
  return rows
    .filter((row) => (row.scope === platform || row.scope === 'all') && spelled(row.content))
    .map((row) => idOf(row.type as TemplateType, row.scope as TemplateScope));
}

/** Takes somebody off the list, unless a template still mentions them: the template would then be unusable. */
export function removeMention(
  input: { id: string },
  actor: TemplateActor,
): Promise<TemplateResult> {
  return transact<object>(async (tx) => {
    const mention = await tx.notificationMention.findUnique({ where: { id: input.id } });
    if (!mention) return fail('notFound');
    const users = await usersOfMention(tx, mention.platform as MentionPlatform, mention.key);
    if (users.length > 0) return fail('mentionInUse', { detail: users.join(', ') });
    await tx.notificationMention.delete({ where: { id: input.id } });
    await logAuditEvent(
      {
        actorLogin: actor.login,
        actorId: actor.id,
        action: 'notification_mention.remove',
        targetType: 'NotificationMention',
        targetId: mention.id,
        targetLabel: `${mention.platform}:${mention.key}`,
        metadata: { platform: mention.platform, kind: mention.kind, key: mention.key },
      },
      tx,
    );
    return { ok: true };
  });
}
