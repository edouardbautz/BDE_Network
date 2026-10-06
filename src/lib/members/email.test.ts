import { describe, expect, it } from 'vitest';
import fr from '../../../messages/fr.json';
import type { Translate } from '@/lib/notifications/translate';
import { buildApprovedEmail, buildPendingEmail } from './email';
import type { MemberFacts } from './messages';

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
};

describe('buildPendingEmail', () => {
  const mail = (
    over: Partial<MemberFacts> = {},
    url: string | null = 'https://bde.example.fr/fr/members',
  ) => buildPendingEmail({ ...member, ...over }, t, url, brand, 'fr');

  it('has an amber bar and button', () => {
    const { html } = mail();
    expect(html).toContain('<td bgcolor="#f59e0b" height="6"');
    expect(html).toMatch(/<a class="btn"[^>]*color:#000000/);
  });

  it('names the person, with their 42 photo above the heading', () => {
    const { html, text } = mail();
    expect(html).toContain('>Camille Martin</h1>');
    expect(html).toContain('src="https://cdn.intra.42.fr/users/cmartin.jpg" width="64"');
    expect(text).toContain("NOUVELLE DEMANDE D'ACCÈS");
    expect(text).toContain("Camille Martin demande l'accès à la plateforme.");
  });

  it('shows the login and the campus, and no role: nothing is decided yet', () => {
    const { text } = mail();
    expect(text).toContain('Login 42 : cmartin');
    expect(text).toContain('Campus : Nice');
    expect(text).not.toContain('Rôle');
  });

  it('leaves out what is not known: no photo, no campus', () => {
    const { html, text } = mail({ photoUrl: null, campus: null });
    expect(html).not.toContain('width="64"');
    expect(text).not.toContain('Campus');
  });

  it('has a button to the page where the request is decided, and none without APP_URL', () => {
    expect(mail().html).toContain('href="https://bde.example.fr/fr/members"');
    expect(mail().text).toContain(
      'Valider ou refuser la demande : https://bde.example.fr/fr/members',
    );
    expect(mail({}, null).html).not.toContain('class="btn"');
  });

  it('tells the people who approve why they receive it', () => {
    expect(mail().text).toContain('parce que vous pouvez gérer les membres de BDE Nice');
  });

  it('writes nothing the person typed as markup', () => {
    const { html } = mail({
      fullName: '<script>alert(1)</script>',
      login: '"><img src=x>',
      campus: '<b>',
    });
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>');
  });
});

describe('buildApprovedEmail', () => {
  const mail = (url: string | null = 'https://bde.example.fr/fr') =>
    buildApprovedEmail(member, 'Trésorier', t, url, brand, 'fr');

  it('has a green bar and button', () => {
    expect(mail().html).toContain('<td bgcolor="#10b981" height="6"');
  });

  it('welcomes the person to the BDE, with the role they hold', () => {
    const { text } = mail();
    expect(text).toContain('Votre accès à BDE Nice est validé');
    expect(text).toContain("Bonjour Camille Martin, votre demande d'accès a été approuvée.");
    expect(text).toContain('Rôle : Trésorier');
  });

  it('shows no photo of the person: it speaks to them', () => {
    expect(mail().html).not.toContain('width="64"');
  });

  it('has a button to sign in, and none without APP_URL', () => {
    expect(mail().html).toContain('href="https://bde.example.fr/fr"');
    expect(mail().text).toContain('Se connecter : https://bde.example.fr/fr');
    expect(mail(null).html).not.toContain('class="btn"');
  });

  it('says the person receives it because they asked for access', () => {
    expect(mail().text).toContain("parce que vous avez demandé l'accès à BDE Nice");
  });

  it('writes the role as text, never as markup', () => {
    const { html } = buildApprovedEmail(member, '<script>x</script>', t, null, brand, 'fr');
    expect(html).not.toContain('<script>x');
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
    const out = buildApprovedEmail(
      member,
      'Treasurer',
      tEn,
      'https://bde.example.fr/en',
      brand,
      'en',
    );

    expect(out.html).toContain('<html lang="en"');
    expect(out.text).toContain('Your access to BDE Nice is approved');
    expect(out.text).toContain('Role : Treasurer');
  });
});
