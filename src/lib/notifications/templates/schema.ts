import '@/lib/zod-config';
import { z } from 'zod';
import { ITEMS, VARIABLES } from './catalog';
import { TEMPLATE_LIMITS } from './limits';
import { directoryKey, mentionsIn, type MentionDirectory, type MentionKind } from './mentions';
import { variablesIn } from './text';
import type { TemplateChannel, TemplateContent, TemplateType } from './types';

/**
 * What a template may hold, checked when it is saved and again when it is used (a template that is no longer valid, because a
 * version removed what it relied on or the database was edited, is not used: the platform's own is sent instead).
 *
 * Every refusal is a code and a place (`items.list.2.label`), never a sentence: the editor says it in the BDE's language
 * (`templates.errors.<code>`). Nothing here trusts the browser; the server runs the very same function.
 */

/** A template is for one channel or for all of them. */
export type TemplateScope = 'all' | TemplateChannel;

export const TEMPLATE_SCOPES = [
  'all',
  'discord',
  'slack',
  'email',
] as const satisfies readonly TemplateScope[];

export { TEMPLATE_LIMITS };

export interface TemplateIssue {
  /** Where, as the editor names it: `title`, `items.list.2.label`, `button.url`. */
  path: string;
  code: string;
  params?: Record<string, string | number>;
}

export type TemplateValidation =
  { ok: true; value: TemplateContent } | { ok: false; issues: TemplateIssue[] };

const HEX = /^#[0-9a-fA-F]{6}$/;
const CUSTOM_ID = /^text:[a-z0-9]{1,12}$/;
const KEYCAP = /^[0-9#*]️?⃣$/u;

/** One emoji, and nothing else: a picture, a flag or a keycap, however many code points it is made of. */
export function isOneEmoji(value: string): boolean {
  if (value.length === 0 || value.length > 16) return false;
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)];
  if (graphemes.length !== 1) return false;
  return (
    KEYCAP.test(value) ||
    /\p{Extended_Pictographic}/u.test(value) ||
    /\p{Regional_Indicator}/u.test(value)
  );
}

const text = (max: number) => z.string().trim().min(1, 'required').max(max, 'tooLong');
const emoji = z.string().refine((value) => value === '' || isOneEmoji(value), 'notAnEmoji');

const itemSchema = z
  .object({
    id: z.string(),
    enabled: z.boolean(),
    label: text(TEMPLATE_LIMITS.label).optional(),
    emoji: emoji.optional(),
    text: z.string().trim().max(TEMPLATE_LIMITS.freeText, 'tooLong').optional(),
  })
  .strict();

/** The shape of a template, before what depends on its type and its scope. */
const shape = z
  .object({
    eyebrow: text(TEMPLATE_LIMITS.eyebrow).optional(),
    title: text(TEMPLATE_LIMITS.title).optional(),
    emoji: emoji.optional(),
    color: z
      .string()
      .regex(HEX, 'badColor')
      .transform((value) => value.toLowerCase())
      .optional(),
    items: z
      .object({
        order: z.enum(['native', 'custom']),
        list: z.array(itemSchema).max(TEMPLATE_LIMITS.items, 'tooMany'),
      })
      .strict()
      .optional(),
    button: z
      .object({
        enabled: z.boolean().optional(),
        label: text(TEMPLATE_LIMITS.buttonLabel).optional(),
        url: z.string().trim().max(TEMPLATE_LIMITS.buttonUrl, 'tooLong').optional(),
      })
      .strict()
      .optional(),
    above: z.string().trim().max(TEMPLATE_LIMITS.above, 'tooLong').optional(),
    footer: text(TEMPLATE_LIMITS.footer).optional(),
    subject: text(TEMPLATE_LIMITS.subject).optional(),
    preheader: text(TEMPLATE_LIMITS.preheader).optional(),
    note: z.string().trim().max(TEMPLATE_LIMITS.note, 'tooLong').optional(),
  })
  .strict();

/** An address the button may open: https, with a host, no credentials. */
export function isSafeButtonUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' && url.hostname.includes('.') && !url.username && !url.password
    );
  } catch {
    return false;
  }
}

/** The refusals of the shape that have a sentence of their own; any other is just "invalid". */
const SHAPE_CODES: ReadonlySet<string> = new Set([
  'required',
  'tooLong',
  'tooMany',
  'badColor',
  'notAnEmoji',
]);

const BAD_MENTION = /\{@[^{}]*\}/g;

/** The mentions each scope may spell. The ones that need an identifier belong to one platform, so to a template of that channel. */
const MENTIONS_OF: Record<TemplateScope, ReadonlySet<string>> = {
  all: new Set(['everyone', 'here']),
  discord: new Set(['everyone', 'here', 'role', 'user']),
  slack: new Set(['everyone', 'here', 'channel', 'group', 'user']),
  email: new Set(),
};

const PLATFORM_OF: Partial<Record<TemplateScope, 'discord' | 'slack'>> = {
  discord: 'discord',
  slack: 'slack',
};

