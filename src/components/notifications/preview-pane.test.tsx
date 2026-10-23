import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import type { Preview } from '@/lib/notifications/templates/preview';
import type { TrustedText } from '@/lib/notifications/templates/mentions';
import fr from '../../../messages/fr.json';
import { PreviewPane } from './preview-pane';

afterEach(cleanup);

const show = (preview: Preview, labels: Record<string, string> = {}, logoUrl?: string) =>
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <PreviewPane
        preview={preview}
        locale="fr"
        bdeName="BDE Nice"
        labels={labels}
        {...(logoUrl && { logoUrl })}
      />
    </NextIntlClientProvider>,
  );

describe('a Discord card', () => {
  const card: Preview = {
    channel: 'discord',
    above: {
      text: 'Salut <@&123>' as TrustedText,
      mentions: { everyone: false, roles: ['123'], users: [] },
    },
    embed: {
      author: { name: 'BDE Nice', icon_url: 'https://bde.example.fr/logo.png' },
      title: 'Soirée',
      description: '-# NOUVEL ÉVÉNEMENT\n### Quand',
      color: 0xdb2777,
      fields: [
        { name: 'Catégorie', value: 'Soirée', inline: true },
        { name: 'Répétition', value: 'Chaque semaine' },
      ],
      thumbnail: { url: 'https://bde.example.fr/logo.png' },
      footer: { text: 'BDE_Network' },
    },
  };

  it('draws everything the card holds, with the colour of its bar', () => {
    const view = show(card, { '123': 'Bureau' }, 'https://bde.example.fr/logo.png');
    const root = screen.getByTestId('preview-discord');
    expect(root).toHaveTextContent('Salut @Bureau');
    expect(root).toHaveTextContent('Soirée');
    expect(root).toHaveTextContent('NOUVEL ÉVÉNEMENT');
    expect(root).toHaveTextContent('Chaque semaine');
    expect(root).toHaveTextContent('BDE_Network');
    expect(view.container.querySelectorAll('img').length).toBe(3);
    const bar = [...root.querySelectorAll<HTMLElement>('div')].find(
      (el) => el.style.borderInlineStartColor,
    );
    expect(bar?.style.borderInlineStartColor).toBe('rgb(219, 39, 119)');
  });

  it('draws the initial of the BDE when it has no logo, and nothing above a card that has no message', () => {
    show({ channel: 'discord', embed: { title: 'T' } });
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('draws no message above when it is empty', () => {
    show({
      channel: 'discord',
      above: { text: '' as TrustedText, mentions: { everyone: false, roles: [], users: [] } },
      embed: { title: 'T' },
    });
    expect(screen.getByTestId('preview-discord').querySelectorAll('p')).toHaveLength(0);
  });
});

describe('a Slack message', () => {
  it('draws each kind of block, with the colour of its bar', () => {
    const view = show(
      {
        channel: 'slack',
        message: {
          fallback: 'x',
          color: '#db2777',
          above: 'Salut <!here>' as TrustedText,
          blocks: [
            { type: 'header', text: { type: 'plain_text', text: 'Soirée' } },
            { type: 'section', text: { type: 'mrkdwn', text: '*Quand*\nsamedi' } },
            {
              type: 'section',
              fields: [
                { type: 'mrkdwn', text: '*Où*\nFoyer' },
                { type: 'mrkdwn', text: '*Catégorie*\nSoirée' },
              ],
            },
            {
              type: 'context',
              elements: [
                { type: 'image', image_url: 'https://bde.example.fr/logo.png', alt_text: 'BDE' },
                { type: 'mrkdwn', text: 'BDE Nice · BDE_Network' },
              ],
            },
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: { type: 'plain_text', text: "Voir l'événement" },
                  url: 'https://bde.example.fr/x',
                },
              ],
            },
          ],
        },
      },
      {},
    );
    const root = screen.getByTestId('preview-slack');
    expect(root).toHaveTextContent('Salut @here');
    expect(root).toHaveTextContent('Soirée');
    expect(root).toHaveTextContent('Foyer');
    expect(root).toHaveTextContent('BDE Nice · BDE_Network');
    expect(root).toHaveTextContent("Voir l'événement");
    expect(view.container.querySelector('img')).toHaveAttribute('alt', 'BDE');
    expect(root.querySelector('a')).toBeNull();
  });
});

describe('an e-mail', () => {
  it('is shown in a frame that runs nothing and follows no link', () => {
    show({
      channel: 'email',
      mail: { html: '<p>Bonjour</p><script>alert(1)</script>', text: 'Bonjour' },
    });
    const frame = screen.getByTestId('preview-email');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('sandbox', '');
    expect(frame).toHaveAttribute('srcdoc', expect.stringContaining('Bonjour'));
    expect(frame).toHaveAttribute('title', "Aperçu de l'e-mail");
  });
});
