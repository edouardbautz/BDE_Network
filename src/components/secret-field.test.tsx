import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';
import { MaskedInput, NO_AUTOFILL, SecretField } from './secret-field';

afterEach(cleanup);

const WEBHOOK_END = 'a1b2';

/** A field with its state, as a form holds it, in the real messages. */
function Harness({
  saved = true,
  tail = WEBHOOK_END,
  onRemove,
  locale = 'fr',
  initial = '',
  onValue,
}: {
  saved?: boolean;
  tail?: string | null;
  onRemove?: () => void;
  locale?: 'fr' | 'en';
  initial?: string;
  onValue?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <NextIntlClientProvider locale={locale} messages={locale === 'fr' ? fr : en}>
      <form>
        <SecretField
          id="webhook"
          label="Adresse du webhook"
          saved={saved}
          tail={tail}
          value={value}
          onChange={(next) => {
            setValue(next);
            onValue?.(next);
          }}
          hint="Collez l'adresse."
          onRemove={onRemove}
        />
      </form>
    </NextIntlClientProvider>
  );
}

describe('a secret that is not saved yet', () => {
  it('is a masked field that no browser or password manager takes for a login', () => {
    render(<Harness saved={false} />);
    const field = screen.getByLabelText('Adresse du webhook');
    expect(field).toHaveAttribute('type', 'text');
    expect(field).toHaveAttribute('autocomplete', 'off');
    expect(field).toHaveAttribute('data-lpignore', 'true');
    expect(field).toHaveAttribute('data-1p-ignore', 'true');
    expect(field).toHaveAttribute('data-bwignore', 'true');
    expect(field).toHaveAttribute('data-form-type', 'other');
    expect(field).toHaveAttribute('autocapitalize', 'none');
    expect(field).toHaveAttribute('autocorrect', 'off');
    expect(field).toHaveAttribute('spellcheck', 'false');
    // the dots come from the style, in the three engines, and not from a field of the type "password"
    expect(field.className).toContain('[-webkit-text-security:disc]');
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.getByText("Collez l'adresse.")).toBeInTheDocument();
  });

  it('offers no Replace and no Cancel: there is nothing to replace', () => {
    render(<Harness saved={false} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('a secret that is saved', () => {
  it('is not a field: it says "Configured" and how it ends, and the browser has nothing to fill', () => {
    render(<Harness />);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.querySelector('input')).toBeNull();
    expect(screen.getByRole('group', { name: 'Adresse du webhook' })).toHaveTextContent(
      'Configuré · se termine par …a1b2',
    );
  });

  it('says only "Configured" when the server did not say how it ends', () => {
    render(<Harness tail={null} />);
    const group = screen.getByRole('group', { name: 'Adresse du webhook' });
    expect(group).toHaveTextContent('Configuré');
    expect(group).not.toHaveTextContent('se termine');
  });

  it('speaks English', () => {
    render(<Harness locale="en" />);
    expect(screen.getByRole('group', { name: 'Adresse du webhook' })).toHaveTextContent(
      'Configured · ends with …a1b2',
    );
    expect(screen.getByRole('button', { name: 'Replace: Adresse du webhook' })).toBeInTheDocument();
  });

  it('opens an empty field with Replace, and says that empty keeps the saved one', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Remplacer : Adresse du webhook' }));
    const field = screen.getByLabelText('Adresse du webhook');
    expect(field).toHaveValue('');
    expect(field).toHaveAttribute('type', 'text');
    expect(field).toHaveAttribute('data-1p-ignore', 'true');
    expect(
      screen.getByText('Laissez vide pour garder celui qui est enregistré.'),
    ).toBeInTheDocument();
    // the generic hint of the field is for the field that has nothing yet
    expect(screen.queryByText("Collez l'adresse.")).toBeNull();
  });

  it('gives the typed text to the form, and Cancel empties it and closes the field', () => {
    const typed = vi.fn();
    render(<Harness onValue={typed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remplacer : Adresse du webhook' }));
    fireEvent.change(screen.getByLabelText('Adresse du webhook'), {
      target: { value: 'https://discord.com/api/webhooks/1/new' },
    });
    expect(typed).toHaveBeenLastCalledWith('https://discord.com/api/webhooks/1/new');
    fireEvent.click(
      screen.getByRole('button', { name: 'Annuler le remplacement : Adresse du webhook' }),
    );
    expect(typed).toHaveBeenLastCalledWith('');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('group', { name: 'Adresse du webhook' })).toHaveTextContent(
      'Configuré',
    );
  });

  it('stays open as long as something is typed (a page drawn again does not hide it)', () => {
    render(<Harness initial="https://discord.com/api/webhooks/1/typed" />);
    expect(screen.getByLabelText('Adresse du webhook')).toHaveValue(
      'https://discord.com/api/webhooks/1/typed',
    );
  });

  it('has a Remove only when it is given something to do, and does it', () => {
    const { unmount } = render(<Harness />);
    expect(screen.queryByRole('button', { name: /Retirer/ })).toBeNull();
    unmount();
    const remove = vi.fn();
    render(<Harness onRemove={remove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retirer : Adresse du webhook' }));
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('names its buttons with the words they show (WCAG 2.5.3)', () => {
    render(<Harness onRemove={() => undefined} />);
    for (const [shown, name] of [
      ['Remplacer', 'Remplacer : Adresse du webhook'],
      ['Retirer', 'Retirer : Adresse du webhook'],
    ]) {
      const button = screen.getByRole('button', { name });
      expect(button).toHaveTextContent(shown!);
    }
  });
});

describe('the attributes that keep browsers and password managers away', () => {
  it('are the same everywhere a service identifier is typed', () => {
    render(<MaskedInput aria-label="phrase" />);
    const field = screen.getByLabelText('phrase');
    for (const [name, value] of Object.entries(NO_AUTOFILL)) {
      expect(field.getAttribute(name.toLowerCase()), name).toBe(String(value));
    }
    expect(field).toHaveAttribute('type', 'text');
  });

  it('never name a field "password" to a manager: no field of the type password at all', () => {
    expect(NO_AUTOFILL.autoComplete).toBe('off');
    expect(JSON.stringify(NO_AUTOFILL)).not.toMatch(/password/i);
  });
});
