import { prisma } from '@/lib/prisma';
import {
  directoryKey,
  type MentionDirectory,
  type MentionKind,
  type MentionPlatform,
} from './mentions';
import type { TemplateScope } from './schema';
import type { TemplateType } from './types';

/** A template as the database holds it. `content` is whatever was saved: it is checked again when it is used. */
export interface StoredTemplate {
  type: TemplateType;
  scope: TemplateScope;
  content: unknown;
  version: number;
  basedOnRevision: number;
  updatedAt: Date;
  updatedByLogin: string;
  lastFallbackAt: Date | null;
  lastFallbackReason: string | null;
}

export interface StoredMention {
  id: string;
  key: string;
  platform: MentionPlatform;
  kind: MentionKind;
  label: string;
  externalId: string;
  createdByLogin: string;
  createdAt: Date;
}

/** The templates of one type (or of every type). */
export async function loadTemplates(type?: TemplateType): Promise<StoredTemplate[]> {
  const rows = await prisma.notificationTemplate.findMany({
    ...(type && { where: { type } }),
    orderBy: [{ type: 'asc' }, { scope: 'asc' }],
  });
  return rows.map((row) => ({
    type: row.type as TemplateType,
    scope: row.scope as TemplateScope,
    content: row.content,
    version: row.version,
    basedOnRevision: row.basedOnRevision,
    updatedAt: row.updatedAt,
    updatedByLogin: row.updatedByLogin,
    lastFallbackAt: row.lastFallbackAt,
    lastFallbackReason: row.lastFallbackReason,
  }));
}

/** Everything the BDE can mention, as rows (for the editor) and as the directory templates are written against. */
export async function loadMentions(): Promise<{
  rows: StoredMention[];
  directory: MentionDirectory;
}> {
  const rows = (await prisma.notificationMention.findMany({
    orderBy: [{ platform: 'asc' }, { label: 'asc' }],
  })) as unknown as StoredMention[];
  return { rows, directory: directoryOf(rows) };
}

export function directoryOf(
  rows: ReadonlyArray<Pick<StoredMention, 'platform' | 'key' | 'kind' | 'label' | 'externalId'>>,
): MentionDirectory {
  return Object.fromEntries(
    rows.map((row) => [
      directoryKey(row.platform, row.key),
      { platform: row.platform, kind: row.kind, label: row.label, externalId: row.externalId },
    ]),
  );
}
