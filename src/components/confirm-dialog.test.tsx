import { useRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => `confirmDialog.${key}`,
}));

const { ConfirmDialog } = await import('./confirm-dialog');

afterEach(cleanup);

/** A promise the test settles by hand, to look at the dialog while the action is "on its way". */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

function renderDialog(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn(async () => undefined);
  const onCancel = vi.fn();
  const view = render(
    <ConfirmDialog
      title="Retirer Jean ?"
      description="Son compte est supprimé définitivement."
      confirmLabel="Retirer"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    >
      Retirer du BDE
    </ConfirmDialog>,
  );
  return { ...view, onConfirm, onCancel };
}

const trigger = () => screen.getByRole('button', { name: 'Retirer du BDE' });
const openDialog = async () => {
  fireEvent.click(trigger());
  return screen.findByRole('dialog');
};

describe('ConfirmDialog — what it shows', () => {
  it('stays closed until the button is pressed, then centers a titled, described dialog', async () => {
    renderDialog();
    expect(screen.queryByRole('dialog')).toBeNull();

    const dialog = await openDialog();

    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Retirer Jean ?' })).toBeTruthy();
    expect(screen.getByText('Son compte est supprimé définitivement.')).toBeTruthy();
    expect(dialog.className).toContain('fixed');
    expect(dialog.className).toContain('top-1/2');
    expect(dialog.className).toContain('left-1/2');
  });

  it('offers a Cancel button and an action button in destructive style', async () => {
    renderDialog();
    await openDialog();

    expect(screen.getByRole('button', { name: 'confirmDialog.cancel' })).toBeTruthy();
    const action = screen.getByRole('button', { name: 'Retirer' });
    expect(action.className).toContain('text-destructive');
  });

  it('uses the primary style for a change that can be undone', async () => {
    renderDialog({ tone: 'default' });
    await openDialog();

    expect(screen.getByRole('button', { name: 'Retirer' }).className).toContain('bg-primary');
  });
});

describe('ConfirmDialog — keyboard and focus', () => {
  it('puts the focus on Cancel, not on the destructive button', async () => {
    renderDialog();
    await openDialog();

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'confirmDialog.cancel' }),
      ),
    );
  });

  it('keeps the focus inside while Tab goes round', async () => {
    renderDialog();
    const dialog = await openDialog();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    for (let press = 0; press < 5; press += 1) {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab' });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('closes on Escape without confirming, and gives the focus back to the button', async () => {
    const { onConfirm, onCancel } = renderDialog();
    await openDialog();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.activeElement).toBe(trigger()));
  });

  it('closes on Cancel and gives the focus back to the button', async () => {
    const { onConfirm, onCancel } = renderDialog();
    await openDialog();

    fireEvent.click(screen.getByRole('button', { name: 'confirmDialog.cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.activeElement).toBe(trigger()));
  });

  it('closes on a click outside, without confirming', async () => {
    const { onConfirm, onCancel } = renderDialog();
    await openDialog();

    const backdrop = document.querySelector('[data-slot="dialog-overlay"]') as HTMLElement;
    fireEvent.pointerDown(backdrop);
    fireEvent.mouseDown(backdrop);
    fireEvent.pointerUp(backdrop);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('ConfirmDialog — confirming', () => {
  it('runs the action once and closes when it is done', async () => {
    const { onConfirm } = renderDialog();
    await openDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Retirer' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('is busy while it runs: the button cannot be pressed twice and says it is working', async () => {
    const running = deferred();
    const onConfirm = vi.fn(() => running.promise);
    renderDialog({ onConfirm });
    await openDialog();

    const action = screen.getByRole('button', { name: 'Retirer' });
    fireEvent.click(action);
    await waitFor(() => expect(action.getAttribute('aria-busy')).toBe('true'));
    fireEvent.click(action);
    fireEvent.click(action);

    expect(action.hasAttribute('disabled') || action.getAttribute('aria-disabled') === 'true').toBe(
      true,
    );
    expect(action.querySelector('svg.animate-spin')).not.toBeNull();
    expect(screen.getByText(/confirmDialog\.working/)).toBeTruthy();
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await act(async () => running.resolve());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('cannot be dismissed while the action is on its way', async () => {
    const running = deferred();
    const { onCancel } = renderDialog({ onConfirm: () => running.promise });
    await openDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Retirer' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Retirer/ }).getAttribute('aria-busy')).toBe(
        'true',
      ),
    );

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'confirmDialog.cancel' }));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(onCancel).not.toHaveBeenCalled();
    await act(async () => running.resolve());
  });
});

describe('ConfirmDialog — controlled by something that is not a button', () => {
  function WithSelect({ onConfirm }: { onConfirm: () => Promise<void> }) {
    const ref = useRef<HTMLSelectElement>(null);
    const [candidate, setCandidate] = useState<string | null>(null);
    return (
      <>
        <select
          ref={ref}
          aria-label="role"
          value="a"
          onChange={(e) => setCandidate(e.target.value)}
        >
          <option value="a">A</option>
          <option value="b">B</option>
        </select>
        <ConfirmDialog
          open={candidate !== null}
          onOpenChange={(open) => !open && setCandidate(null)}
          returnFocusRef={ref}
          tone="default"
          title="Changer ?"
          description="Vers B"
          confirmLabel="Changer"
          onConfirm={onConfirm}
        />
      </>
    );
  }

  it('opens from a menu change and has no button of its own', async () => {
    render(<WithSelect onConfirm={async () => undefined} />);
    expect(screen.queryByRole('button', { name: 'Changer' })).toBeNull();

    fireEvent.change(screen.getByLabelText('role'), { target: { value: 'b' } });

    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('gives the focus back to the menu when it is cancelled', async () => {
    render(<WithSelect onConfirm={async () => undefined} />);
    const select = screen.getByLabelText('role');
    select.focus();
    fireEvent.change(select, { target: { value: 'b' } });
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: 'confirmDialog.cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(select));
  });
});
