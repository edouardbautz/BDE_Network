import { describe, expect, it } from 'vitest';
import { ZERO_WIDTH_SPACE } from './sanitize';
import {
  fitSlackPayload,
  neutralizeSlackMrkdwn,
  slackButton,
  slackDate,
  slackFooter,
  truncateMrkdwn,
  type SlackBlock,
  type SlackPayload,
} from './slack-blocks';

const ZW = ZERO_WIDTH_SPACE;

const payload = (blocks: SlackBlock[], over: Partial<SlackPayload> = {}): SlackPayload => ({
  fallback: 'Résumé',
  color: '#db2777',
  blocks,
  ...over,
});
const section = (text: string): SlackBlock => ({
  type: 'section',
  text: { type: 'mrkdwn', text },
});
const fit = (blocks: SlackBlock[], over: Partial<SlackPayload> = {}) =>
  fitSlackPayload(payload(blocks, over));

describe('slackDate', () => {
  const date = new Date('2026-10-10T18:00:00Z');

  it("writes Slack's date markup, in seconds, with a fallback for clients that cannot render it", () => {
    expect(slackDate(date, '{date_long_pretty} {time}', 'samedi 10 octobre 2026 à 20:00')).toBe(
      '<!date^1791655200^{date_long_pretty} {time}|samedi 10 octobre 2026 à 20:00>',
    );
    expect(slackDate(date, '{time}', '20:00')).toBe('<!date^1791655200^{time}|20:00>');
    expect(slackDate(date, '{date_long}', '10 octobre 2026')).toBe(
      '<!date^1791655200^{date_long}|10 octobre 2026>',
    );
  });

  it('drops the milliseconds instead of rounding up', () => {
    expect(slackDate(new Date('2026-10-10T18:00:00.999Z'), '{time}', 'x')).toBe(
      '<!date^1791655200^{time}|x>',
    );
  });

  it('cannot be broken out of through its fallback', () => {
    const markup = slackDate(date, '{time}', 'a|b>c<d');
    expect(markup).toBe('<!date^1791655200^{time}|a b c d>');
  });
});

describe('neutralizeSlackMrkdwn', () => {
  it('leaves the date markup the platform writes, and ordinary text, alone', () => {
    const text =
      '*Quand*\n<!date^1791655200^{date_long_pretty} {time}|samedi> → <!date^1^{time}|20:00>';
    expect(neutralizeSlackMrkdwn(text)).toBe(text);
    expect(neutralizeSlackMrkdwn('Soirée à 20h, salle B (5 €)')).toBe(
      'Soirée à 20h, salle B (5 €)',
    );
  });

  it.each([
    '<!channel>',
    '<!here>',
    '<!everyone>',
    '<!subteam^S123>',
    '<@U12345>',
    '<@U12345|name>',
    '<#C123>',
    '<#C123|general>',
    '<https://evil.example|cliquez>',
    '<https://evil.example>',
    '<mailto:a@b.fr|écrire>',
    '<b>',
  ])('turns %s into plain text', (markup) => {
    const out = neutralizeSlackMrkdwn(`avant ${markup} après`);
    expect(out).not.toContain(markup);
    expect(out).toContain('&lt;');
    expect(out).toContain('&gt;');
  });

  it('turns a stray < or > into plain text, so no markup can be started', () => {
    expect(neutralizeSlackMrkdwn('a < b > c')).toBe('a &lt; b &gt; c');
    expect(neutralizeSlackMrkdwn('<!channel')).toBe('&lt;!channel');
  });

  it('refuses a date that is not written the way the platform writes it', () => {
    for (const forged of [
      '<!date^1^{date}|x>',
      '<!date^abc^{time}|x>',
      '<!date^1^{time}|x<y>',
      '<!date^1^{time}>',
      '<!date^1^{time} <!channel>|x>',
      '<!date^1^{time}|a|b>', // a fallback holds no | of its own
    ]) {
      expect(neutralizeSlackMrkdwn(forged)).not.toBe(forged);
    }
  });

  it('defuses @channel, @here and @everyone written as plain words, in any case', () => {
    for (const word of ['@channel', '@here', '@everyone', '@EVERYONE', '@Here']) {
      const out = neutralizeSlackMrkdwn(`salut ${word} !`);
      expect(out).not.toContain(word);
      expect(out.replace(ZW, '')).toBe(`salut ${word} !`);
    }
  });
});

