import { describe, expect, it } from 'vitest';
import fr from '../../../messages/fr.json';
import { fitSlackPayload, type SlackBlock } from '@/lib/notifications/slack-blocks';
import { buildEventSlack } from './slack-blocks';
import type { NotificationEventData, Translate } from './messages';

/** The real French catalog: a missing message fails the test. */
const t: Translate = (key, values = {}) => {
  const text = key
    .split('.')
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown>)?.[part],
      fr.events.notifications,
    );
  if (typeof text !== 'string') throw new Error(`missing message ${key}`);
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));
};

const PARIS = 'Europe/Paris';
const brand = { name: 'BDE Nice', logoUrl: 'https://bde.example.fr/logo.png' };

const data: NotificationEventData = {
  eventId: 'evt1',
  title: 'Soirée de rentrée',
  description: 'DJ set et buffet.',
  location: 'Foyer du campus',
  categoryLabel: 'Soirée',
  categoryColor: '#db2777',
  assigneeNames: ['Paula', 'Sam'],
  start: new Date('2026-10-10T18:00:00Z'),
  end: new Date('2026-10-10T21:30:00Z'),
  recurrence: 'NONE',
  recurrenceUntil: null,
  url: 'https://bde.example.fr/fr/events/evt1?occ=1',
};

const build = (
  over: Partial<NotificationEventData> = {},
  kind: 'confirmed' | 'tomorrow' | 'today' = 'confirmed',
  b: { name: string; logoUrl?: string } = brand,
) => buildEventSlack(kind, { ...data, ...over }, t, 'fr', PARIS, b);

const types = (blocks: SlackBlock[]) => blocks.map((block) => block.type);
const sections = (blocks: SlackBlock[]) =>
  blocks.flatMap((block) => (block.type === 'section' ? [block] : []));
/** Every text of the blocks, in one string. */
const allText = (blocks: SlackBlock[]) => JSON.stringify(blocks);
const fieldTexts = (blocks: SlackBlock[]) =>
  sections(blocks).flatMap((block) => block.fields?.map((field) => field.text) ?? []);

