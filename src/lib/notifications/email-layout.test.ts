import { describe, expect, it } from 'vitest';
import { escapeHtml, renderEmail, type EmailModel } from './email-layout';

const model: EmailModel = {
  lang: 'fr',
  preheader: 'Samedi 10 octobre · Foyer',
  brand: { name: 'BDE Nice', logoUrl: 'https://bde.example.fr/logo.png' },
  accent: '#db2777',
  eyebrow: 'Nouvel événement',
  heading: 'Soirée de rentrée',
  lead: 'DJ set et buffet.\nEntrée libre.',
  fields: [
    { label: 'Quand', value: 'samedi 10 octobre 2026 à 20:00' },
    { label: 'Catégorie', value: 'Soirée', marker: '#db2777' },
  ],
  action: { label: "Voir l'événement", url: 'https://bde.example.fr/fr/events/1?occ=2' },
  note: 'Le fichier joint ajoute l’événement.',
  footer: 'Vous recevez ce message parce que vous êtes membre de BDE Nice.',
};

const html = (overrides: Partial<EmailModel> = {}) => renderEmail({ ...model, ...overrides }).html;
const text = (overrides: Partial<EmailModel> = {}) => renderEmail({ ...model, ...overrides }).text;

describe('escapeHtml', () => {
  it('escapes the five characters that can open a tag or close an attribute', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });

  it('leaves ordinary text, accents and emoji alone', () => {
    expect(escapeHtml('Soirée à 20h — 🎉')).toBe('Soirée à 20h — 🎉');
  });

  it('escapes an ampersand once, not twice', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });
});

