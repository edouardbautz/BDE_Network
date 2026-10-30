import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../../messages/en.json';
import fr from '../../../messages/fr.json';
import { DescriptionField } from './description-field';

afterEach(() => {
  cleanup();
  // @ts-expect-error: jsdom has no such command, a test may add one
  delete document.execCommand;
});

// The real messages, the real formatter: what a member reads is what is tested.
function renderField(
  defaultValue = '',
  { locale = 'fr', maxLength = 5000 }: { locale?: 'fr' | 'en'; maxLength?: number } = {},
) {
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'fr' ? fr : en}>
      <form data-testid="form">
        <DescriptionField defaultValue={defaultValue} maxLength={maxLength} />
      </form>
    </NextIntlClientProvider>,
  );
  return screen.getByRole('textbox') as HTMLTextAreaElement;
}

const select = (area: HTMLTextAreaElement, start: number, end = start) => {
  area.focus();
  area.setSelectionRange(start, end);
};
const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

describe('the help under the description', () => {
  it('is short and names no school, no form and no format a member would not know', () => {
    renderField();
    const help = screen.getByText(/Mise en forme possible/);
    expect(help).toHaveTextContent('Mise en forme possible : gras, italique, listes, liens.');
    for (const word of [/intra/i, /Markdown/i, /Nice/, /formulaire/i, /#/, /\*\*/]) {
      expect(help.textContent).not.toMatch(word);
    }
  });

  it('is read with the field, in both languages', () => {
    const area = renderField();
    expect(area).toHaveAccessibleDescription(
      'Mise en forme possible : gras, italique, listes, liens.',
    );
    cleanup();
    expect(renderField('', { locale: 'en' })).toHaveAccessibleDescription(
      'Formatting is possible: bold, italic, lists, links.',
    );
  });
});

describe('the bar of buttons', () => {
  it('has a button for each format, named, in one toolbar', () => {
    renderField();
    const bar = screen.getByRole('toolbar', { name: 'Mise en forme' });
    const names = Array.from(bar.querySelectorAll('button')).map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(names).toEqual([
      'Gras',
      'Italique',
      'Titre',
      'Liste à puces',
      'Liste numérotée',
      'Lien',
    ]);
    expect(bar).toHaveAttribute('aria-controls', 'description');
  });

  it('is one stop of the keyboard, moved by the arrows, Home and End', () => {
    renderField();
    const buttons = screen.getAllByRole('button').filter((b) => b.closest('[role="toolbar"]'));
    expect(buttons.map((b) => b.tabIndex)).toEqual([0, -1, -1, -1, -1, -1]);
    buttons[0]!.focus();
    fireEvent.keyDown(buttons[0]!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(buttons[1]);
    expect(buttons.map((b) => b.tabIndex)).toEqual([-1, 0, -1, -1, -1, -1]);
    fireEvent.keyDown(buttons[1]!, { key: 'End' });
    expect(document.activeElement).toBe(buttons[5]);
    fireEvent.keyDown(buttons[5]!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(buttons[0]!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(buttons[5]);
    fireEvent.keyDown(buttons[5]!, { key: 'Home' });
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('does not submit the form', () => {
    const area = renderField('un mot');
    const submitted = vi.fn((event: Event) => event.preventDefault());
    screen.getByTestId('form').addEventListener('submit', submitted);
    select(area, 0, 6);
    press('Gras');
    expect(submitted).not.toHaveBeenCalled();
  });

  it('puts bold marks around the selection, keeps it selected, and gives the focus back to the field', () => {
    const area = renderField('une soirée ici');
    select(area, 4, 10);
    press('Gras');
    expect(area.value).toBe('une **soirée** ici');
    expect([area.selectionStart, area.selectionEnd]).toEqual([6, 12]);
    expect(document.activeElement).toBe(area);
    press('Gras');
    expect(area.value).toBe('une soirée ici');
  });

  it('puts a word to type where nothing is selected', () => {
    const area = renderField('');
    press('Italique');
    expect(area.value).toBe('*texte en italique*');
    expect(area.value.slice(area.selectionStart, area.selectionEnd)).toBe('texte en italique');
  });

  it('makes lists, a heading and a link', () => {
    const area = renderField('a\nb');
    select(area, 0, 3);
    press('Liste à puces');
    expect(area.value).toBe('- a\n- b');
    press('Liste numérotée');
    expect(area.value).toBe('1. a\n2. b');
    press('Titre');
    expect(area.value).toBe('## a\n## b');
    cleanup();
    const other = renderField('voir le site');
    select(other, 5, 12);
    press('Lien');
    expect(other.value).toBe('voir [le site](https://)');
    expect(other.value.slice(other.selectionStart, other.selectionEnd)).toBe('https://');
  });

  it('the text that is sent is the Markdown typed, and the preview draws it', () => {
    const area = renderField('une soirée');
    select(area, 4, 10);
    press('Gras');
    const form = screen.getByTestId('form') as HTMLFormElement;
    expect(new FormData(form).get('description')).toBe('une **soirée**');
    const preview = screen.getByRole('region', { name: 'Aperçu' });
    expect(preview.querySelector('strong')).toHaveTextContent('soirée');
  });

  it('refuses a change that would pass the limit of the field', () => {
    const area = renderField('abcdef', { maxLength: 8 });
    select(area, 0, 6);
    press('Gras');
    expect(area.value).toBe('abcdef');
  });
});

describe('the keyboard shortcuts of the field', () => {
  it('Ctrl+B and Cmd+I format the selection, and the browser does not get them', () => {
    const area = renderField('un mot');
    select(area, 3, 6);
    expect(fireEvent.keyDown(area, { key: 'b', ctrlKey: true })).toBe(false);
    expect(area.value).toBe('un **mot**');
    select(area, 0, 2);
    fireEvent.keyDown(area, { key: 'i', metaKey: true });
    expect(area.value).toBe('*un* **mot**');
  });

  it('leave the other keys alone', () => {
    const area = renderField('un mot');
    select(area, 3, 6);
    expect(fireEvent.keyDown(area, { key: 'k', ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(area, { key: 'b', ctrlKey: true, shiftKey: true })).toBe(true);
    expect(fireEvent.keyDown(area, { key: 'b' })).toBe(true);
    expect(area.value).toBe('un mot');
  });
});

describe('the undo history', () => {
  beforeEach(() => {
    // a browser's `insertText`: types into the field the way a person would (an `input` event), which is what keeps the undo history
    document.execCommand = vi.fn((command: string, _ui?: boolean, value?: string) => {
      const area = document.activeElement as HTMLTextAreaElement;
      if (command === 'insertText')
        area.setRangeText(value ?? '', area.selectionStart, area.selectionEnd, 'end');
      else if (command === 'delete')
        area.setRangeText('', area.selectionStart, area.selectionEnd, 'end');
      else return false;
      area.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    });
  });

  it('types only what changes, with the command of the browser, and keeps the selection of the result', () => {
    const area = renderField('une soirée ici');
    select(area, 4, 10);
    act(() => press('Gras'));
    expect(document.execCommand).toHaveBeenCalledWith('insertText', false, '**soirée**');
    expect(area.value).toBe('une **soirée** ici');
    expect([area.selectionStart, area.selectionEnd]).toEqual([6, 12]);
    // and what the state holds is what the field holds: the preview and the form agree
    expect(
      screen.getByRole('region', { name: 'Aperçu' }).querySelector('strong'),
    ).toHaveTextContent('soirée');
  });

  it('takes marks off with the command that deletes, when nothing else changes', () => {
    const area = renderField('- a');
    select(area, 0, 3);
    act(() => press('Liste à puces'));
    expect(area.value).toBe('a');
    expect(document.execCommand).toHaveBeenCalledWith('delete');
  });

  it('sets the text itself when the browser refuses the command', () => {
    (document.execCommand as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const area = renderField('une soirée ici');
    select(area, 4, 10);
    act(() => press('Gras'));
    expect(area.value).toBe('une **soirée** ici');
  });
});

describe('the preview', () => {
  it('is a tab on a phone, and shows what is typed drawn, never as HTML', () => {
    const area = renderField('un <b>mot</b> [piège](javascript:alert(1)) et **gras**');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Écrire', 'Aperçu']);
    fireEvent.click(tabs[1]!);
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    const preview = screen.getByRole('region', { name: 'Aperçu' });
    expect(preview.querySelector('b')).toBeNull();
    expect(preview.querySelector('a')).toBeNull();
    expect(preview.querySelector('strong')).toHaveTextContent('gras');
    expect(preview).toHaveTextContent('<b>mot</b>');
    expect(area.value).toContain('<b>');
  });

  it('says what it is for while there is nothing to draw', () => {
    renderField('');
    expect(screen.getByRole('region', { name: 'Aperçu' })).toHaveTextContent(
      "L'aperçu s'affichera ici.",
    );
  });
});
