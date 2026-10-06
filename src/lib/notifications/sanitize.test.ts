import { describe, expect, it } from 'vitest';
import {
  defuseMentions,
  neutralizeEmbedForDiscord,
  neutralizeForDiscord,
  neutralizeForSlack,
} from './sanitize';

const ZWSP = String.fromCharCode(0x200b);

describe('neutralizeForDiscord', () => {
  it.each(['@everyone', '@here', '@EVERYONE', '@Here'])('defuses %s', (mention) => {
    const out = neutralizeForDiscord(`Bonjour ${mention} !`);

    expect(out).not.toContain(mention);
    expect(out.replace(ZWSP, '')).toBe(`Bonjour ${mention} !`);
  });

  it('defuses every occurrence, in the middle of a word boundary only', () => {
    expect(neutralizeForDiscord('@here @here')).toBe(`@${ZWSP}here @${ZWSP}here`);
    // "@everyones" is not the broadcast mention: left alone.
    expect(neutralizeForDiscord('@everyones')).toBe('@everyones');
  });

  it.each(['<@123456789>', '<@&987654321>', '<#555>', '<!channel>'])(
    'breaks the mention syntax %s',
    (syntax) => {
      expect(neutralizeForDiscord(syntax)).not.toContain(syntax);
    },
  );

  it('leaves ordinary text, including a plain e-mail address, alone', () => {
    expect(neutralizeForDiscord('Soirée jeux — salle B, contact jean@exemple.fr')).toBe(
      'Soirée jeux — salle B, contact jean@exemple.fr',
    );
  });
});

describe('neutralizeForSlack', () => {
  it.each(['<!channel>', '<!here>', '<!everyone>', '<!subteam^S123>', '<@U123>', '<#C123>'])(
    'turns %s into plain text',
    (syntax) => {
      const out = neutralizeForSlack(`a ${syntax} b`);

      expect(out).not.toContain('<');
      expect(out).not.toContain('>');
      expect(out).toContain('&lt;');
    },
  );

  it('escapes links and ampersands the way Slack asks', () => {
    expect(neutralizeForSlack('<https://evil.example|click> & co')).toBe(
      '&lt;https://evil.example|click&gt; &amp; co',
    );
  });

  it('defuses @channel, @here and @everyone written as plain words', () => {
    for (const word of ['@channel', '@here', '@everyone']) {
      expect(neutralizeForSlack(word)).not.toBe(word);
    }
  });

  it('leaves a normal sentence alone', () => {
    expect(neutralizeForSlack('Réunion jeudi à 18h')).toBe('Réunion jeudi à 18h');
  });
});

describe('neutralizeEmbedForDiscord', () => {
  const hostile = '@everyone @here <@1> <!channel>';

  it('defuses every text a member could have written in a card', () => {
    const out = neutralizeEmbedForDiscord({
      title: hostile,
      description: hostile,
      footer: { text: hostile },
      fields: [{ name: hostile, value: hostile, inline: true }],
    });

    const texts = [
      out.title,
      out.description,
      out.footer?.text,
      out.fields?.[0]?.name,
      out.fields?.[0]?.value,
    ];
    for (const text of texts) {
      expect(text).not.toContain('@everyone');
      expect(text).not.toContain('@here');
      expect(text).not.toContain('<@');
      expect(text).not.toContain('<!');
    }
    expect(out.fields?.[0]?.inline).toBe(true);
  });

  it('keeps the link, the colour, the thumbnail, the timestamp and the column layout', () => {
    const embed = {
      title: 'T',
      url: 'https://bde.example.fr/fr/events/1',
      color: 0x123456,
      thumbnail: { url: 'https://cdn.example/a.jpg' },
      timestamp: '2026-10-06T12:00:00.000Z',
      fields: [{ name: 'Lieu', value: 'Foyer', inline: true }],
    };

    expect(neutralizeEmbedForDiscord(embed)).toEqual(embed);
  });

  it("does not touch Discord's date markup, written by the platform", () => {
    const out = neutralizeEmbedForDiscord({
      fields: [{ name: 'Quand', value: '<t:1791396000:F>' }],
    });
    expect(out.fields?.[0]?.value).toBe('<t:1791396000:F>');
  });

  it('adds no text to a card that had none', () => {
    expect(neutralizeEmbedForDiscord({ color: 1 })).toEqual({ color: 1 });
  });
});

describe('defuseMentions', () => {
  it.each(['@everyone', '@here', '@channel', '@EVERYONE', '@Here'])('defuses %s', (mention) => {
    const out = defuseMentions(`Bonjour ${mention} !`);
    expect(out).not.toContain(mention);
    expect(out.replace(ZWSP, '')).toBe(`Bonjour ${mention} !`);
  });

  it('leaves the other forms alone, and ordinary text, e-mail addresses and handles', () => {
    expect(defuseMentions('<!channel> <@U1> a@b.fr @paula @herein')).toBe(
      '<!channel> <@U1> a@b.fr @paula @herein',
    );
  });
});