describe('renderEmail: the HTML', () => {
  it('is a complete document in the language of the e-mail', () => {
    const out = html();
    expect(out.startsWith('<!doctype html>')).toBe(true);
    expect(out).toContain('<html lang="fr"');
    expect(out).toContain('<title>Soirée de rentrée</title>');
    expect(out).toContain('<meta name="viewport"');
    expect(out).toContain('<meta charset="utf-8">');
  });

  it('says it supports a light and a dark scheme, and styles the dark one', () => {
    const out = html();
    expect(out).toContain('<meta name="color-scheme" content="light dark">');
    expect(out).toContain('<meta name="supported-color-schemes" content="light dark">');
    expect(out).toContain('@media (prefers-color-scheme:dark)');
    expect(out).toContain('[data-ogsc]'); // Outlook.com
    expect(out).toContain('[data-ogsb] .bg-page{background-color:#0f1115!important}');
    expect(out).toContain('[data-ogsb] .bg-card{background-color:#1a1d23!important}');
    expect(out).toContain('[data-ogsb] .rule{border-color:#2a2f38!important}');
    expect(out).toContain('.bg-card{background-color:#1a1d23!important}');
    expect(out).toContain('.t-main{color:#eceef1!important}');
  });

  it('puts a thin light outline round the logo in dark mode only', () => {
    const out = html();
    const media = out.indexOf('@media (prefers-color-scheme:dark)');
    const dark = out.slice(media, out.indexOf('[data-ogsc] .t-main'));
    const outlook = out.slice(out.indexOf('[data-ogsc] .t-main'));
    expect(dark).toContain('.logo{border:1px solid #6b7385!important}'); // Apple Mail, Gmail…
    expect(outlook).toContain('[data-ogsc] .logo{border:1px solid #6b7385!important}'); // Outlook.com
    expect(out).toMatch(/<img class="logo" src="https:\/\/bde\.example\.fr\/logo\.png"/);
    expect(out.slice(0, out.indexOf('@media (prefers-color-scheme:dark)'))).not.toContain(
      '.logo{border',
    );
  });

  it('does not rely on the style element for what matters: colours are inline too', () => {
    const out = html();
    expect(out).toContain('bgcolor="#ffffff"');
    expect(out).toContain('background-color:#ffffff');
    expect(out).toMatch(/<h1 [^>]*style="[^"]*color:#1f2430/);
  });

  it('is built of tables, for the clients that render with a word processor', () => {
    const out = html();
    expect(out).toContain('<table role="presentation"');
    expect(out).toContain('<!--[if mso]>');
    expect(out).toContain('PixelsPerInch');
  });

  it('has a narrow-screen rule that stacks the rows', () => {
    const out = html();
    expect(out).toContain('@media (max-width:620px)');
    expect(out).toContain('.stack{display:block!important');
    // Stacked, a row keeps one separator: above its label, not between the label and its value.
    expect(out).toContain('.value{padding-top:2px!important;border-top:0!important}');
    expect(out).not.toContain('.label{padding-bottom:0!important;border-top:0');
  });

  it('shows the colour of what it is about on the top bar and the button', () => {
    const out = html({ accent: '#16a34a' });
    expect(out).toContain('<td bgcolor="#16a34a" height="6"');
    expect(out).toContain('background-color:#16a34a;border-radius:8px');
    expect(out).not.toContain('bgcolor="#db2777"'); // the dot of the category keeps its own colour
  });

  it('uses the neutral grey when the colour is not a colour', () => {
    const out = html({ accent: 'red;x' });
    expect(out).toContain('<td bgcolor="#6b7280" height="6"');
  });

  it('writes the button text in black or white, whichever reads on the colour', () => {
    expect(html({ accent: '#f59e0b' })).toMatch(/<a class="btn"[^>]*color:#000000/);
    expect(html({ accent: '#1e3a8a' })).toMatch(/<a class="btn"[^>]*color:#ffffff/);
  });

  it('has a button for Outlook on Windows too, which draws it itself', () => {
    const out = html();
    expect(out).toContain('<v:roundrect');
    expect(out).toContain('href="https://bde.example.fr/fr/events/1?occ=2"');
    expect(out).toContain('fillcolor="#db2777"');
    expect(out).toContain('<w:anchorlock/>');
  });

  it('sizes the Outlook button to its label, within bounds', () => {
    const width = (label: string) =>
      Number(
        /width:(\d+)px"><w:anchorlock/.exec(
          html({ action: { label, url: model.action!.url } }),
        )?.[1],
      );
    expect(width('Ok')).toBe(190);
    expect(width("Voir l'événement")).toBe(224);
    expect(width('x'.repeat(100))).toBe(420);
  });

  it('puts the hidden preheader before everything, followed by filler that hides the body text', () => {
    const out = html();
    const body = out.slice(out.indexOf('<body'));
    expect(body.indexOf('Samedi 10 octobre · Foyer')).toBeLessThan(
      body.indexOf('Soirée de rentrée'),
    );
    expect(out).toMatch(
      /display:none[^"]*mso-hide:all">Samedi 10 octobre · Foyer(&#847;&zwnj;&nbsp;)+<\/div>/,
    );
  });

  it('shows the BDE logo and name, and only the name when there is no logo', () => {
    expect(html()).toContain('width="40" height="40"');
    expect(html()).toContain('>BDE Nice</td>');

    const without = html({ brand: { name: 'BDE Nice' } });
    expect(without).not.toContain('width="40" height="40"');
    expect(without).toContain('>BDE Nice</td>');
  });

  it('leaves out a logo whose address is not http(s)', () => {
    expect(html({ brand: { name: 'B', logoUrl: 'javascript:alert(1)' } })).not.toContain('<img');
    expect(html({ brand: { name: 'B', logoUrl: 'data:image/png;base64,AAAA' } })).not.toContain(
      '<img',
    );
  });

  it('shows a picture of the person above the heading, only when given a real address', () => {
    const withPhoto = html({ avatarUrl: 'https://cdn.intra.42.fr/u.jpg' });
    expect(withPhoto).toContain('src="https://cdn.intra.42.fr/u.jpg" width="64" height="64"');
    expect(html()).not.toContain('width="64"');
    expect(html({ avatarUrl: 'javascript:x' })).not.toContain('width="64"');
  });

  it("writes the eyebrow, the heading and the lead, keeping the lead's line breaks", () => {
    const out = html();
    expect(out).toContain('>Nouvel événement</div>');
    expect(out).toContain('>Soirée de rentrée</h1>');
    expect(out).toContain('DJ set et buffet.<br>Entrée libre.');
  });

  it('puts every field in a row of its own, with the category colour as a dot', () => {
    const out = html();
    expect(out).toContain('>Quand</td>');
    expect(out).toContain('samedi 10 octobre 2026 à 20:00</td>');
    expect(out).toMatch(/<span style="color:#db2777">&#9679;<\/span>&nbsp;Soirée/);
  });

  it('draws a separator between rows, not above the first', () => {
    const out = html();
    const rows = out.split('<tr>\n<td class="stack label').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).not.toContain('border-top:1px');
    expect(rows[1]).toContain('border-top:1px solid #e5e7eb');
  });

  it('draws no table of fields when there are none', () => {
    expect(html({ fields: [] })).not.toContain('class="stack label');
  });

  it('writes the note and the footer, then the platform name', () => {
    const out = html();
    expect(out).toContain('Le fichier joint ajoute l’événement.');
    expect(out).toContain(
      'Vous recevez ce message parce que vous êtes membre de BDE Nice.<br>BDE_Network',
    );
  });

  it('has no button, and no Outlook button, without an action or with a bad address', () => {
    for (const out of [
      html({ action: undefined }),
      html({ action: { label: 'Voir', url: 'javascript:alert(1)' } }),
      html({ action: { label: 'Voir', url: 'not a url' } }),
    ]) {
      expect(out).not.toContain('class="btn"');
      expect(out).not.toContain('<v:roundrect');
    }
  });

  it('has no lead or note paragraph when there is none', () => {
    const out = html({ lead: undefined, note: undefined });
    expect(out).not.toContain('Entrée libre');
    expect(out).not.toContain('Le fichier joint');
  });
});

describe('renderEmail: nothing typed by a member becomes markup', () => {
  const hostile = '<script>alert(1)</script><img src=x onerror=alert(1)>"\'&';

  it('escapes every text of the model', () => {
    const out = html({
      preheader: hostile,
      brand: { name: hostile },
      eyebrow: hostile,
      heading: hostile,
      lead: hostile,
      fields: [{ label: hostile, value: hostile }],
      note: hostile,
      footer: hostile,
      action: { label: hostile, url: 'https://bde.example.fr/x' },
    });

    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img src=x');
    expect(out).not.toMatch(/<[a-z]+[^>]* onerror=/i);
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes the language, which goes into an attribute', () => {
    const out = html({ lang: '"><script>alert(1)</script>' });
    expect(out).not.toContain('<script');
    expect(out).toContain('<html lang="&quot;&gt;&lt;script&gt;');
  });

  it('escapes the addresses that go into attributes', () => {
    const out = html({
      brand: { name: 'B', logoUrl: 'https://bde.example.fr/l.png?a=1&b="2"' },
      avatarUrl: 'https://cdn.example/u.jpg?x=<y>',
      action: { label: 'Voir', url: 'https://bde.example.fr/p?a=1&b="2"' },
    });

    expect(out).not.toMatch(/src="[^"]*"[^>]*"2"/);
    expect(out).toContain('href="https://bde.example.fr/p?a=1&amp;b=%222%22"');
    expect(out).toContain('src="https://bde.example.fr/l.png?a=1&amp;b=%222%22"');
  });

  it('cannot be given a style through a colour', () => {
    const out = html({
      accent: '#fff;background:url(//evil)',
      fields: [{ label: 'a', value: 'b', marker: '"><script>' }],
    });
    expect(out).not.toContain('evil');
    expect(out).not.toContain('<script');
  });

  it("keeps a member's line breaks as breaks, not as markup of their own", () => {
    const out = html({ lead: 'a\r\nb\n<br>c' });
    expect(out).toContain('a<br>b<br>&lt;br&gt;c');
  });
});

describe('renderEmail: the text version', () => {
  it('has the same content, in reading order', () => {
    expect(text()).toBe(
      [
        'BDE Nice',
        'NOUVEL ÉVÉNEMENT',
        '',
        'Soirée de rentrée',
        '',
        'DJ set et buffet.\nEntrée libre.',
        '',
        'Quand : samedi 10 octobre 2026 à 20:00',
        'Catégorie : Soirée',
        '',
        "Voir l'événement : https://bde.example.fr/fr/events/1?occ=2",
        '',
        'Le fichier joint ajoute l’événement.',
        '',
        '--',
        'Vous recevez ce message parce que vous êtes membre de BDE Nice.',
        'BDE_Network',
        '',
      ].join('\n'),
    );
  });

  it('leaves out what the HTML leaves out', () => {
    const out = text({ lead: undefined, fields: [], action: undefined, note: undefined });
    expect(out).not.toContain(' : ');
    expect(out).not.toContain('Le fichier joint');
    expect(out).toContain('Soirée de rentrée');
  });

  it('has no link for an address that is not http(s)', () => {
    expect(text({ action: { label: 'Voir', url: 'javascript:alert(1)' } })).not.toContain(
      'javascript',
    );
  });

  it('contains no markup', () => {
    expect(text()).not.toMatch(/<[a-z/][^>]*>/i);
  });
});
