import { ITEMS } from './catalog';
import type { ChannelDefaults } from './defaults-shape';
import { isCustomItem } from './apply';
import type {
  CustomItemId,
  ItemId,
  TemplateChannel,
  TemplateContent,
  TemplateItem,
  TemplateType,
} from './types';

/**
 * The editor's side of a template: what a field of the form shows, and what a change does to the template. Pure, and tested without a
 * browser. One rule runs through it: **a field that says what the platform says is not stored**, so what the BDE did not change
 * keeps following the platform, and the editor shows the platform's own words in the field until the BDE writes its own.
 */

type TextField = 'eyebrow' | 'title' | 'footer' | 'subject' | 'preheader' | 'note' | 'above';

/** What a text field shows: the BDE's text, or the platform's. */
export function textOf(
  content: TemplateContent | null | undefined,
  field: TextField,
  defaults: ChannelDefaults,
): string {
  const own = content?.[field];
  if (own !== undefined) return own;
  if (field === 'eyebrow' || field === 'title' || field === 'footer') return defaults[field];
  if (field === 'subject' || field === 'note') return defaults[field] ?? '';
  return '';
}

/** Whether a text field is the BDE's own. */
export const isOwnText = (content: TemplateContent | null | undefined, field: TextField) =>
  content?.[field] !== undefined;

/** The template without what says nothing: empty objects, and a button or a list that only repeats the platform. */
export function tidy(content: TemplateContent): TemplateContent {
  const out: TemplateContent = { ...content };
  if (out.button) {
    const button = { ...out.button };
    for (const key of Object.keys(button) as Array<keyof typeof button>) {
      if (button[key] === undefined) delete button[key];
    }
    if (Object.keys(button).length === 0) delete out.button;
    else out.button = button;
  }
  for (const key of Object.keys(out) as Array<keyof TemplateContent>) {
    if (out[key] === undefined) delete out[key];
  }
  return out;
}

/**
 * Sets a text field. The platform's own words, and nothing at all for a field the platform has no words for (the line after the
 * subject, the message above the card), are stored as no text.
 */
export function withText(
  content: TemplateContent,
  field: TextField,
  value: string,
  defaults: ChannelDefaults,
): TemplateContent {
  const platform = textOf(null, field, defaults);
  const next = { ...content };
  if (value.trim() === '' || value === platform) delete next[field];
  else next[field] = value;
  return tidy(next);
}

export function withEmoji(
  content: TemplateContent,
  value: string,
  defaults: ChannelDefaults,
): TemplateContent {
  const next = { ...content };
  if (value === defaults.emoji) delete next.emoji;
  else next.emoji = value;
  return tidy(next);
}

/** The colour of the bar: a hex colour, or automatic (the category's, the kind's). */
export function withColor(content: TemplateContent, color: string | null): TemplateContent {
  const next = { ...content };
  if (color === null) delete next.color;
  else next.color = color;
  return tidy(next);
}

/** Whether the notification has a button on this channel: the channel's own way, or the BDE's choice. */
export function buttonShown(
  content: TemplateContent | null | undefined,
  defaults: ChannelDefaults,
) {
  return content?.button?.enabled ?? defaults.button.native;
}

export function withButton(
  content: TemplateContent,
  patch: { enabled?: boolean; label?: string; url?: string | null },
  defaults: ChannelDefaults,
): TemplateContent {
  const button = { ...content.button };
  if (patch.enabled !== undefined) {
    if (patch.enabled === defaults.button.native) delete button.enabled;
    else button.enabled = patch.enabled;
  }
  if (patch.label !== undefined) {
    if (patch.label.trim() === '' || patch.label === defaults.button.label) delete button.label;
    else button.label = patch.label;
  }
  if (patch.url !== undefined) {
    if (patch.url === null || patch.url.trim() === '') delete button.url;
    else button.url = patch.url;
    // an address is asked to lead somewhere: it implies a button
    if (button.url && button.enabled === undefined && !defaults.button.native)
      button.enabled = true;
  }
  return tidy({ ...content, button });
}

/** One line of the list of facts, as the form shows it. */
export interface ItemRow {
  id: ItemId | CustomItemId;
  enabled: boolean;
  custom: boolean;
  /** The name shown (the BDE's, or the platform's), and whether it is the BDE's. */
  label: string;
  ownLabel: boolean;
  /** The emoji shown ('' for none), and whether it is the BDE's. */
  emoji: string;
  ownEmoji: boolean;
  /** The sentence of `summary`, or the text of a free text. */
  text?: string;
  ownText?: boolean;
}

