import { beforeAll, describe, expect, it } from 'vitest';
import type { SlackBlock } from '@/lib/notifications/slack-blocks';
import type {
  TemplateContent,
  TemplateContext,
  TemplateItem,
} from '@/lib/notifications/templates/types';
import { getNotificationTranslate, type Translate } from '@/lib/notifications/translate';
import { buildMemberEmbed } from './discord-embed';
import { buildApprovedEmail, buildPendingEmail } from './email';
import type { MemberFacts } from './messages';
import { buildMemberSlack } from './slack-blocks';

/**
 * What each field of a template changes in the notifications about members, channel by channel, including what a template leaves
 * out, what comes out empty, and what a member does not have. (The default rendering is held by `notifications/golden.test.ts`.)
 */

const NOW = new Date('2026-10-08T12:00:00Z');
const BRAND = { name: 'BDE Nice', accent: '#2f5bea' };
const URL = 'https://bde.example.fr/en/members';
const MEMBER: MemberFacts = {
  login: 'cmartin',
  fullName: 'Camille Martin',
  campus: 'Nice',
  photoUrl: 'https://cdn.intra.42.fr/users/cmartin.jpg',
  roleName: 'Treasurer',
  actorName: 'Paula Martin',
};

let t: Translate;
beforeAll(async () => {
  t = await getNotificationTranslate('en', 'members.notifications');
});

const on = (id: TemplateItem['id'], more: Partial<TemplateItem> = {}): TemplateItem => ({
  id,
  enabled: true,
  ...more,
});
const ctx = (template: TemplateContent): TemplateContext => ({
  template,
  bdeName: 'BDE Nice',
  locale: 'en',
});
const items = (order: 'native' | 'custom', ...list: TemplateItem[]): TemplateContent => ({
  items: { order, list },
});
const sections = (blocks: SlackBlock[]) =>
  blocks.flatMap((block) => (block.type === 'section' && block.text ? [block.text.text] : []));
const columns = (blocks: SlackBlock[]) =>
  blocks.flatMap((block) =>
    block.type === 'section' && block.fields ? block.fields.map((field) => field.text) : [],
  );

describe('the Discord card of a member', () => {
  const card = (
    template: TemplateContent,
    kind: 'pending' | 'approved' | 'removed' = 'pending',
    member = MEMBER,
  ) => buildMemberEmbed(kind, member, t, URL, NOW, ctx(template));

  it('writes a free text where the BDE put it, with its formatting, and leaves out one that comes out empty', () => {
    const embed = card(
      items(
        'custom',
        on('login'),
        on('text:a', { text: 'Welcome **{name}**' }),
        on('text:b', { text: '{campus}' }),
      ),
      'pending',
      { ...MEMBER, campus: null },
    );
    expect(embed.description).toContain('### 🪪  cmartin');
    expect(embed.description).toContain('Welcome **Camille Martin**');
    // the second text is only the campus, which this member has not: nothing is drawn for it
    expect(embed.description?.match(/​/g)).toHaveLength(3);
  });

  it('puts the campus under the login when they follow each other, and alone when they do not', () => {
    const together = card(items('custom', on('login'), on('campus'))).description ?? '';
    expect(together).toContain('### 🪪  cmartin\n🏫  Nice');
    const apart = card(items('custom', on('campus'), on('login'))).description ?? '';
    expect(apart).toContain('🏫  Nice\n​\n### 🪪  cmartin');
  });

  it('leaves out the campus a member does not have, and the sentence the BDE took away or emptied', () => {
    expect(
      card(items('native', on('login'), on('campus')), 'pending', { ...MEMBER, campus: null })
        .description,
    ).not.toContain('🏫');
    expect(card(items('native', on('login'))).description).not.toContain('>');
    // the sentence is only the actor, whom this member has not
    expect(
      card(items('native', on('summary', { text: '{actor}' })), 'pending', {
        ...MEMBER,
        actorName: null,
      }).description,
    ).not.toContain('> ');
  });

  it('writes the sentence of the BDE for each kind, with its variables', () => {
    expect(
      card(
        items('native', on('summary', { text: '{name} is now {role}, thanks to {actor}' })),
        'approved',
      ).description,
    ).toContain('> Camille Martin is now Treasurer, thanks to Paula Martin');
  });

  it('shows the role and who did it as fields the BDE can rename, and nothing for what the member lacks', () => {
    const embed = card(
      items(
        'native',
        on('role', { label: 'Post', emoji: '🎓' }),
        on('actedBy', { label: 'By', emoji: '🙏' }),
      ),
      'removed',
    );
    expect(embed.fields?.map((field) => field.name)).toEqual(['🎓  Post', '🙏  By']);
    const none = card(items('native', on('role'), on('actedBy')), 'approved', {
      ...MEMBER,
      roleName: null,
      actorName: null,
    });
    expect(none.fields).toBeUndefined();
  });

  it('takes the link away from a request, and gives one to an approval', () => {
    expect(card({ button: { enabled: false } }).description).not.toContain('👉');
    expect(card({ button: { enabled: true } }, 'approved').description).toContain(
      '[View the members]',
    );
    expect(card({ button: { enabled: true } }, 'removed').description).toContain(
      '[View the members]',
    );
  });

  it('has no thumbnail for a member without a photo, and takes the colour and the footer of the BDE', () => {
    const embed = card({ color: '#112233', footer: 'Footer {bde}' }, 'pending', {
      ...MEMBER,
      photoUrl: null,
    });
    expect(embed.thumbnail).toBeUndefined();
    expect(embed.color).toBe(0x112233);
    expect(embed.footer?.text).toBe('Footer BDE Nice');
  });
});

