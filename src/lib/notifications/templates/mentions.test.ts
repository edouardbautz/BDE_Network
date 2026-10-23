import { describe, expect, it } from 'vitest';
import {
  ABOVE_LIMIT,
  directoryKey,
  mentionsIn,
  renderAbove,
  type MentionDirectory,
} from './mentions';

const ZWSP = '​';

const DIRECTORY: MentionDirectory = {
  [directoryKey('discord', 'bureau')]: {
    platform: 'discord',
    kind: 'role',
    label: 'Bureau',
    externalId: '123456789012345678',
  },
  [directoryKey('discord', 'paula')]: {
    platform: 'discord',
    kind: 'user',
    label: 'Paula',
    externalId: '223456789012345678',
  },
  [directoryKey('slack', 'bureau')]: {
    platform: 'slack',
    kind: 'group',
    label: 'Bureau',
    externalId: 'S0614TZR7',
  },
  [directoryKey('slack', 'paula')]: {
    platform: 'slack',
    kind: 'user',
    label: 'Paula',
    externalId: 'U012AB3CDE',
  },
};

describe('mentionsIn', () => {
  it('lists the mentions a text spells, and nothing that only looks like one', () => {
    expect(
      mentionsIn('{@everyone} {@role:bureau} {@user:paula} {@group:bureau} {@here} {@channel}'),
    ).toEqual([
      { kind: 'everyone' },
      { kind: 'role', key: 'bureau' },
      { kind: 'user', key: 'paula' },
      { kind: 'group', key: 'bureau' },
      { kind: 'here' },
      { kind: 'channel' },
    ]);
    expect(
      mentionsIn('@everyone <@123> {{@here}} {@role:Bureau} {@role:} {@robot:x} {title}'),
    ).toEqual([]);
  });
});

describe('renderAbove on Discord', () => {
  const render = (source: string, values: Record<string, string> = {}) =>
    renderAbove(source, values, 'discord', DIRECTORY);

  it('writes the mentions the template spells in Discord’s markup, and says whom they may ping', () => {
    const above = render('{@everyone} new event! {@role:bureau} and {@user:paula}');
    expect(above?.text).toBe(
      '@everyone new event! <@&123456789012345678> and <@223456789012345678>',
    );
    expect(above?.mentions).toEqual({
      everyone: true,
      roles: ['123456789012345678'],
      users: ['223456789012345678'],
    });
  });

  it('writes @here the same way, and lets nobody be pinged when there is no mention', () => {
    expect(render('{@here} hello')?.mentions).toEqual({ everyone: true, roles: [], users: [] });
    expect(render('hello')?.mentions).toEqual({ everyone: false, roles: [], users: [] });
  });

  it('defuses a mention that was only typed as text, in the template and in its variables', () => {
    const above = render('@everyone {title} <@123> <@&456> <#789> <!here>', {
      title: '@here @everyone <@999> {@everyone}',
    });
    expect(above?.text).toBe(
      [
        `@${ZWSP}everyone`,
        `@${ZWSP}here @${ZWSP}everyone <${ZWSP}@999> {@${ZWSP}everyone}`,
        `<${ZWSP}@123> <${ZWSP}@&456> <${ZWSP}#789> <${ZWSP}!here>`,
      ].join(' '),
    );
    expect(above?.mentions).toEqual({ everyone: false, roles: [], users: [] });
  });

  it('never reads what a variable stands for as a mention, a variable or a brace', () => {
    const above = render('{title}', { title: '{@role:bureau} {place} {{x}}', place: 'NO' });
    expect(above?.text).toBe('{@role:bureau} {place} {{x}}');
    expect(above?.mentions.roles).toEqual([]);
  });

  it('leaves out a mention the directory does not know, one of the other platform, and one that is not Discord’s', () => {
    const above = render('a {@role:nobody} b {@group:bureau} c {@channel} d {@user:bureau}');
    expect(above?.text).toBe('a  b  c  d');
    expect(above?.mentions).toEqual({ everyone: false, roles: [], users: [] });
  });

  it('lists a mention once, however many times it is written', () => {
    expect(render('{@role:bureau} {@role:bureau}')?.mentions.roles).toEqual(['123456789012345678']);
  });

  it('writes a brace for a doubled brace', () => {
    expect(render('{{x}} {@here}')?.text).toBe('{x} @here');
  });

  it('is nothing at all when nothing is left to say', () => {
    expect(render('')).toBeUndefined();
    expect(render('   ')).toBeUndefined();
    expect(render('{title}')).toBeUndefined();
    expect(render('{@role:nobody}')).toBeUndefined();
    expect(renderAbove(undefined, {}, 'discord')).toBeUndefined();
  });

  it('stays within the limit of a message, never cutting a mention in two', () => {
    const above = render(`${'a'.repeat(ABOVE_LIMIT - 5)}{@role:bureau}`);
    expect(Array.from(above!.text).length).toBeLessThanOrEqual(ABOVE_LIMIT);
    expect(above!.text).not.toContain('<@&');
    // the mention was cut away: it can no longer ping
    expect(above!.mentions.roles).toEqual([]);

    const long = render(`{@here} ${'b'.repeat(ABOVE_LIMIT * 2)}`);
    expect(Array.from(long!.text).length).toBeLessThanOrEqual(ABOVE_LIMIT);
    expect(long!.text.startsWith('@here ')).toBe(true);
    expect(long!.mentions.everyone).toBe(true);
  });

  it('does not let a variable make a mention out of its own text, even one that looks like Discord’s markup', () => {
    const above = render('x{title}y', { title: '<@&123456789012345678>' });
    expect(above?.text).toBe(`x<${ZWSP}@&123456789012345678>y`);
    expect(above?.mentions.roles).toEqual([]);
  });
});

describe('renderAbove on Slack', () => {
  const render = (source: string, values: Record<string, string> = {}) =>
    renderAbove(source, values, 'slack', DIRECTORY);

  it('writes the mentions the template spells in Slack’s markup', () => {
    expect(render('{@channel} {@here} {@everyone} {@group:bureau} {@user:paula}')?.text).toBe(
      '<!channel> <!here> <!everyone> <!subteam^S0614TZR7> <@U012AB3CDE>',
    );
  });

  it('escapes what Slack would read as markup in the template and in its variables, and defuses the broadcast words', () => {
    const above = render('a <!channel> & <@U1> {title}', {
      title: '<!here> @channel <https://evil|x>',
    });
    expect(above?.text).toBe(
      `a &lt;!channel&gt; &amp; &lt;@U1&gt; &lt;!here&gt; @${ZWSP}channel &lt;https://evil|x&gt;`,
    );
  });

  it('leaves out a role (Discord’s), a mention of the other platform and an unknown group', () => {
    expect(render('a {@role:bureau} b {@group:nobody} c {@user:nobody}')?.text).toBe('a  b  c');
  });
});