describe('buildEventSlack', () => {
  it('has the colour of the category on the bar', () => {
    expect(build().color).toBe('#db2777');
    expect(build({ categoryColor: '#16A34A' }).color).toBe('#16a34a');
  });

  it('uses the neutral grey for a category that has no colour any more', () => {
    expect(build({ categoryColor: null }).color).toBe('#6b7280');
  });

  it('lays the blocks out in this order: kind, title, description, when, facts, button, footer', () => {
    expect(types(build().blocks)).toEqual([
      'context',
      'header',
      'section',
      'section',
      'section',
      'actions',
      'context',
    ]);
  });

  it('names the kind of message above the title, in bold', () => {
    const [first] = build().blocks;
    expect(first).toEqual({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '*Nouvel événement confirmé*' }],
    });
    expect(allText([build({}, 'tomorrow').blocks[0]!])).toContain('Rappel · demain');
    expect(allText([build({}, 'today').blocks[0]!])).toContain("Rappel · aujourd'hui");
  });

  it('puts the title in the header, as plain text', () => {
    expect(build().blocks[1]).toEqual({
      type: 'header',
      text: { type: 'plain_text', text: 'Soirée de rentrée' },
    });
  });

  it('shows the description, cut at 350 characters with an ellipsis', () => {
    expect(sections(build().blocks)[0]?.text?.text).toBe('DJ set et buffet.');

    const long = sections(build({ description: 'x'.repeat(1500) }).blocks)[0]?.text?.text ?? '';
    expect(Array.from(long)).toHaveLength(350);
    expect(long.endsWith('…')).toBe(true);
    expect(sections(build({ description: 'y'.repeat(350) }).blocks)[0]?.text?.text).toBe(
      'y'.repeat(350),
    );
  });

  it('has no description section without a description', () => {
    expect(types(build({ description: null }).blocks)).toEqual([
      'context',
      'header',
      'section',
      'section',
      'actions',
      'context',
    ]);
    expect(types(build({ description: '   ' }).blocks)).not.toContain('description');
    expect(sections(build({ description: '   ' }).blocks)).toHaveLength(2);
  });

  it("writes the dates in Slack's markup, so each reader sees their own time zone", () => {
    const when = sections(build().blocks).find((block) => block.text?.text.startsWith('*Quand*'));
    expect(when?.text?.text).toBe(
      '*Quand*\n<!date^1791655200^{date_long_pretty} {time}|samedi 10 octobre 2026 à 20:00> → <!date^1791667800^{time}|23:30>',
    );
  });

  it('writes the end as a full date when the event ends another day, judged on the BDE wall clock', () => {
    const overnight = build({ end: new Date('2026-10-11T01:00:00Z') });
    const text = sections(overnight.blocks).find((b) => b.text?.text.startsWith('*Quand*'))?.text
      ?.text;
    expect(text).toContain(
      '→ <!date^1791680400^{date_long_pretty} {time}|dimanche 11 octobre 2026 à 03:00>',
    );

    // 22:30 → 00:30 Paris: the same day in UTC, two days on the wall clock.
    const late = build({
      start: new Date('2026-10-10T20:30:00Z'),
      end: new Date('2026-10-10T22:30:00Z'),
    });
    expect(allText(late.blocks)).toContain('→ <!date^1791671400^{date_long_pretty} {time}|');
  });

  it('shows place, category and people in charge as columns, in this order', () => {
    expect(fieldTexts(build().blocks)).toEqual([
      '*Lieu*\nFoyer du campus',
      '*Catégorie*\nSoirée',
      '*Membres en charge*\nPaula, Sam',
    ]);
  });

  it('leaves out the place and the people in charge when there are none', () => {
    expect(fieldTexts(build({ location: null, assigneeNames: [] }).blocks)).toEqual([
      '*Catégorie*\nSoirée',
    ]);
  });

  it('says how a series repeats, in the short form, with its end date as Slack markup', () => {
    const until = new Date('2026-12-17T16:30:00Z');
    const weekly = fieldTexts(build({ recurrence: 'WEEKLY', recurrenceUntil: until }).blocks);
    expect(weekly.at(-1)).toBe(
      "*Répétition*\nChaque semaine, jusqu'au <!date^1797525000^{date_long}|17 décembre 2026>",
    );
    expect(
      fieldTexts(build({ recurrence: 'BIWEEKLY', recurrenceUntil: until }).blocks).at(-1),
    ).toContain('Toutes les 2 semaines');
    expect(
      fieldTexts(build({ recurrence: 'MONTHLY', recurrenceUntil: until }).blocks).at(-1),
    ).toContain('Chaque mois');
  });

  it('says nothing of repetition for a one-off event, or a series with no end date', () => {
    expect(fieldTexts(build().blocks).join()).not.toContain('Répétition');
    expect(
      fieldTexts(build({ recurrence: 'WEEKLY', recurrenceUntil: null }).blocks).join(),
    ).not.toContain('Répétition');
  });

  it('has a button to the event, and none without APP_URL', () => {
    const button = build().blocks.find((block) => block.type === 'actions');
    expect(button).toEqual({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: "Voir l'événement" },
          url: 'https://bde.example.fr/fr/events/evt1?occ=1',
        },
      ],
    });
    expect(types(build({ url: null }).blocks)).not.toContain('actions');
  });

  it('ends with the BDE logo and name, then the platform name', () => {
    expect(build().blocks.at(-1)).toEqual({
      type: 'context',
      elements: [
        { type: 'image', image_url: 'https://bde.example.fr/logo.png', alt_text: 'BDE Nice' },
        { type: 'mrkdwn', text: 'BDE Nice · BDE_Network' },
      ],
    });
  });

  it('has the name alone in the footer when the logo cannot be shown', () => {
    expect(build({}, 'confirmed', { name: 'BDE Nice' }).blocks.at(-1)).toEqual({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: 'BDE Nice · BDE_Network' }],
    });
  });

  it('gives the summary for notifications: kind, title, when and place, as plain text', () => {
    expect(build().fallback).toBe(
      'Nouvel événement confirmé : Soirée de rentrée — samedi 10 octobre 2026 à 20:00 → 23:30 · Foyer du campus',
    );
    expect(build({ location: null }).fallback).not.toContain('·');
    expect(build({}, 'today').fallback.startsWith("Rappel · aujourd'hui : ")).toBe(true);
  });

  it('keeps the summary short: a long title and place are cut', () => {
    const { fallback } = build({ title: 'T'.repeat(500), location: 'L'.repeat(500) });
    expect(fallback).toContain(`${'T'.repeat(119)}…`);
    expect(fallback).toContain(`${'L'.repeat(59)}…`);
  });

  it('writes the summary as typed, not escaped: it is plain text', () => {
    expect(build({ title: 'Fête & Co <3' }).fallback).toContain('Fête & Co <3');
  });

  it('is in the language it is given', async () => {
    const en = (await import('../../../messages/en.json')).default;
    const tEn: Translate = (key, values = {}) => {
      const text = key
        .split('.')
        .reduce<unknown>(
          (node, part) => (node as Record<string, unknown>)?.[part],
          en.events.notifications,
        );
      if (typeof text !== 'string') throw new Error(`missing message ${key}`);
      return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));
    };
    const out = buildEventSlack(
      'today',
      { ...data, recurrence: 'WEEKLY', recurrenceUntil: new Date('2026-12-17T16:30:00Z') },
      tEn,
      'en',
      PARIS,
      brand,
    );

    expect(allText(out.blocks)).toContain('Reminder · today');
    expect(allText(out.blocks)).toContain('*When*');
    expect(allText(out.blocks)).toContain(
      'Every week, until <!date^1797525000^{date_long}|December 17, 2026>',
    );
    expect(allText(out.blocks)).toContain('View the event');
  });
});

