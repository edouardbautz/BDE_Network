import { getConfig } from '@/config';
import { channelsFor, EVENTS_MODULE_KEY } from '@/config/schema';
import { eventValues } from '@/lib/events/template-values';
import { memberValues } from '@/lib/members/template-values';
import { getNotificationTranslate } from '../translate';
import { channelsOfType, ITEMS, nativeOrder, sharedChannels, VARIABLES } from './catalog';
import { describeDefaults } from './defaults';
import { commonDefaults, type ChannelDefaults } from './defaults-shape';
import { sampleEvent, sampleMember } from './samples';
import type { TemplateScope } from './schema';
import { changesSince } from './revisions';
import { loadMentions, loadTemplates, type StoredMention, type StoredTemplate } from './store';
import type { ItemId, TemplateChannel, TemplateContent, TemplateType } from './types';

/**
 * What the page of the editor needs, for one type of notification: the templates as saved, what the platform says by itself for each
 * channel, the example values of the variables, the people the BDE can mention, and what the page says about each notification in
 * the list. All of it plain data, for a client component.
 */

export interface ScopeState {
  content: TemplateContent | null;
  /** The version the editor shows (0 when there is no template): a save is refused over a newer one. */
  version: number;
  updatedByLogin: string | null;
  updatedAt: string | null;
  /** The last time a send could not use this template, and why. */
  fallback: { at: string; reason: string } | null;
  /** The platform changed its own notification since this template was written: what changed (keys of `templates.revisions`). */
  outdated: string[];
}

export interface MentionView {
  id: string;
  key: string;
  platform: 'discord' | 'slack';
  kind: 'role' | 'user' | 'group';
  label: string;
  externalId: string;
}

export interface EditorData {
  type: TemplateType;
  locale: 'fr' | 'en';
  /** The channels this notification is sent on, and those the template for all of them reaches. */
  channels: TemplateChannel[];
  shared: TemplateChannel[];
  /** The channels the BDE set the notification to (the table of the settings page). */
  ticked: TemplateChannel[];
  scopes: Record<TemplateScope, ScopeState>;
  defaults: Partial<Record<TemplateChannel, ChannelDefaults>> & { all: ChannelDefaults };
  /** The facts of the type, and the order each channel shows them in. */
  items: ItemId[];
  nativeOrder: Partial<Record<TemplateChannel, ItemId[]>>;
  variables: Array<{ id: string; sample: string }>;
  mentions: MentionView[];
  bde: { name: string; accent: string };
}

/** The notifications the page lists: those of the events only while the module is on. */
export function listedTypes(modules: readonly string[]): TemplateType[] {
  const events = modules.includes(EVENTS_MODULE_KEY);
  return (Object.keys(ITEMS) as TemplateType[]).filter(
    (type) => events || !type.startsWith('event'),
  );
}

/** For each notification of the list, the scopes a BDE customised: a dot in the list. */
export async function customisedScopes(): Promise<Partial<Record<TemplateType, TemplateScope[]>>> {
  const rows = await loadTemplates();
  const byType: Partial<Record<TemplateType, TemplateScope[]>> = {};
  for (const row of rows) (byType[row.type] ??= []).push(row.scope);
  return byType;
}

const mentionView = (row: StoredMention): MentionView => ({
  id: row.id,
  key: row.key,
  platform: row.platform,
  kind: row.kind,
  label: row.label,
  externalId: row.externalId,
});

function stateOf(type: TemplateType, row: StoredTemplate | undefined): ScopeState {
  if (!row) {
    return {
      content: null,
      version: 0,
      updatedByLogin: null,
      updatedAt: null,
      fallback: null,
      outdated: [],
    };
  }
  return {
    content: (row.content ?? null) as TemplateContent | null,
    version: row.version,
    updatedByLogin: row.updatedByLogin,
    updatedAt: row.updatedAt.toISOString(),
    fallback:
      row.lastFallbackAt && row.lastFallbackReason
        ? { at: row.lastFallbackAt.toISOString(), reason: row.lastFallbackReason }
        : null,
    outdated: changesSince(type, row.basedOnRevision).map((change) => change.note),
  };
}

export async function loadEditorData(type: TemplateType): Promise<EditorData> {
  const config = getConfig();
  const locale = config.bde.defaultLocale as 'fr' | 'en';
  const channels = [...channelsOfType(type)];
  const [rows, mentions] = await Promise.all([loadTemplates(type), loadMentions()]);

  const defaults: Partial<Record<TemplateChannel, ChannelDefaults>> = {};
  for (const channel of channels) defaults[channel] = await describeDefaults(type, channel, locale);

  // The example values the variables stand for, as the platform would write them for the first channel's example.
  const now = new Date();
  const values = type.startsWith('event')
    ? eventValues(
        type === 'eventReminder'
          ? 'tomorrow'
          : type === 'eventConfirmed'
            ? 'confirmed'
            : (type.slice(5).toLowerCase() as 'proposed'),
        sampleEvent(locale, now, type),
        await getNotificationTranslate(locale, 'events.notifications'),
        locale,
        config.bde.timezone,
        config.bde.name,
      )
    : memberValues(sampleMember(locale), config.bde.name, null);

  const scopes = {} as Record<TemplateScope, ScopeState>;
  for (const scope of ['all', 'discord', 'slack', 'email'] as const) {
    scopes[scope] = stateOf(
      type,
      rows.find((row) => row.scope === scope),
    );
  }

  return {
    type,
    locale,
    channels,
    shared: [...sharedChannels(type)],
    ticked: channelsFor(config, type),
    scopes,
    defaults: { ...defaults, all: commonDefaults(defaults) },
    items: [...ITEMS[type]],
    nativeOrder: Object.fromEntries(
      channels.map((channel) => [channel, nativeOrder(channel, type)]),
    ),
    variables: VARIABLES[type].map((id) => ({ id, sample: values[id] ?? '' })),
    mentions: mentions.rows.map(mentionView),
    bde: { name: config.bde.name, accent: config.bde.accentColor },
  };
}