describe('the Slack message of a member', () => {
  const message = (
    template: TemplateContent,
    kind: 'pending' | 'approved' | 'removed' = 'pending',
    member = MEMBER,
  ) => buildMemberSlack(kind, member, t, URL, BRAND, ctx(template));

  it('writes free texts with Slack’s markup, and leaves out a text that comes out empty', () => {
    const slack = message(
      items('custom', on('text:a', { text: '**Hi** _{name}_' }), on('text:b', { text: '{actor}' })),
      'pending',
      { ...MEMBER, actorName: null },
    );
    expect(sections(slack.blocks)).toEqual(['*Hi* _Camille Martin_']);
  });

  it('keeps the photo beside the sentence, and none without one', () => {
    const withPhoto = message(items('native', on('summary', { text: 'Hi {name}' })));
    const section = withPhoto.blocks.find((block) => block.type === 'section' && block.text);
    expect(section).toMatchObject({ accessory: { type: 'image', image_url: MEMBER.photoUrl } });
    const without = message(items('native', on('summary', { text: 'Hi {name}' })), 'pending', {
      ...MEMBER,
      photoUrl: null,
    });
    expect(JSON.stringify(without.blocks)).not.toContain('accessory');
  });

  it('drops a sentence that comes out empty, and a column a member has nothing for', () => {
    expect(
      sections(
        message(items('native', on('summary', { text: '{actor}' })), 'pending', {
          ...MEMBER,
          actorName: null,
        }).blocks,
      ),
    ).toEqual([]);
    const slack = message(items('native', on('campus'), on('role'), on('actedBy')), 'approved', {
      ...MEMBER,
      campus: null,
      roleName: 'Treasurer',
      actorName: null,
    });
    expect(columns(slack.blocks)).toEqual(['*Role*\nTreasurer']);
  });

  it('names who did it for an approval and a removal, with the BDE’s own labels and emoji', () => {
    expect(
      columns(
        message(items('native', on('actedBy', { label: 'Thanks', emoji: '🙏' })), 'approved')
          .blocks,
      ),
    ).toEqual(['*🙏 Thanks*\nPaula Martin']);
    expect(columns(message(items('native', on('actedBy')), 'removed').blocks)).toEqual([
      '*Removed by*\nPaula Martin',
    ]);
  });

  it('takes the button away from a request, and gives one to an approval, with its own label', () => {
    expect(
      message({ button: { enabled: false } }).blocks.some((block) => block.type === 'actions'),
    ).toBe(false);
    const approved = message({ button: { enabled: true, label: 'See {name}' } }, 'approved');
    expect(JSON.stringify(approved.blocks)).toContain('See Camille Martin');
    expect(JSON.stringify(message({ button: { enabled: true } }, 'approved').blocks)).toContain(
      'View the members',
    );
  });

  it('writes the footer, the emoji and the colour of the BDE', () => {
    const slack = message({ footer: 'Footer {bde}', emoji: '🎓', color: '#112233' });
    expect(JSON.stringify(slack.blocks)).toContain('Footer BDE Nice');
    expect(slack.blocks[1]).toMatchObject({ text: { text: '🎓  Camille Martin' } });
    expect(slack.color).toBe('#112233');
  });
});

