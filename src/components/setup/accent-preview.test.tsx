import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import fr from '../../../messages/fr.json';
import { AccentPreview } from './accent-preview';

afterEach(cleanup);

const show = (color: string, name = 'BDE Test') =>
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <AccentPreview color={color} name={name} />
    </NextIntlClientProvider>,
  );

describe('AccentPreview', () => {
  it('shows a button, a link and the card of the accent, in the light and in the dark theme', () => {
    show('#2F5BEA');
    for (const theme of ['Clair', 'Sombre']) {
      const box = screen.getByRole('group', { name: `Aperçu: ${theme}` });
      expect(within(box).getByText('Bouton')).toBeInTheDocument();
      expect(within(box).getByText('Lien')).toBeInTheDocument();
      expect(within(box).getByText('BDE Test')).toBeInTheDocument();
    }
  });

  it('forces each theme on its box and gives it the tokens of the colour', () => {
    show('#E4572E');
    const light = screen.getByRole('group', { name: 'Aperçu: Clair' });
    const dark = screen.getByRole('group', { name: 'Aperçu: Sombre' });
    expect(light).toHaveClass('light');
    expect(dark).toHaveClass('dark');
    // an orange takes dark text: the tokens of both themes say so
    expect(light.style.getPropertyValue('--accent-on-l')).toBe('#111111');
    expect(dark.style.getPropertyValue('--accent-fill-d')).toBe('#E4572E');
  });

  it('says the colour was adjusted only when it had to be', () => {
    const note = 'Votre couleur a été légèrement ajustée pour rester lisible sur les boutons.';
    show('#2F5BEA');
    expect(screen.queryByText(note)).not.toBeInTheDocument();
    cleanup();
    // a grey that neither white nor dark text can carry
    show('#797979');
    expect(screen.getByText(note)).toBeInTheDocument();
  });

  it('writes the placeholder name while the BDE has none', () => {
    show('#2F5BEA', '  ');
    expect(screen.getAllByText(fr.setup.identity.namePlaceholder)).toHaveLength(2);
  });
});
