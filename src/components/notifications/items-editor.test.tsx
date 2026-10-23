import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ItemRow } from '@/lib/notifications/templates/draft';
import fr from '../../../messages/fr.json';
import { ItemsEditor } from './items-editor';

afterEach(cleanup);

const row = (id: ItemRow['id'], over: Partial<ItemRow> = {}): ItemRow => ({
  id,
  enabled: true,
  custom: false,
  label: '',
  ownLabel: false,
  emoji: '',
  ownEmoji: false,
  ...over,
});

function Harness({
  initial,
  scope = 'discord',
  problems = [],
  disabled,
  onRows,
}: {
  initial: ItemRow[];
  scope?: 'all' | 'discord' | 'slack' | 'email';
  problems?: string[];
  disabled?: boolean;
  onRows?: (rows: ItemRow[], moved: boolean) => void;
}) {
  const [rows, setRows] = useState(initial);
  return (
    <NextIntlClientProvider locale="fr" messages={fr}>
      <ItemsEditor
        idPrefix="p"
        rows={rows}
        onRowsChange={(next, moved) => {
          setRows(next);
          onRows?.(next, moved);
        }}
        scope={scope}
        names={{ title: 'titre' }}
        choices={[]}
        hasLabel={(id) => id !== 'description'}
        problems={problems}
        disabled={disabled}
      />
    </NextIntlClientProvider>
  );
}

describe('the list of facts', () => {
  it('has the name and the emoji of a fact on Discord, and only the name elsewhere', () => {
    render(<Harness initial={[row('when', { label: 'Quand', emoji: '📅' })]} />);
    expect(screen.getByLabelText('Intitulé')).toHaveValue('Quand');
    expect(screen.getByLabelText('Emoji')).toHaveValue('📅');
    cleanup();
    render(<Harness scope="slack" initial={[row('when', { label: 'Quand' })]} />);
    expect(screen.getByLabelText('Intitulé')).toBeInTheDocument();
    expect(screen.queryByLabelText('Emoji')).toBeNull();
  });

  it('has no name to give to a fact that is not named', () => {
    render(<Harness scope="slack" initial={[row('description')]} />);
    expect(screen.queryByLabelText('Intitulé')).toBeNull();
  });

  it('writes the name and the emoji as the BDE’s own', () => {
    const onRows = vi.fn();
    render(<Harness initial={[row('when', { label: 'Quand', emoji: '📅' })]} onRows={onRows} />);
    fireEvent.change(screen.getByLabelText('Intitulé'), { target: { value: 'Date' } });
    expect(onRows.mock.lastCall![0][0]).toMatchObject({ label: 'Date', ownLabel: true });
    fireEvent.change(screen.getByLabelText('Emoji'), { target: { value: ' 🗓️ ' } });
    expect(onRows.mock.lastCall![0][0]).toMatchObject({ emoji: '🗓️', ownEmoji: true });
    expect(onRows.mock.lastCall![1]).toBe(false);
  });

  it('shows no field for a fact that is switched off', () => {
    render(<Harness initial={[row('when', { label: 'Quand', enabled: false })]} />);
    expect(screen.queryByLabelText('Intitulé')).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'Date et heure' }));
    expect(screen.getByLabelText('Intitulé')).toBeInTheDocument();
  });

  it('writes the sentence of a summary', () => {
    const onRows = vi.fn();
    render(
      <Harness
        initial={[row('summary', { text: '{name} demande.' })]}
        onRows={onRows}
        scope="slack"
      />,
    );
    fireEvent.change(screen.getByLabelText('Texte de la phrase'), {
      target: { value: 'Salut {titre}' },
    });
    expect(onRows.mock.lastCall![0][0]).toMatchObject({ text: 'Salut {title}', ownText: true });
  });

  it('adds a free text at the end, says the order is the BDE’s now, and takes it away', () => {
    const onRows = vi.fn();
    render(<Harness initial={[row('when')]} onRows={onRows} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter un texte' }));
    expect(onRows.mock.lastCall![1]).toBe(true);
    const added = onRows.mock.lastCall![0][1] as ItemRow;
    expect(added.id).toMatch(/^text:[a-z0-9]{6}$/);
    expect(added.custom).toBe(true);
    const free = screen.getByTestId(`item-${added.id}`);
    fireEvent.change(within(free).getByLabelText('Texte'), { target: { value: 'Venez' } });
    expect(onRows.mock.lastCall![0][1]).toMatchObject({ text: 'Venez' });
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer : Texte libre' }));
    expect(onRows.mock.lastCall![0]).toHaveLength(1);
    expect(onRows.mock.lastCall![1]).toBe(false);
  });

  it('stops offering to add texts at eight', () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      row(`text:aaaaa${i}`, { custom: true, text: 'x', ownText: true }),
    );
    render(<Harness initial={rows} />);
    expect(screen.getByRole('button', { name: 'Ajouter un texte' })).toBeDisabled();
  });

  it('moves a fact up or down, saying it moved, and cannot move the first up nor the last down', () => {
    const onRows = vi.fn();
    render(<Harness initial={[row('when'), row('where'), row('category')]} onRows={onRows} />);
    expect(screen.getByRole('button', { name: 'Monter : Date et heure' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Descendre : Catégorie' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Descendre : Date et heure' }));
    expect(onRows.mock.lastCall![0].map((r: ItemRow) => r.id)).toEqual([
      'where',
      'when',
      'category',
    ]);
    expect(onRows.mock.lastCall![1]).toBe(true);
  });

  it('lists the problems found, and locks everything while disabled', () => {
    render(
      <Harness initial={[row('when', { label: 'Quand' })]} problems={['Trop long']} disabled />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Trop long');
    expect(screen.getByRole('switch', { name: 'Date et heure' })).toHaveAttribute('data-disabled');
    expect(screen.getByLabelText('Intitulé')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ajouter un texte' })).toBeDisabled();
  });
});
