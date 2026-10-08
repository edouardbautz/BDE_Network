import { describe, expect, it } from 'vitest';
import type { Translate } from '@/lib/notifications/translate';
import { buildMemberEmbed } from './discord-embed';
import type { MemberFacts } from './messages';

// Echoes the key and values so the assertions don't depend on the catalog wording.
const t: Translate = (key, values) =>
  values
    ? `${key}(${Object.entries(values)
        .map(([k, v]) => `${k}=${v}`)
        .join(',')})`
    : key;

const NOW = new Date('2026-10-06T12:00:00Z');
const BLANK = '​';
const URL = 'https://bde.example.fr/fr/members';

const member: MemberFacts = {
  login: 'cmartin',
  fullName: 'Camille Martin',
  campus: 'Nice',
  photoUrl: 'https://cdn.intra.42.fr/users/cmartin.jpg',
  roleName: 'Trésorier',
  actorName: 'Paula Martin',
};

const build = (
  kind: 'pending' | 'approved' | 'removed',
  facts: Partial<MemberFacts> = {},
  url: string | null = null,
) => buildMemberEmbed(kind, { ...member, ...facts }, t, url, NOW);
const lines = (embed: ReturnType<typeof build>) => (embed.description ?? '').split('\n');
const names = (embed: ReturnType<typeof build>) => embed.fields?.map((field) => field.name);

describe('buildMemberEmbed', () => {
  it.each([
    ['pending', 0xf59e0b],
    ['approved', 0x10b981],
    ['removed', 0xef4444],
  ] as const)('gives the %s card its own colour', (kind, color) => {
    expect(build(kind).color).toBe(color);
  });

  it.each([
    ['pending', '🙋'],
    ['approved', '✅'],
    ['removed', '👋'],
  ] as const)('names the person in the title, with the icon of a %s card', (kind, icon) => {
    expect(build(kind).title).toBe(`${icon}  Camille Martin`);
  });

  describe('the description: the essentials as headings', () => {
    it('is the kind in small capitals, the 42 login and campus, then what happened as a quote', () => {
      expect(lines(build('approved'))).toEqual([
        '-# EMBED.KIND.APPROVED',
        BLANK,
        '### 🪪  cmartin',
        '🏫  Nice',
        BLANK,
        '> embed.description.approved(name=Camille Martin)',
        BLANK, // before the fields
      ]);
    });

    it('leaves out the campus when it is not known, and nothing follows the quote without fields', () => {
      expect(lines(build('pending', { campus: undefined }))).toEqual([
        '-# EMBED.KIND.PENDING',
        BLANK,
        '### 🪪  cmartin',
        BLANK,
        '> embed.description.pending(name=Camille Martin)',
      ]);
    });

    it('keeps the login and the campus on one line each: nothing typed can open another heading', () => {
      const embed = build('pending', { login: 'a\n### 💥', campus: 'Nice\n# x' });

      expect(lines(embed).filter((line) => line.startsWith('#'))).toHaveLength(1);
    });

    it('ends a request with the link to decide it, once the address of the platform is known', () => {
      expect(lines(build('pending', {}, URL)).slice(-2)).toEqual([
        BLANK,
        `👉  [embed.action.pending](${URL})`,
      ]);
      expect(build('pending').description).not.toContain('👉');
    });

    it('offers no link on an approval or a removal: nothing is left to decide', () => {
      expect(build('approved', {}, URL).description).not.toContain('👉');
      expect(build('removed', {}, URL).description).not.toContain('👉');
    });

    it('does not let a parenthesis of the address end the link early', () => {
      const embed = build('pending', {}, 'https://bde.example.fr/a)b');

      expect(embed.description).toContain('(https://bde.example.fr/a%29b)');
    });
  });

  it('shows the 42 photo as a thumbnail, and none when there is no photo or it is not an http address', () => {
    expect(build('pending').thumbnail).toEqual({
      url: 'https://cdn.intra.42.fr/users/cmartin.jpg',
    });
    expect(build('pending', { photoUrl: null })).not.toHaveProperty('thumbnail');
    expect(build('pending', { photoUrl: 'javascript:alert(1)' })).not.toHaveProperty('thumbnail');
  });

  it('links the title to the members page when its address is known, and nowhere otherwise', () => {
    expect(build('pending', {}, URL).url).toBe(URL);
    expect(build('pending').url).toBeUndefined();
    expect(build('pending', {}, 'javascript:alert(1)').url).toBeUndefined();
  });

  describe('the fields: the secondary facts', () => {
    it('has none for a request: no role yet, nobody to credit', () => {
      expect(build('pending')).not.toHaveProperty('fields');
    });

    it('adds the role and who approved on an approval, side by side', () => {
      const { fields } = build('approved');

      expect(fields?.map((field) => field.name)).toEqual([
        '🎭  embed.fields.role',
        '🤝  embed.fields.approvedBy',
      ]);
      expect(fields?.map((field) => field.value)).toEqual(['Trésorier', 'Paula Martin']);
      expect(fields?.every((field) => field.inline)).toBe(true);
    });

    it('adds the role they held and who removed them on a removal', () => {
      expect(names(build('removed'))).toEqual([
        '🎭  embed.fields.role',
        '🚪  embed.fields.removedBy',
      ]);
    });

    it('never shows a request as approved or removed by someone, even if the data has an actor', () => {
      expect(build('pending')).not.toHaveProperty('fields');
      expect(names(build('approved'))?.join()).not.toContain('removedBy');
      expect(names(build('removed'))?.join()).not.toContain('approvedBy');
    });

    it('leaves out what is not known instead of showing an empty column', () => {
      const bare = build('removed', { roleName: undefined, actorName: undefined });

      expect(bare).not.toHaveProperty('fields');
    });
  });

  it('signs the card with the platform name, and stamps it with the sending time', () => {
    const embed = build('pending');

    expect(embed.footer).toEqual({ text: 'BDE_Network' });
    expect(embed.timestamp).toBe('2026-10-06T12:00:00.000Z');
  });
});
