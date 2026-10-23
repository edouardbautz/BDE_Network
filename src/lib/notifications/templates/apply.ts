import { nativeOrder } from './catalog';
import type {
  CustomItemId,
  ItemId,
  TemplateChannel,
  TemplateContent,
  TemplateItem,
  TemplateType,
} from './types';

/** One item of a notification as a channel is to show it: in its place, with what the template says of it. */
export interface ResolvedItem {
  id: ItemId | CustomItemId;
  custom: boolean;
  label?: string;
  emoji?: string;
  text?: string;
}

export const isCustomItem = (id: string): id is CustomItemId => id.startsWith('text:');

/**
 * The items a channel shows of a notification, in the order it shows them. Without a choice of the BDE: what the platform
 * shows, in the channel's own order. With one: only the items that are in the list and switched on (an item of the type
 * that is not in the list is not shown), in the channel's order or, when the BDE ordered them, in theirs, free texts
 * after the facts when the order is the channel's.
 */
export function resolveItems(
  template: TemplateContent | undefined,
  channel: TemplateChannel,
  type: TemplateType,
): ResolvedItem[] {
  const native = nativeOrder(channel, type);
  const chosen = template?.items;
  if (!chosen) return native.map((id) => ({ id, custom: false }));

  const known = new Set<string>(native);
  const seen = new Set<string>();
  const shown = chosen.list.filter((item) => {
    if (!item.enabled || seen.has(item.id)) return false;
    seen.add(item.id);
    return isCustomItem(item.id) || known.has(item.id);
  });

  const facts = shown.filter((item) => !isCustomItem(item.id));
  const texts = shown.filter((item) => isCustomItem(item.id));
  const rank = (item: TemplateItem) => native.indexOf(item.id as ItemId);
  const ordered =
    chosen.order === 'custom' ? shown : [...[...facts].sort((a, b) => rank(a) - rank(b)), ...texts];

  return ordered.map((item) => ({
    id: item.id,
    custom: isCustomItem(item.id),
    ...(item.label !== undefined && { label: item.label }),
    ...(item.emoji !== undefined && { emoji: item.emoji }),
    ...(item.text !== undefined && { text: item.text }),
  }));
}

/** An emoji and a label as one string ("📅 When"), either part left out when empty. */
export function withEmoji(emoji: string | undefined, label: string, separator = ' '): string {
  return emoji ? `${emoji}${separator}${label}` : label;
}

/**
 * What one field of a template says, field by field: the channel's own change over the one shared by every channel. A
 * channel that is customised starts as a copy of what was shared, so the two do not move together afterwards; whatever
 * neither says is the platform's.
 */
export function cascade(
  shared: TemplateContent | undefined,
  own: TemplateContent | undefined,
): TemplateContent | undefined {
  if (!shared) return own;
  if (!own) return shared;
  const merged: TemplateContent = { ...shared, ...own };
  if (shared.button || own.button) merged.button = { ...shared.button, ...own.button };
  return merged;
}
