import { describe, expect, it } from 'vitest';
import fr from '../../../messages/fr.json';
import type { SlackBlock } from '@/lib/notifications/slack-blocks';
import type { Translate } from '@/lib/notifications/translate';
import type { MemberFacts } from './messages';
import { buildMemberSlack, type MemberSlackKind } from './slack-blocks';

/** The real French catalog: a missing message fails the test. */
const t: Translate = (key, values = {}) => {
  const text = key
    .split('.')
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown>)?.[part],
      fr.members.notifications,
    );
  if (typeof text !== 'string') throw new Error(`missing message ${key}`);
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));
};

const brand = { name: 'BDE Nice', logoUrl: 'https://bde.example.fr/logo.png' };
const member: MemberFacts = {
  login: 'cmartin',
  fullName: 'Camille Martin',
  campus: 'Nice',
  photoUrl: 'https://cdn.intra.42.fr/users/cmartin.jpg',
  roleName: 'Trésorier',
  actorName: 'Paula Martin',
};

const build = (
  kind: MemberSlackKind,
  over: Partial<MemberFacts> = {},
  url: string | null = 'https://bde.example.fr/fr/members',
) => buildMemberSlack(kind, { ...member, ...over }, t, url, brand);

const fieldTexts = (blocks: SlackBlock[]) =>
  blocks.flatMap((block) =>
    block.type === 'section' && block.fields ? block.fields.map((field) => field.text) : [],
  );
const types = (blocks: SlackBlock[]) => blocks.map((block) => block.type);

describe('buildMemberSlack', () => {
  it.each([
    ['pending', '#f59e0b'],
    ['approved', '#10b981'],
    ['removed', '#ef4444'],
  ] as const)('gives the %s message its own colour, the same as on Discord', (kind, color) => {
    expect(build(kind).color).toBe(color);
  });

  it('names what happened above the person, in bold, with the person as the header', () => {
    const [kind, header] = build('approved').blocks;
    expect(kind).toEqual({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '*Demande approuvée*' }],
    });
    expect(header).toEqual({
      type: 'header',
      text: { type: 'plain_text', text: 'Camille Martin' },
    });
  });

  it('says it in one sentence, with the photo of the person beside it', () => {
    const section = build('approved').blocks[2];
    expect(section).toEqual({
      type: 'section',
      text: { type: 'mrkdwn', text: 'Camille Martin a rejoint le BDE.' },
      accessory: {
        type: 'image',
        image_url: 'https://cdn.intra.42.fr/users/cmartin.jpg',
        alt_text: 'Camille Martin',
      },
    });
  });

  it('has no photo when there is none', () => {
    expect(build('pending', { photoUrl: null }).blocks[2]).not.toHaveProperty('accessory');
  });

  it('shows login and campus for a request: no role yet, nobody to credit', () => {
    expect(fieldTexts(build('pending').blocks)).toEqual(['*Login 42*\ncmartin', '*Campus*\nNice']);
  });

  it('adds the role and who approved on an approval', () => {
    expect(fieldTexts(build('approved').blocks)).toEqual([
      '*Login 42*\ncmartin',
      '*Campus*\nNice',
      '*Rôle*\nTrésorier',
      '*Approuvé par*\nPaula Martin',
    ]);
  });

  it('adds the role they held and who removed them on a removal', () => {
    expect(fieldTexts(build('removed').blocks)).toEqual([
      '*Login 42*\ncmartin',
      '*Campus*\nNice',
      '*Rôle*\nTrésorier',
      '*Retiré par*\nPaula Martin',
    ]);
  });

  it('never credits a request, and never mixes approved and removed', () => {
    expect(fieldTexts(build('pending').blocks).join()).not.toMatch(/Approuvé par|Retiré par/);
    expect(fieldTexts(build('approved').blocks).join()).not.toContain('Retiré par');
    expect(fieldTexts(build('removed').blocks).join()).not.toContain('Approuvé par');
  });

  it('leaves out what is not known instead of showing an empty column', () => {
    const bare = { campus: null, roleName: null, actorName: null, photoUrl: null };
    expect(fieldTexts(build('removed', bare).blocks)).toEqual(['*Login 42*\ncmartin']);
  });

  it('has a button to decide on a request, and on a request only', () => {
    expect(build('pending').blocks.find((block) => block.type === 'actions')).toEqual({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Valider ou refuser' },
          url: 'https://bde.example.fr/fr/members',
        },
      ],
    });
    expect(types(build('approved').blocks)).not.toContain('actions');
    expect(types(build('removed').blocks)).not.toContain('actions');
  });

  it('has no button without APP_URL', () => {
    expect(types(build('pending', {}, null).blocks)).not.toContain('actions');
  });

  it('ends with the BDE logo and name, then the platform name', () => {
    expect(build('pending').blocks.at(-1)).toEqual({
      type: 'context',
      elements: [
        { type: 'image', image_url: 'https://bde.example.fr/logo.png', alt_text: 'BDE Nice' },
        { type: 'mrkdwn', text: 'BDE Nice · BDE_Network' },
      ],
    });
  });

  it('gives the summary for notifications: what happened, and who, as plain text', () => {
    expect(build('pending').fallback).toBe("Nouvelle demande d'accès : Camille Martin");
    expect(build('removed').fallback).toBe('Membre retiré : Camille Martin');
    expect(build('approved', { fullName: 'Camille & Co' }).fallback).toBe(
      'Demande approuvée : Camille & Co',
    );
  });

  it('is in the language it is given', async () => {
    const en = (await import('../../../messages/en.json')).default;
    const tEn: Translate = (key, values = {}) => {
      const text = key
        .split('.')
        .reduce<unknown>(
          (node, part) => (node as Record<string, unknown>)?.[part],
          en.members.notifications,
        );
      if (typeof text !== 'string') throw new Error(`missing message ${key}`);
      return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));
    };
    const out = buildMemberSlack(
      'pending',
      member,
      tEn,
      'https://bde.example.fr/en/members',
      brand,
    );

    expect(out.fallback).toBe('New access request : Camille Martin');
    expect(JSON.stringify(out.blocks)).toContain('Approve or refuse');
  });
});

describe('buildMemberSlack: what the person typed', () => {
  const hostile = '<!channel> <@U123> <#C1> <https://evil.example|ici> @everyone & <b>';

  it('turns every mention and link of the name, login, campus and role into text', () => {
    const out = build('approved', {
      fullName: hostile,
      login: hostile,
      campus: hostile,
      roleName: hostile,
      actorName: hostile,
    });

    const text = JSON.stringify(
      out.blocks.flatMap((block) =>
        block.type === 'section'
          ? [block.text?.text, ...(block.fields?.map((f) => f.text) ?? [])]
          : [],
      ),
    );
    for (const bad of ['<!channel>', '<@U123>', '<#C1>', '<https', '@everyone']) {
      expect(text).not.toContain(bad);
    }
    expect(text).toContain('&lt;!channel&gt;');
  });

  it('keeps the name as plain text in the header, where Slack acts on nothing', () => {
    expect(build('pending', { fullName: hostile }).blocks[1]).toEqual({
      type: 'header',
      text: { type: 'plain_text', text: hostile },
    });
  });
});
