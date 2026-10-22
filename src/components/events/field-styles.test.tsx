import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { NativeSelect, Textarea } from './field-styles';

/**
 * Safari ignores `box-shadow` on a select (see `field-styles.tsx`): a select must show its focus with an outline. The
 * keyboard suite of `qa/browsers` checks it in the three engines; this keeps the rule where the style is written.
 */
afterEach(cleanup);

describe('NativeSelect', () => {
  const tokens = () =>
    new Set(
      render(
        <NativeSelect aria-label="Category">
          <option>Soirée</option>
        </NativeSelect>,
      )
        .getByRole('combobox', { name: 'Category' })
        .className.split(/\s+/),
    );

  it('shows its focus with an outline, which Safari draws on a select', () => {
    const classes = tokens();
    expect(classes.has('focus-visible:outline-3')).toBe(true);
    expect(classes.has('focus-visible:outline-solid')).toBe(true);
    expect(classes.has('focus-visible:outline-accent-ink')).toBe(true);
  });

  it('does not also draw the ring, which would double it in the engines that draw both', () => {
    const classes = tokens();
    // the ring of the other fields is an inset shadow in the ink of the accent: switched off here
    expect(classes.has('focus-visible:shadow-[inset_0_0_0_2px_var(--accent-ink)]')).toBe(false);
    expect(classes.has('focus-visible:shadow-none')).toBe(true);
  });

  it('leaves the textarea with the ring, which every engine draws on it', () => {
    render(<Textarea aria-label="Description" />);
    const classes = new Set(
      screen.getByRole('textbox', { name: 'Description' }).className.split(/\s+/),
    );
    expect(classes.has('focus-visible:shadow-[inset_0_0_0_2px_var(--accent-ink)]')).toBe(true);
  });
});