/** The texts of a template, with the place each is named by and whether it may hold formatting. */
function textsOf(content: TemplateContent): Array<{ path: string; value: string }> {
  const out: Array<{ path: string; value: string }> = [];
  const add = (path: string, value: string | undefined) => {
    if (value !== undefined) out.push({ path, value });
  };
  add('eyebrow', content.eyebrow);
  add('title', content.title);
  add('footer', content.footer);
  add('subject', content.subject);
  add('preheader', content.preheader);
  add('note', content.note);
  add('button.label', content.button?.label);
  content.items?.list.forEach((item, index) => {
    add(`items.list.${index}.label`, item.label);
    add(`items.list.${index}.text`, item.text);
  });
  return out;
}

/**
 * Checks a template for one type and one scope: its shape and limits, then what only the type and the scope know (the facts the type
 * has, the variables it offers, the mentions the scope may spell and the directory knows, the fields only e-mail has).
 * Returns the template cleaned (texts trimmed, colour in lower case), or every problem found.
 */
export function validateTemplate(
  type: TemplateType,
  scope: TemplateScope,
  input: unknown,
  directory: MentionDirectory = {},
): TemplateValidation {
  const parsed = shape.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: SHAPE_CODES.has(issue.message)
          ? issue.message
          : issue.code === 'unrecognized_keys'
            ? 'unknownField'
            : 'invalid',
      })),
    };
  }

  const content = parsed.data as TemplateContent;
  const issues: TemplateIssue[] = [];
  const issue = (path: string, code: string, params?: Record<string, string | number>) =>
    issues.push({ path, code, ...(params && { params }) });

  // Fields that belong to one kind of channel.
  if (scope === 'discord' || scope === 'slack') {
    for (const field of ['subject', 'preheader', 'note'] as const) {
      if (content[field] !== undefined) issue(field, 'emailOnly');
    }
  }
  if (scope === 'email' && content.above !== undefined) issue('above', 'notForEmail');

  // The variables a text may hold, and no mention anywhere but above the card.
  const known = new Set<string>(VARIABLES[type]);
  for (const { path, value } of textsOf(content)) {
    for (const variable of new Set(variablesIn(value))) {
      if (!known.has(variable)) issue(path, 'unknownVariable', { variable });
    }
    if (value.includes('{@')) issue(path, 'mentionNotAllowed');
  }

  if (content.above !== undefined) {
    for (const variable of new Set(variablesIn(content.above))) {
      if (!known.has(variable)) issue('above', 'unknownVariable', { variable });
    }
    const spelled = new Set(mentionsIn(content.above).map((token) => JSON.stringify(token)));
    const written = content.above.match(BAD_MENTION) ?? [];
    if (written.some((piece) => mentionsIn(piece).length === 0)) issue('above', 'badMention');
    for (const raw of spelled) {
      const token = JSON.parse(raw) as { kind: string; key?: string };
      if (scope === 'email') {
        // already said: there is no message above an e-mail
      } else if (!MENTIONS_OF[scope].has(token.kind)) {
        // what needs an identifier belongs to a channel: for all of them it can only be asked to customise one
        issue(
          'above',
          token.key && scope === 'all' ? 'mentionNeedsChannel' : 'mentionNotForChannel',
          {
            mention: token.key ? `${token.kind}:${token.key}` : token.kind,
          },
        );
      } else if (token.key) {
        const platform = PLATFORM_OF[scope];
        const entry = platform ? directory[directoryKey(platform, token.key)] : undefined;
        if (!entry || entry.kind !== (token.kind as MentionKind)) {
          issue('above', 'unknownMention', { mention: `${token.kind}:${token.key}` });
        }
      }
    }
  }

  // The button's own address: https, nothing hidden in it.
  if (content.button?.url !== undefined && !isSafeButtonUrl(content.button.url)) {
    issue('button.url', 'badUrl');
  }

  // The items: the facts the type has, once each, and free texts that say something.
  if (content.items) {
    const facts = new Set<string>(ITEMS[type]);
    const seen = new Set<string>();
    let freeTexts = 0;
    content.items.list.forEach((item, index) => {
      const at = `items.list.${index}`;
      if (seen.has(item.id)) issue(`${at}.id`, 'duplicateItem');
      seen.add(item.id);
      if (CUSTOM_ID.test(item.id)) {
        freeTexts += 1;
        if (!item.text) issue(`${at}.text`, 'required');
      } else if (!facts.has(item.id)) {
        issue(`${at}.id`, 'unknownItem', { item: item.id });
      } else if (item.id !== 'summary' && item.text !== undefined) {
        issue(`${at}.text`, 'textNotAllowed');
      } else if (item.id === 'summary' && item.text !== undefined) {
        if (item.text.length === 0) issue(`${at}.text`, 'required');
        if (item.text.length > TEMPLATE_LIMITS.summary) issue(`${at}.text`, 'tooLong');
      }
      if (CUSTOM_ID.test(item.id) && item.label !== undefined)
        issue(`${at}.label`, 'textNotAllowed');
    });
    if (freeTexts > TEMPLATE_LIMITS.freeTexts) issue('items.list', 'tooManyTexts');
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: content };
}
