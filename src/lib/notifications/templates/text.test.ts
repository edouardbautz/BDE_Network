import { describe, expect, it } from 'vitest';
import { renderPlain, renderSegments, toDiscord, toPlainText, toSlack, variablesIn } from './text';

describe('variablesIn', () => {
  it('lists the variables of a text in order, once for each time they are written', () => {
    expect(variablesIn('{title} · {place} · {title}')).toEqual(['title', 'place', 'title']);
  });

  it('does not take a doubled brace, a space or a capital for a variable', () => {
    expect(variablesIn('{{title}} { place } {Title} {}')).toEqual([]);
  });
});

describe('renderPlain', () => {
  it('replaces the variables and nothing else', () => {
    expect(renderPlain('Soirée : {title} à {place}', { title: 'Rentrée', place: 'Foyer' })).toBe(
      'Soirée : Rentrée à Foyer',
    );
  });

  it('writes a variable it does not know as nothing, and an absent value as nothing', () => {
    expect(renderPlain('a{nope}b{place}c', { place: '' })).toBe('abc');
  });

  it('writes a doubled brace as one brace, so a brace can be written', () => {
    expect(renderPlain('{{title}} is {title}', { title: 'X' })).toBe('{title} is X');
  });

  it('never reads what a variable stands for as a variable, a brace or formatting', () => {
    expect(renderPlain('{title}', { title: '{place} {{x}} **b**', place: 'NO' })).toBe(
      '{place} {{x}} **b**',
    );
  });

  it('leaves formatting markers as typed: only the free texts are formatted', () => {
    expect(renderPlain('**{title}**', { title: 'X' })).toBe('**X**');
  });
});

describe('renderSegments', () => {
  const values = { title: 'Rentrée', place: '**Foyer**' };

  it('reads **bold** and _italic_', () => {
    expect(renderSegments('a **b** c _d_ e', values)).toEqual([
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' c ' },
      { text: 'd', italic: true },
      { text: ' e' },
    ]);
  });

  it('formats a variable written inside the markers, as plain text', () => {
    expect(renderSegments('**{title}**', values)).toEqual([{ text: 'Rentrée', bold: true }]);
  });

  it('never formats what a variable stands for', () => {
    const segments = renderSegments('{place}', values);
    expect(segments).toEqual([{ text: '**Foyer**' }]);
  });

  it('keeps a marker that has no partner as typed', () => {
    expect(toPlainText(renderSegments('a **b', values))).toBe('a **b');
    expect(toPlainText(renderSegments('a _b', values))).toBe('a _b');
  });

  it('does not take an underscore inside a word for italic', () => {
    expect(renderSegments('snake_case and other_one', values)).toEqual([
      { text: 'snake_case and other_one' },
    ]);
  });

  it('keeps formatting on its line: a marker does not reach the next line', () => {
    expect(toPlainText(renderSegments('**a\nb**', values))).toBe('**a\nb**');
    expect(renderSegments('**a**\n_b_', values)).toEqual([
      { text: 'a', bold: true },
      { text: '\n' },
      { text: 'b', italic: true },
    ]);
  });

  it('writes bold and italic together', () => {
    expect(renderSegments('**_x_**', values)).toEqual([{ text: 'x', bold: true, italic: true }]);
  });
});

describe('the markup of each channel', () => {
  const segments = renderSegments('a **b** and _c_ and **_d_**', {});

  it('Discord: ** and _', () => {
    expect(toDiscord(segments)).toBe('a **b** and _c_ and **_d_**');
  });

  it('Slack: * for bold and _ for italic', () => {
    expect(toSlack(segments)).toBe('a *b* and _c_ and *_d_*');
  });

  it('puts the spaces outside the markers, which a marker next to a space would not format', () => {
    expect(toDiscord([{ text: ' x ', bold: true }])).toBe(' **x** ');
    expect(toSlack([{ text: ' x ', italic: true }])).toBe(' _x_ ');
  });

  it('writes nothing for a formatted nothing', () => {
    expect(toDiscord([{ text: '', bold: true }])).toBe('');
    expect(toDiscord([{ text: '  ', bold: true }])).toBe('  ');
  });
});
