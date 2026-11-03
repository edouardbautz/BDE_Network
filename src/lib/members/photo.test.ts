import { describe, expect, it } from 'vitest';
import { buildMemberEmbed } from './discord-embed';
import { buildPendingEmail } from './email';
import { buildMemberSlack } from './slack-blocks';
import type { MemberFacts } from './messages';
import { getNotificationTranslate } from '@/lib/notifications/translate';

/**
 * The picture of the person a notification is about goes into the card of Discord and Slack: only an address of 42's own domain does. What is stored
 * is already checked, but the card does not depend on it: a chat fetches the address by itself, from its own servers.
 */

const PHOTO = 'https://cdn.intra.42.fr/users/2c1f/medium_cmartin.jpg';

const member = (photoUrl: string | null | undefined): MemberFacts => ({
  login: 'cmartin',
  fullName: 'Camille Martin',
  campus: 'Nice',
  roleName: 'Membre',
  photoUrl,
});

describe('the picture in the e-mail to those who approve', () => {
  const email = async (photoUrl: string | null | undefined) => {
    const t = await getNotificationTranslate('fr', 'members.notifications');
    return buildPendingEmail(
      member(photoUrl),
      t,
      'https://bde.example/fr/members',
      { name: 'BDE', accent: '#2f5bea' },
      'fr',
    );
  };

  it('is the avatar of the message when it is 42’s', async () => {
    expect((await email(PHOTO)).html).toContain(`<img src="${PHOTO}"`);
  });

  it.each([
    ['another site', 'https://evil.example/a.jpg'],
    ['a script', 'javascript:alert(1)'],
    ['nothing', null],
  ])('is left out when it is %s', async (_label, photoUrl) => {
    const html = (await email(photoUrl)).html;
    expect(html).not.toContain('width="64" height="64"');
    expect(html).not.toContain('evil.example');
  });
});

describe('the picture in the cards of the members', () => {
  it('is the thumbnail of the Discord card and the image of the Slack message, when it is 42’s', async () => {
    const t = await getNotificationTranslate('fr', 'members.notifications');
    const card = buildMemberEmbed('pending', member(PHOTO), t, 'https://bde.example/fr/members');
    expect(card.thumbnail).toEqual({ url: PHOTO });
    const slack = buildMemberSlack('pending', member(PHOTO), t, 'https://bde.example/fr/members', {
      name: 'BDE',
      accent: '#2f5bea',
    });
    expect(JSON.stringify(slack)).toContain(PHOTO);
  });

  it.each([
    ['another site', 'https://evil.example/a.jpg'],
    ['a script', 'javascript:alert(1)'],
    ['plain http', 'http://cdn.intra.42.fr/a.jpg'],
    ['nothing', null],
    ['nothing at all', undefined],
  ])('is left out when it is %s: no broken image in a chat', async (_label, photoUrl) => {
    const t = await getNotificationTranslate('fr', 'members.notifications');
    const card = buildMemberEmbed('pending', member(photoUrl), t, 'https://bde.example/fr/members');
    expect(card.thumbnail).toBeUndefined();
    const slack = buildMemberSlack(
      'pending',
      member(photoUrl),
      t,
      'https://bde.example/fr/members',
      { name: 'BDE', accent: '#2f5bea' },
    );
    expect(JSON.stringify(slack)).not.toContain('"accessory"');
  });
});