describe('truncateMrkdwn', () => {
  it('leaves a text that fits', () => {
    expect(truncateMrkdwn('abc', 3)).toBe('abc');
  });

  it('cuts with an ellipsis, to at most the limit', () => {
    const out = truncateMrkdwn('abcdefghij', 5);
    expect(out).toBe('abcd…');
    expect(Array.from(out)).toHaveLength(5);
  });

  it('never leaves half an entity at the cut', () => {
    // The cut lands after "a &am": the entity is dropped whole.
    expect(truncateMrkdwn('a &amp; b', 7)).toBe('a…');
    expect(truncateMrkdwn('a &amp; bcdef', 9)).toBe('a &amp;…');
  });

  it('never leaves half a piece of markup at the cut', () => {
    const text = 'Quand <!date^1791655200^{date_long_pretty} {time}|samedi> fin';
    const out = truncateMrkdwn(text, 25);
    expect(out).toBe('Quand…');
    expect(out).not.toContain('<');
  });

  it('keeps a complete markup that ends before the cut', () => {
    const out = truncateMrkdwn('<!date^1^{time}|20:00> et beaucoup de texte derrière', 30);
    expect(out.startsWith('<!date^1^{time}|20:00>')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('fitSlackPayload: what is posted', () => {
  it('keeps the colour and a plain summary, and the blocks in order', () => {
    const out = fit([
      { type: 'header', text: { type: 'plain_text', text: 'Titre' } },
      section('Corps'),
    ]);
    expect(out.color).toBe('#db2777');
    expect(out.fallback).toBe('Résumé');
    expect(out.blocks.map((block) => block.type)).toEqual(['header', 'section']);
  });

  it('does not modify the payload it is given', () => {
    const original = payload([section('<!channel>')]);
    const copy = JSON.parse(JSON.stringify(original));
    fitSlackPayload(original);
    expect(original).toEqual(copy);
  });

  it('keeps at most 50 blocks', () => {
    const out = fit(Array.from({ length: 60 }, (_, i) => section(`bloc ${i}`)));
    expect(out.blocks).toHaveLength(50);
    expect(out.blocks[0]).toMatchObject({ text: { text: 'bloc 0' } });
  });
});

describe('fitSlackPayload: the summary for notifications', () => {
  it('is plain text: nothing is escaped, so "&" and "<" read as typed', () => {
    expect(fit([section('x')], { fallback: 'Fête & Co : a < b' }).fallback).toBe(
      'Fête & Co : a < b',
    );
  });

  it('is cut to 300 characters with an ellipsis', () => {
    const out = fit([section('x')], { fallback: 'y'.repeat(1000) }).fallback;
    expect(Array.from(out)).toHaveLength(300);
    expect(out.endsWith('…')).toBe(true);
    expect(fit([section('x')], { fallback: 'z'.repeat(300) }).fallback).toBe('z'.repeat(300));
  });

  it('cannot ping anyone: broadcast words and mention forms are broken', () => {
    const out = fit([section('x')], {
      fallback: '@channel @here @everyone <!channel> <@U123> <#C123>',
    }).fallback;
    for (const bad of ['@channel', '@here', '@everyone', '<!channel', '<@U', '<#C']) {
      expect(out).not.toContain(bad);
    }
    expect(out.replace(new RegExp(ZW, 'g'), '')).toBe(
      '@channel @here @everyone <!channel> <@U123> <#C123>',
    );
  });
});

describe('fitSlackPayload: the header', () => {
  const header = (text: string): SlackBlock => ({
    type: 'header',
    text: { type: 'plain_text', text },
  });

  it('is cut to 150 characters', () => {
    const out = fit([header('T'.repeat(400))]).blocks[0];
    expect(out?.type === 'header' && Array.from(out.text.text)).toHaveLength(150);
    expect(out?.type === 'header' && out.text.text.endsWith('…')).toBe(true);
  });

  it('stays plain text, with every mention form broken', () => {
    const out = fit([header('Fête @everyone <!channel> <@U1> <#C1> <https://x.example|y>')])
      .blocks[0];
    if (out?.type !== 'header') throw new Error('no header');
    expect(out.text.type).toBe('plain_text');
    for (const bad of ['@everyone', '<!channel', '<@U1', '<#C1']) {
      expect(out.text.text).not.toContain(bad);
    }
  });

  it('is dropped when empty, which Slack refuses', () => {
    expect(fit([header('')]).blocks).toEqual([]);
  });
});

describe('fitSlackPayload: sections', () => {
  it('neutralizes the text, whoever wrote it', () => {
    const out = fit([section('<!channel> <@U1> @here')]).blocks[0];
    const text = out?.type === 'section' ? (out.text?.text ?? '') : '';
    expect(text).not.toContain('<!channel>');
    expect(text).not.toContain('<@U1>');
    expect(text).not.toContain('@here');
  });

  it('cuts the text to 3000 characters, never mid-entity', () => {
    const out = fit([section('x'.repeat(5000))]).blocks[0];
    expect(out?.type === 'section' && Array.from(out.text?.text ?? '')).toHaveLength(3000);
  });

  it('keeps at most 10 fields, each cut to 2000 characters, and the empty ones are dropped', () => {
    const fields = [
      { type: 'mrkdwn' as const, text: '   ' }, // first, so it is not cut away by the limit of 10
      ...Array.from({ length: 12 }, (_, i) => ({ type: 'mrkdwn' as const, text: `champ ${i}` })),
    ];
    const out = fit([{ type: 'section', fields }]).blocks[0];
    if (out?.type !== 'section') throw new Error('no section');
    expect(out.fields).toHaveLength(10);
    expect(out.fields?.[0]?.text).toBe('champ 0'); // the blank one did not take a place

    const long = fit([{ type: 'section', fields: [{ type: 'mrkdwn', text: 'y'.repeat(3000) }] }])
      .blocks[0];
    expect(long?.type === 'section' && Array.from(long.fields?.[0]?.text ?? '')).toHaveLength(2000);
  });

  it('is dropped when it has no text and no field, which Slack refuses', () => {
    expect(fit([section('   '), { type: 'section', fields: [] }]).blocks).toEqual([]);
  });

  it('keeps a section that has only fields, or only a text', () => {
    const out = fit([
      { type: 'section', fields: [{ type: 'mrkdwn', text: 'a' }] },
      section('b'),
    ]).blocks;
    expect(out).toHaveLength(2);
    expect(out[0]).not.toHaveProperty('text');
    expect(out[1]).not.toHaveProperty('fields');
  });

  it('keeps the photo beside the text, only for an http(s) address', () => {
    const photo = (url: string): SlackBlock => ({
      type: 'section',
      text: { type: 'mrkdwn', text: 'x' },
      accessory: { type: 'image', image_url: url, alt_text: 'Camille' },
    });
    const kept = fit([photo('https://cdn.intra.42.fr/u.jpg')]).blocks[0];
    expect(kept?.type === 'section' && kept.accessory?.image_url).toBe(
      'https://cdn.intra.42.fr/u.jpg',
    );

    for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'not a url', '']) {
      const dropped = fit([photo(bad)]).blocks[0];
      expect(dropped).not.toHaveProperty('accessory');
    }
  });

  it('cuts the alternative text of a picture to 2000 characters', () => {
    const out = fit([
      {
        type: 'section',
        text: { type: 'mrkdwn', text: 'x' },
        accessory: {
          type: 'image',
          image_url: 'https://a.example/p.png',
          alt_text: 'n'.repeat(3000),
        },
      },
    ]).blocks[0];
    expect(out?.type === 'section' && Array.from(out.accessory?.alt_text ?? '')).toHaveLength(2000);
  });
});

describe('fitSlackPayload: context blocks (the footer)', () => {
  it('keeps the logo and the text, in this order', () => {
    const out = fit([slackFooter({ name: 'BDE Nice', logoUrl: 'https://bde.example.fr/logo.png' })])
      .blocks[0];
    if (out?.type !== 'context') throw new Error('no context');
    expect(out.elements.map((element) => element.type)).toEqual(['image', 'mrkdwn']);
  });

  it('drops a logo that is not an http(s) address, and keeps the text', () => {
    const out = fit([slackFooter({ name: 'BDE Nice', logoUrl: 'javascript:alert(1)' })]).blocks[0];
    if (out?.type !== 'context') throw new Error('no context');
    expect(out.elements.map((element) => element.type)).toEqual(['mrkdwn']);
  });

  it('is dropped when nothing is left in it', () => {
    expect(fit([{ type: 'context', elements: [{ type: 'mrkdwn', text: '  ' }] }]).blocks).toEqual(
      [],
    );
  });

  it('keeps at most 10 elements', () => {
    const elements = Array.from({ length: 14 }, (_, i) => ({
      type: 'mrkdwn' as const,
      text: `e${i}`,
    }));
    const out = fit([{ type: 'context', elements }]).blocks[0];
    expect(out?.type === 'context' && out.elements).toHaveLength(10);
  });

  it('neutralizes the text of an element', () => {
    const out = fit([{ type: 'context', elements: [{ type: 'mrkdwn', text: '<!channel> @here' }] }])
      .blocks[0];
    const text =
      out?.type === 'context' && out.elements[0]?.type === 'mrkdwn' ? out.elements[0].text : '';
    expect(text).not.toContain('<!channel>');
    expect(text).not.toContain('@here');
  });
});

describe('fitSlackPayload: buttons', () => {
  it('keeps a button to an http(s) address, its label cut to 75 characters', () => {
    const out = fit([slackButton('L'.repeat(200), 'https://bde.example.fr/fr/events/1')]).blocks[0];
    if (out?.type !== 'actions') throw new Error('no actions');
    expect(out.elements[0]?.url).toBe('https://bde.example.fr/fr/events/1');
    expect(Array.from(out.elements[0]?.text.text ?? '')).toHaveLength(75);
  });

  it('drops a button whose address is not http(s), and the block with it', () => {
    for (const bad of ['javascript:alert(1)', 'slack://open', '', 'not a url']) {
      expect(fit([slackButton('Voir', bad)]).blocks).toEqual([]);
    }
  });

  it('keeps a label as plain text, with the mention forms broken', () => {
    const out = fit([slackButton('<!channel> @here', 'https://bde.example.fr/x')]).blocks[0];
    if (out?.type !== 'actions') throw new Error('no actions');
    expect(out.elements[0]?.text.type).toBe('plain_text');
    expect(out.elements[0]?.text.text).not.toContain('@here');
    expect(out.elements[0]?.text.text).not.toContain('<!channel');
  });
});

describe('slackFooter and slackButton', () => {
  it("name the BDE, then the platform, with the BDE's name escaped", () => {
    const block = slackFooter({ name: 'BDE <!channel> & Co' });
    expect(block).toEqual({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `BDE &lt;!channel&gt; &amp; Co · BDE_Network` }],
    });
  });

  it('show the logo before the text when there is one', () => {
    const block = slackFooter({ name: 'BDE Nice', logoUrl: 'https://bde.example.fr/logo.png' });
    expect(block.type === 'context' && block.elements[0]).toEqual({
      type: 'image',
      image_url: 'https://bde.example.fr/logo.png',
      alt_text: 'BDE Nice',
    });
  });

  it('make a button that opens the address', () => {
    expect(slackButton('Voir', 'https://x.example/p')).toEqual({
      type: 'actions',
      elements: [
        { type: 'button', text: { type: 'plain_text', text: 'Voir' }, url: 'https://x.example/p' },
      ],
    });
  });
});