/** The facts of a type in the order the editor lists them when the BDE has not ordered them. */
const canonical = (type: TemplateType): ItemId[] => [...ITEMS[type]];

/**
 * The list of facts as the form shows it, with the platform's words where the BDE wrote none. `order` is the facts the tab can
 * show, in the order it shows them when the BDE has not ordered them (a channel's own, see `nativeOrder`); without it, every fact
 * of the type in the order of the editor (the tab for all channels).
 */
export function itemRows(
  type: TemplateType,
  content: TemplateContent | null | undefined,
  defaults: ChannelDefaults,
  order: readonly ItemId[] = canonical(type),
): ItemRow[] {
  const known = new Set<string>(order);
  const stored = content?.items?.list.filter((item) => isCustomItem(item.id) || known.has(item.id));
  const base: TemplateItem[] = stored ?? order.map((id) => ({ id, enabled: true }));
  const present = new Set(base.map((item) => item.id));
  // a fact the tab can show that the template does not list is a fact the BDE does not show
  const missing = stored
    ? order.filter((id) => !present.has(id)).map((id): TemplateItem => ({ id, enabled: false }))
    : [];
  return [...base, ...missing].map((item) => {
    const custom = isCustomItem(item.id);
    const fact = custom ? undefined : defaults.items[item.id as ItemId];
    return {
      id: item.id,
      enabled: item.enabled,
      custom,
      label: item.label ?? fact?.label ?? '',
      ownLabel: item.label !== undefined,
      emoji: item.emoji ?? fact?.emoji ?? '',
      ownEmoji: item.emoji !== undefined,
      ...(custom || item.id === 'summary'
        ? {
            text: item.text ?? fact?.text ?? '',
            ownText: item.text !== undefined,
          }
        : {}),
    };
  });
}

/**
 * Writes a list of rows back as a template. A list that is every fact of the type switched on, in the platform's order, with the
 * platform's labels and emoji, is no list at all.
 */
export function withItems(
  content: TemplateContent,
  type: TemplateType,
  rows: readonly ItemRow[],
  options: { order: 'native' | 'custom'; base?: readonly ItemId[] },
  defaults: ChannelDefaults,
): TemplateContent {
  const list: TemplateItem[] = rows.map((row) => {
    const fact = row.custom ? undefined : defaults.items[row.id as ItemId];
    const item: TemplateItem = { id: row.id, enabled: row.enabled };
    if (!row.custom && row.label !== '' && row.label !== fact?.label) item.label = row.label;
    if (row.emoji !== (fact?.emoji ?? '')) item.emoji = row.emoji;
    if (row.custom || row.id === 'summary') {
      const text = row.text ?? '';
      if (row.custom || (text !== '' && text !== fact?.text)) item.text = text;
    }
    return item;
  });

  const next = { ...content };
  const base = options.base ?? canonical(type);
  const plain =
    options.order === 'native' &&
    list.length === base.length &&
    list.every(
      (item, index) => item.enabled && item.id === base[index] && Object.keys(item).length === 2,
    );
  if (plain) delete next.items;
  else next.items = { order: options.order, list };
  return tidy(next);
}

/** Moves a row up or down one place. */
export function moveRow(rows: readonly ItemRow[], index: number, by: -1 | 1): ItemRow[] {
  const target = index + by;
  if (target < 0 || target >= rows.length) return [...rows];
  const next = [...rows];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

/** The identifier of a new free text: `text:` and six letters or digits, one that no row has. */
export function newTextId(
  rows: readonly ItemRow[],
  random: () => number = Math.random,
): CustomItemId {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (;;) {
    const id =
      `text:${Array.from({ length: 6 }, () => alphabet[Math.floor(random() * alphabet.length)]).join('')}` as CustomItemId;
    if (!rows.some((row) => row.id === id)) return id;
  }
}

/** The order the template stores: the BDE's once it has moved a row, the channels' own until then. */
export const orderOf = (content: TemplateContent | null | undefined): 'native' | 'custom' =>
  content?.items?.order ?? 'native';

/** Whether a template says nothing: it is as if there were none. */
export const isBlank = (content: TemplateContent | null | undefined): boolean =>
  !content || Object.keys(tidy(content)).length === 0;

/** The channels a tab stands for: `all` is each of them. */
export const channelsOf = (
  scope: 'all' | TemplateChannel,
  available: readonly TemplateChannel[],
) => (scope === 'all' ? available : [scope]);
