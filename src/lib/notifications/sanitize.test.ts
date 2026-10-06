import { describe, expect, it } from 'vitest';
import { neutralizeForDiscord, neutralizeForSlack } from './sanitize';

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