describe('buildEventSlack: what members typed', () => {
  const hostile = '<!channel> <@U123> <#C1> <https://evil.example|ici> @everyone @here & <b>';

  it('turns every mention and link of the description, place, category and people into text', () => {
    const out = build({
      description: hostile,
      location: hostile,
      categoryLabel: hostile,
      assigneeNames: [hostile],
    });

    const text = JSON.stringify(
      sections(out.blocks).map((block) => [
        block.text?.text,
        ...(block.fields?.map((f) => f.text) ?? []),
      ]),
    );
    for (const bad of ['<!channel>', '<@U123>', '<#C1>', '<https', '@everyone', '@here']) {
      expect(text).not.toContain(bad);
    }
    expect(text).toContain('&lt;!channel&gt;');
    expect(text).toContain('&amp;');
  });

  it('cannot forge a date: what a member types is escaped before the platform writes its own', () => {
    const out = build({ description: '<!date^1^{date}|piège>', location: '<!date^1^{time}|x>' });
    const text = allText(out.blocks);

    expect(text).not.toContain('<!date^1^');
    expect(text.match(/<!date\^/g)).toHaveLength(2); // only the two the platform wrote (start, end)
  });

  it('cuts a long place before escaping it, so the adapter never has to cut in the middle of an escape', () => {
    // 400 "&" are 2000 characters once escaped: with the label, over Slack's limit for a field.
    const [place] = fieldTexts(fitSlackPayload(build({ location: '&'.repeat(1000) })).blocks);

    expect(Array.from(place ?? '').length).toBeLessThanOrEqual(2000);
    expect(place).not.toMatch(/&[a-z]*…$/);
    expect(place?.endsWith('…')).toBe(true);
  });

  it('keeps the title as plain text, where Slack acts on nothing', () => {
    const [, header] = build({ title: hostile }).blocks;
    expect(header).toEqual({ type: 'header', text: { type: 'plain_text', text: hostile } });
  });
});
