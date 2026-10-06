import { describe, expect, it } from 'vitest';
import { discordTime, fitEmbed, type DiscordEmbed } from './discord-embed';

const total = (embed: DiscordEmbed) =>
  Array.from(
    [
      embed.title,
      embed.description,
      embed.footer?.text,
      ...(embed.fields ?? []).flatMap((field) => [field.name, field.value]),
    ].join(''),
  ).length;

describe('discordTime', () => {
  const date = new Date('2026-10-07T18:00:00Z');

  it("writes Discord's date markup, in seconds", () => {
    expect(discordTime(date, 'F')).toBe('<t:1791396000:F>');
    expect(discordTime(date, 'R')).toBe('<t:1791396000:R>');
  });

  it('drops the milliseconds instead of rounding up', () => {
    expect(discordTime(new Date('2026-10-07T18:00:00.999Z'), 't')).toBe('<t:1791396000:t>');
  });
});

describe('fitEmbed', () => {
  it('leaves a small embed as it is', () => {
    const embed: DiscordEmbed = {
      title: 'Titre',
      url: 'https://bde.example/fr/events/1',
      color: 0x123456,
      description: 'Texte',
      fields: [{ name: 'Lieu', value: 'Foyer', inline: true }],
      thumbnail: { url: 'https://cdn.example/a.jpg' },
      footer: { text: 'BDE_Network' },
      timestamp: '2026-10-06T12:00:00.000Z',
    };
    expect(fitEmbed(embed)).toEqual(embed);
  });

  it('cuts every text to its own limit', () => {
    const fitted = fitEmbed({
      title: 'T'.repeat(500),
      description: 'D'.repeat(5000),
      footer: { text: 'F'.repeat(3000) },
      fields: [{ name: 'N'.repeat(400), value: 'V'.repeat(2000) }],
    });

    expect(Array.from(fitted.title ?? '')).toHaveLength(256);
    expect(fitted.footer?.text.length).toBe(2048);
    expect(Array.from(fitted.fields?.[0]?.name ?? '')).toHaveLength(256);
    expect(Array.from(fitted.fields?.[0]?.value ?? '')).toHaveLength(1024);
    expect(fitted.title?.endsWith('…')).toBe(true);
  });

  it('keeps the whole under 6000 characters, giving up the description first', () => {
    const fitted = fitEmbed({
      title: 'T'.repeat(256),
      description: 'D'.repeat(4096),
      fields: Array.from({ length: 5 }, (_, i) => ({
        name: `Champ ${i}`,
        value: 'V'.repeat(1000),
      })),
    });

    expect(total(fitted)).toBeLessThanOrEqual(6000);
    expect(fitted.fields).toHaveLength(5); // the facts stay…
    expect((fitted.description ?? '').length).toBeLessThan(4096); // …the description pays
  });

  it('drops the last fields only once the description is gone', () => {
    const fitted = fitEmbed({
      title: 'Titre',
      description: 'Texte court',
      fields: Array.from({ length: 10 }, (_, i) => ({
        name: `Champ ${i}`,
        value: 'V'.repeat(1000),
      })),
    });

    expect(total(fitted)).toBeLessThanOrEqual(6000);
    expect(fitted.description).toBeUndefined();
    expect(fitted.fields?.[0]?.name).toBe('Champ 0'); // the first ones are the ones kept
    expect((fitted.fields ?? []).length).toBeLessThan(10);
  });

  it('keeps at most 25 fields', () => {
    const fitted = fitEmbed({
      fields: Array.from({ length: 40 }, (_, i) => ({ name: `n${i}`, value: 'v' })),
    });
    expect(fitted.fields).toHaveLength(25);
  });

  it('drops a field with no name or no value, which Discord refuses', () => {
    const fitted = fitEmbed({
      fields: [
        { name: 'Lieu', value: '   ' },
        { name: '', value: 'Foyer' },
        { name: 'Catégorie', value: 'Soirée' },
      ],
    });
    expect(fitted.fields).toEqual([{ name: 'Catégorie', value: 'Soirée' }]);
  });

  it('does not modify the embed it is given', () => {
    const embed: DiscordEmbed = { title: 'T'.repeat(300), fields: [{ name: 'a', value: 'b' }] };
    fitEmbed(embed);
    expect(embed.title).toHaveLength(300);
  });
});
