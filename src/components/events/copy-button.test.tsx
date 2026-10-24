import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CopyButton } from './copy-button';

const words = { copyLabel: 'Copier', copiedLabel: 'Copié', failedLabel: 'Copie impossible' };

const draw = (value: string) =>
  render(<CopyButton value={value} fieldName="Heure de début" {...words} />);

const clipboard = (writeText: (text: string) => Promise<void>) =>
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
});

describe('CopyButton', () => {
  it('is named by its visible word and by the field it copies', () => {
    draw('18:00');
    // the visible word is part of the name (WCAG 2.5.3): "Copier", then the field for a screen reader
    expect(screen.getByRole('button', { name: 'Copier Heure de début' })).toBeTruthy();
  });

  it('puts the value, exactly, on the clipboard and says it is copied for two seconds', async () => {
    const writeText = vi.fn(async () => undefined);
    clipboard(writeText);
    draw('  Venez avec **vos** jeux\nà 18:00  ');

    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
    });

    expect(writeText).toHaveBeenCalledWith('  Venez avec **vos** jeux\nà 18:00  ');
    expect(screen.getByRole('button').textContent).toContain('Copié');

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('button').textContent).toContain('Copier');
    expect(screen.getByRole('button').textContent).not.toContain('Copié');
  });

  it('falls back on the old way when the page has no clipboard (an installation without HTTPS)', async () => {
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    draw('18:00');

    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
    });

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(screen.getByRole('button').textContent).toContain('Copié');
    // the field it used for it is gone again
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('says so when neither way works, and does not claim to have copied', async () => {
    clipboard(async () => {
      throw new Error('denied');
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
    draw('18:00');

    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
    });

    expect(screen.getByRole('button').textContent).toContain('Copie impossible');
    expect(screen.getByRole('button').textContent).not.toContain('Copié');
  });
});
