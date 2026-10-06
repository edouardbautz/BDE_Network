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

const member: MemberFacts = {
  login: 'cmartin',
  fullName: 'Camille Martin',
  campus: 'Nice',
  photoUrl: 'https://cdn.intra.42.fr/users/cmartin.jpg',
  roleName: 'Trésorier',
  actorName: 'Paula Martin',
};

const names = (fields: { name: string }[] | undefined) => fields?.map((field) => field.name);

describe('buildMemberEmbed', () => {
  it.each([
    ['pending', 0xf59e0b],
    ['approved', 0x10b981],
    ['removed', 0xef4444],
  ] as const)('gives the %s card its own colour', (kind, color) => {
    expect(buildMemberEmbed(kind, member, t, null, NOW).color).toBe(color);
  });

  it('names the person in the title and says what happened above it, in bold', () => {
    const embed = buildMemberEmbed('approved', member, t, null, NOW);

    expect(embed.title).toBe('Camille Martin');
    expect(embed.description).toBe(
      '**embed.kind.approved**\nembed.description.approved(name=Camille Martin)',
    );
  });

  it('shows the 42 photo as a thumbnail, and none when there is no photo or it is not an http address', () => {
    expect(buildMemberEmbed('pending', member, t, null, NOW).thumbnail).toEqual({
      url: 'https://cdn.intra.42.fr/users/cmartin.jpg',
    });
    expect(
      buildMemberEmbed('pending', { ...member, photoUrl: null }, t, null, NOW),
    ).not.toHaveProperty('thumbnail');
    expect(
      buildMemberEmbed('pending', { ...member, photoUrl: 'javascript:alert(1)' }, t, null, NOW),
    ).not.toHaveProperty('thumbnail');
  });

  it('links the title to the members page when its address is known, and nowhere otherwise', () => {
    expect(
      buildMemberEmbed('pending', member, t, 'https://bde.example.fr/fr/members', NOW).url,
    ).toBe('https://bde.example.fr/fr/members');
    expect(buildMemberEmbed('pending', member, t, null, NOW).url).toBeUndefined();
    expect(buildMemberEmbed('pending', member, t, 'javascript:alert(1)', NOW).url).toBeUndefined();
  });

  it('shows login and campus, as columns, for a request: no role yet, nobody to credit', () => {
    const { fields } = buildMemberEmbed('pending', member, t, null, NOW);

    expect(names(fields)).toEqual(['embed.fields.login', 'embed.fields.campus']);
    expect(fields?.every((field) => field.inline)).toBe(true);
  });

  it('adds the role and who approved on an approval', () => {
    const { fields } = buildMemberEmbed('approved', member, t, null, NOW);

    expect(names(fields)).toEqual([
      'embed.fields.login',
      'embed.fields.campus',
      'embed.fields.role',
      'embed.fields.approvedBy',
    ]);
    expect(fields?.find((field) => field.name === 'embed.fields.role')?.value).toBe('Trésorier');
    expect(fields?.find((field) => field.name === 'embed.fields.approvedBy')?.value).toBe(
      'Paula Martin',
    );
  });

  it('adds the role they held and who removed them on a removal', () => {
    const { fields } = buildMemberEmbed('removed', member, t, null, NOW);

    expect(names(fields)).toEqual([
      'embed.fields.login',
      'embed.fields.campus',
      'embed.fields.role',
      'embed.fields.removedBy',
    ]);
  });

  it('never shows a request as approved or removed by someone, even if the data has an actor', () => {
    expect(names(buildMemberEmbed('pending', member, t, null, NOW).fields)).not.toContain(
      'embed.fields.approvedBy',
    );
    expect(names(buildMemberEmbed('approved', member, t, null, NOW).fields)).not.toContain(
      'embed.fields.removedBy',
    );
    expect(names(buildMemberEmbed('removed', member, t, null, NOW).fields)).not.toContain(
      'embed.fields.approvedBy',
    );
  });

  it('leaves out what is not known instead of showing an empty column', () => {
    const bare: MemberFacts = { login: 'cmartin', fullName: 'Camille Martin' };
    const { fields } = buildMemberEmbed('removed', bare, t, null, NOW);

    expect(names(fields)).toEqual(['embed.fields.login']);
  });

  it('signs the card with the platform name, and stamps it with the sending time', () => {
    const embed = buildMemberEmbed('pending', member, t, null, NOW);

    expect(embed.footer).toEqual({ text: 'BDE_Network' });
    expect(embed.timestamp).toBe('2026-10-06T12:00:00.000Z');
  });
});
