import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fr from '../../../messages/fr.json';
import { VariableField, type VariableChoice } from './variable-field';

afterEach(cleanup);

const NAMES = { title: 'titre', place: 'lieu' };
const CHOICES: VariableChoice[] = [
  { id: 'title', name: 'titre', label: "Titre de l'événement", sample: 'Soirée' },
  { id: 'place', name: 'lieu', label: 'Lieu', sample: 'Foyer' },
];

/** The field with a state of its own, as the editor holds it: what is stored is what is passed down. */
function Harness({
  initial = '',
  onStored,
  ...props
}: Partial<React.ComponentProps<typeof VariableField>> & {
  initial?: string;
  onStored?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <NextIntlClientProvider locale="fr" messages={fr}>
      <VariableField
        id="f"
        label="Titre"
        value={value}
        onChange={(next) => {
          setValue(next);
          onStored?.(next);
        }}
        names={NAMES}
        choices={CHOICES}
        {...props}
      />
    </NextIntlClientProvider>
  );
}

describe('a text with variables', () => {
  it('shows the stored identifiers by their names, and stores what is typed by identifier', () => {
    const stored = vi.fn();
    render(<Harness initial="{title} à {place}" onStored={stored} />);
    const field = screen.getByLabelText('Titre');
    expect(field).toHaveValue('{titre} à {lieu}');
    fireEvent.change(field, { target: { value: '{titre} chez {lieu}' } });
    expect(stored).toHaveBeenLastCalledWith('{title} chez {place}');
  });

  it('inserts a variable where the cursor is, from the menu, and keeps the cursor after it', async () => {
    const stored = vi.fn();
    render(<Harness initial="Bonjour !" onStored={stored} />);
    const field = screen.getByLabelText('Titre') as HTMLInputElement;
    field.focus();
    field.setSelectionRange(8, 8);
    fireEvent.click(screen.getByRole('button', { name: 'Insérer une variable' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /\{titre\}/ }));
    expect(stored).toHaveBeenLastCalledWith('Bonjour {title}!');
    await vi.waitFor(() => expect(field.selectionStart).toBe(15));
  });

  it('replaces the selection', async () => {
    const stored = vi.fn();
    render(<Harness initial="un deux trois" onStored={stored} />);
    const field = screen.getByLabelText('Titre') as HTMLInputElement;
    field.setSelectionRange(3, 7);
    fireEvent.click(screen.getByRole('button', { name: 'Insérer une variable' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /\{lieu\}/ }));
    expect(stored).toHaveBeenLastCalledWith('un {place} trois');
  });

  it('offers no menu when there is nothing to insert, and none when it is disabled', () => {
    render(<Harness choices={[]} />);
    expect(screen.queryByRole('button', { name: 'Insérer une variable' })).toBeNull();
    cleanup();
    render(<Harness disabled />);
    expect(screen.getByRole('button', { name: 'Insérer une variable' })).toBeDisabled();
    expect(screen.getByLabelText('Titre')).toBeDisabled();
  });

  it('puts bold or italic around the selection, or marks where to type when nothing is selected', () => {
    const stored = vi.fn();
    render(<Harness initial="un mot ici" formatting multiline onStored={stored} />);
    const field = screen.getByLabelText('Titre') as HTMLTextAreaElement;
    field.setSelectionRange(3, 6);
    fireEvent.click(screen.getByRole('button', { name: 'Gras' }));
    expect(stored).toHaveBeenLastCalledWith('un **mot** ici');
    field.setSelectionRange(0, 0);
    fireEvent.click(screen.getByRole('button', { name: 'Italique' }));
    expect(stored).toHaveBeenLastCalledWith('__un **mot** ici');
  });

  it('offers no formatting unless asked', () => {
    render(<Harness />);
    expect(screen.queryByRole('button', { name: 'Gras' })).toBeNull();
  });

  it('links its hint and its error to the field, and says it is invalid', () => {
    render(<Harness hint="Un indice" error="Variable inconnue" />);
    const field = screen.getByLabelText('Titre');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field.getAttribute('aria-describedby')).toBe('f-hint f-error');
    expect(screen.getByRole('alert')).toHaveTextContent('Variable inconnue');
    expect(screen.getByText('Un indice')).toHaveAttribute('id', 'f-hint');
  });

  it('holds more than a line when asked, and shows what sits next to the menu', () => {
    render(<Harness multiline extra={<button type="button">Plus</button>} placeholder="Écrire" />);
    expect(screen.getByLabelText('Titre').tagName).toBe('TEXTAREA');
    expect(screen.getByPlaceholderText('Écrire')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Plus' })).toBeInTheDocument();
  });
});