describe('the e-mail to the people who approve', () => {
  const mail = (template: TemplateContent, member = MEMBER, url: string | null = URL) =>
    buildPendingEmail(member, t, url, BRAND, 'en', ctx(template));

  it('writes a free text as a paragraph and leaves out one that comes out empty', () => {
    const result = mail(
      items(
        'native',
        on('summary'),
        on('text:a', { text: 'Please **answer**' }),
        on('text:b', { text: '{actor}' }),
      ),
      { ...MEMBER, actorName: null },
    );
    expect(result.html).toContain('<strong>answer</strong>');
    expect(result.text).toContain('Please answer');
    // nothing is drawn for the text that came out empty
    expect(result.html).not.toMatch(/<p [^>]*><\/p>/);
  });

  it('keeps the first sentence when two items would write one, and builds the inbox line from it', () => {
    const result = mail(
      items('custom', on('summary', { text: 'First {name}' }), on('summary', { text: 'Second' })),
    );
    expect(result.text).toContain('First Camille Martin');
    expect(result.html).toContain('First Camille Martin&#847;');
  });

  it('builds the inbox line from the platform’s sentence when the BDE took the sentence away', () => {
    const result = mail(items('native', on('login')));
    expect(result.html).toContain('Camille Martin is asking for access to the platform.&#847;');
    expect(result.text).not.toContain('is asking for access to the platform.\n');
  });

  it('has no campus row for a member without one, and the BDE’s labels for the others', () => {
    const result = mail(items('native', on('login', { label: 'Id', emoji: '🪪' }), on('campus')), {
      ...MEMBER,
      campus: null,
    });
    expect(result.text).toContain('🪪 Id : cmartin');
    expect(result.text).not.toContain('Campus');
  });

  it('writes the line after the subject, the note and the footer of the BDE, and no button without an address', () => {
    const result = mail(
      { preheader: 'About {name}', note: 'Quick, please', footer: 'Footer {bde}' },
      MEMBER,
      null,
    );
    expect(result.html).toContain('About Camille Martin&#847;');
    expect(result.html).toContain('Quick, please');
    expect(result.html).toContain('Footer BDE Nice');
    expect(result.html).not.toContain('class="btn"');
  });

  it('takes the button away, and an empty note stays out', () => {
    const result = mail({ button: { enabled: false }, note: '' });
    expect(result.html).not.toContain('class="btn"');
  });
});

describe('the e-mail to the approved member', () => {
  const mail = (template: TemplateContent, url: string | null = URL) =>
    buildApprovedEmail(MEMBER, 'Treasurer', t, url, BRAND, 'en', ctx(template));

  it('writes a free text as a paragraph and leaves out one that comes out empty', () => {
    const result = mail(
      items(
        'native',
        on('summary'),
        on('text:a', { text: 'Welcome **aboard**' }),
        on('text:b', { text: '{login}{role}' }),
        on('text:c', { text: '{actor}{nothing}' }),
      ),
    );
    expect(result.html).toContain('<strong>aboard</strong>');
    expect(result.html).not.toMatch(/<p [^>]*><\/p>/);
    // the second text says the login and the role, and the third says nothing: it is left out
    expect(result.text).toContain('Welcome aboard');
    expect(result.text).toContain('cmartinTreasurer');
  });

  it('keeps the BDE’s sentence, renames the role, and builds the inbox line from the sentence', () => {
    const result = mail(
      items(
        'native',
        on('summary', { text: 'Joined as {role}' }),
        on('role', { label: 'Post', emoji: '🎓' }),
      ),
    );
    expect(result.text).toContain('Joined as Treasurer');
    expect(result.text).toContain('🎓 Post : Treasurer');
    expect(result.html).toContain('Joined as Treasurer&#847;');
  });

  it('builds the inbox line from the platform’s sentence when the BDE took the sentence away', () => {
    expect(mail(items('native', on('role'))).html).toContain(
      'Your access request has been approved.&#847;'.replace(
        'Your access',
        'Camille Martin'.length ? 'Hello Camille Martin, your access' : '',
      ),
    );
  });

  it('writes the line after the subject, the note and the footer of the BDE, with no button without an address', () => {
    const result = mail(
      { preheader: 'Welcome', note: 'Glad you are here', footer: 'Footer {bde}', eyebrow: 'Hi' },
      null,
    );
    expect(result.html).toContain('Welcome&#847;');
    expect(result.html).toContain('Glad you are here');
    expect(result.html).toContain('Footer BDE Nice');
    expect(result.html).not.toContain('class="btn"');
  });

  it('takes the button away, and an empty note stays out', () => {
    expect(mail({ button: { enabled: false }, note: '' }).html).not.toContain('class="btn"');
  });
});
