import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DiscordDescription, discordInline, slackInline } from './markup';

afterEach(cleanup);

const text = (nodes: React.ReactNode) =>
  render(<p>{nodes}</p>).container.firstElementChild as HTMLElement;

describe('the markup of a Discord card', () => {
  it('draws bold, italic (both spellings) and links', () => {
    const out = text(discordInline('**gras** *ital* _aussi_ [site](https://exemple.fr/x)', 'fr'));
    expect(out.querySelector('strong')).toHaveTextContent('gras');
    expect([...out.querySelectorAll('em')].map((el) => el.textContent)).toEqual(['ital', 'aussi']);
    expect(out).toHaveTextContent('site');
    expect(out.querySelector('a')).toBeNull(); // a picture of a link, never one to follow
  });

  it('draws each style of the date markup in the language of the BDE', () => {
    const seconds = Math.floor(new Date('2026-10-26T18:30:00Z').getTime() / 1000);
    const draw = (style: string) =>
      text(discordInline(`<t:${seconds}:${style}>`, 'fr')).textContent ?? '';
    expect(draw('t')).toMatch(/\d{2}:\d{2}/);
    expect(draw('T')).toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(draw('d')).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(draw('D')).toContain('octobre 2026');
    expect(draw('f')).toContain('octobre 2026');
    expect(draw('F')).toContain('octobre 2026');
    expect(text(discordInline(`<t:${seconds}>`, 'fr')).textContent).toContain('2026');
  });

  it('draws a relative date as minutes, hours or days', () => {
    const now = Math.floor(Date.now() / 1000);
    const draw = (delta: number) => text(discordInline(`<t:${now + delta}:R>`, 'en')).textContent;
    expect(draw(5 * 60)).toMatch(/minute/);
    expect(draw(3 * 3600)).toMatch(/hour/);
    expect(draw(3 * 86400)).toMatch(/day|3/);
  });

  it('draws mentions as chips, by the name of the directory', () => {
    const out = text(
      discordInline('<@&123> <@456> <@!789> @everyone @here <@&999>', 'fr', {
        '123': 'Bureau',
        '456': 'Paula',
        '789': 'Sam',
      }),
    );
    expect(out.textContent).toBe('@Bureau @Paula @Sam @everyone @here @…');
  });

  it('leaves what is not markup alone', () => {
    expect(text(discordInline('a * b _ c < d', 'fr')).textContent).toBe('a * b _ c < d');
  });

  it('draws the description of a card: small line, headings, quotes, paragraphs and blank lines', () => {
    const view = render(
      <DiscordDescription
        locale="fr"
        text={
          '-# NOUVEL ÉVÉNEMENT\n​\n### Titre **fort**\n> une citation\n> sur deux lignes\n​\nUn texte'
        }
      />,
    );
    expect(screen.getByText('NOUVEL ÉVÉNEMENT')).toHaveClass('text-muted-foreground');
    expect(view.container.querySelector('strong')).toHaveTextContent('fort');
    const quote = view.container.querySelector('blockquote')!;
    expect(quote).toHaveTextContent('une citation');
    expect(quote.children).toHaveLength(2);
    expect(screen.getByText('Un texte')).toBeInTheDocument();
  });

  it('draws an empty quote line', () => {
    const view = render(<DiscordDescription locale="fr" text={'> a\n>\n> b'} />);
    expect(view.container.querySelector('blockquote')!.children).toHaveLength(3);
  });
});

describe('the markup of a Slack message', () => {
  it('draws bold, italic and line breaks', () => {
    const out = text(slackInline('*gras* et _ital_\nligne deux'));
    expect(out.querySelector('strong')).toHaveTextContent('gras');
    expect(out.querySelector('em')).toHaveTextContent('ital');
    expect(out.querySelector('br')).not.toBeNull();
  });

  it('draws a date as its fallback, and links by their label or address', () => {
    const out = text(
      slackInline(
        '<!date^1791655200^{date_long} {time}|samedi 10 octobre> <https://a.fr|le site> <https://b.fr>',
      ),
    );
    expect(out.textContent).toBe('samedi 10 octobre le site https://b.fr');
  });

  it('draws mentions as chips, by the name of the directory', () => {
    const out = text(
      slackInline('<!channel> <!here> <!everyone> <!subteam^S1> <@U1> <!subteam^S9> <@U9>', {
        S1: 'Bureau',
        U1: 'Paula',
      }),
    );
    expect(out.textContent).toBe('@channel @here @everyone @Bureau @Paula @… @…');
  });
});
