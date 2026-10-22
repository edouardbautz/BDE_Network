import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Alert, AlertDescription, AlertTitle } from './alert';
import { Badge } from './badge';
import { Button, buttonVariants } from './button';
import { Card, CardContent, CardHeader, CardTitle } from './card';
import { FIELD, Input } from './input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

/**
 * The primitives draw what docs/design.md says, with tokens: these are the rules a page relies on without looking. Each test
 * holds one of them; a primitive that stops following the specification fails here, not on a screen nobody opened.
 */
afterEach(cleanup);

const classesOf = (element: HTMLElement) => new Set(element.className.split(/\s+/));

describe('Button', () => {
  it.each([
    ['default', ['bg-accent-fill', 'text-accent-on', 'hover:bg-accent-fill-hover']],
    ['secondary', ['bg-surface-2', 'text-ink', 'hover:bg-surface-3']],
    ['outline', ['bg-surface-2', 'text-ink']],
    ['ghost', ['text-ink', 'hover:bg-surface-2']],
    ['destructive', ['bg-danger-soft', 'text-danger']],
    ['confirm', ['bg-danger-fill', 'text-on-danger']],
    ['onAccent', ['bg-accent-on', 'text-accent-fill']],
  ] as const)('the %s variant is drawn with the tokens of its role', (variant, expected) => {
    render(<Button variant={variant}>Go</Button>);
    const classes = classesOf(screen.getByRole('button', { name: 'Go' }));
    for (const name of expected) expect(classes.has(name), name).toBe(true);
  });

  it('is a pill, and 44 px high on a phone whatever its size', () => {
    for (const size of ['default', 'xs', 'sm', 'lg', 'icon', 'icon-sm'] as const) {
      const classes = buttonVariants({ size }).split(/\s+/);
      expect(classes, size).toContain('rounded-pill');
      // lg is 44 everywhere; the others become 44 under 640 px
      expect(
        classes.some((name) => name === 'h-11' || name === 'max-sm:h-11' || name === 'max-sm:size-11' || name === 'size-11'),
        size,
      ).toBe(true);
    }
  });

  it('shows no focus of its own: the ring of the interface is the one that shows', () => {
    expect(buttonVariants()).not.toMatch(/(^|\s)outline-none(\s|$)/);
  });

  it('greys out when disabled, with the disabled text colour and no shadow', () => {
    render(<Button disabled>Go</Button>);
    const classes = classesOf(screen.getByRole('button', { name: 'Go' }));
    expect(classes.has('disabled:bg-surface-2')).toBe(true);
    expect(classes.has('disabled:text-disabled')).toBe(true);
    expect(classes.has('disabled:cursor-not-allowed')).toBe(true);
  });
});

describe('Card', () => {
  it('is a surface with a soft shadow and no border, and lays its parts out itself', () => {
    render(
      <Card data-testid="card">
        <CardHeader>
          <CardTitle>Title</CardTitle>
        </CardHeader>
        <CardContent>Body</CardContent>
      </Card>,
    );
    const classes = classesOf(screen.getByTestId('card'));
    for (const name of ['bg-surface', 'elev-1', 'rounded-xl', 'sm:rounded-2xl', 'p-5', 'gap-3.5'])
      expect(classes.has(name), name).toBe(true);
    expect([...classes].some((name) => /^(border|ring)(-|$)/.test(name))).toBe(false);
  });
});

describe('Badge', () => {
  it('is a pill of 22 px; the neutral one is surface-2 on ink, the accent one is the soft tint', () => {
    render(
      <>
        <Badge variant="secondary">Role</Badge>
        <Badge>New</Badge>
      </>,
    );
    const neutral = classesOf(screen.getByText('Role'));
    expect(neutral.has('rounded-pill')).toBe(true);
    expect(neutral.has('h-5.5')).toBe(true);
    expect(neutral.has('bg-surface-2')).toBe(true);
    const accent = classesOf(screen.getByText('New'));
    expect(accent.has('bg-accent-soft')).toBe(true);
    expect(accent.has('text-accent-ink')).toBe(true);
  });
});

describe('Alert', () => {
  it('is a status, except an error, which is announced at once', () => {
    render(
      <>
        <Alert>
          <AlertTitle>Saved</AlertTitle>
          <AlertDescription>Done</AlertDescription>
        </Alert>
        <Alert variant="destructive">
          <AlertDescription>Broken</AlertDescription>
        </Alert>
      </>,
    );
    expect(screen.getByText('Done').closest('[data-slot="alert"]')).toHaveAttribute('role', 'status');
    expect(screen.getByText('Broken').closest('[data-slot="alert"]')).toHaveAttribute('role', 'alert');
  });

  it('has the soft background of its meaning and the text in ink (never grey)', () => {
    render(
      <Alert variant="destructive" data-testid="alert">
        <AlertDescription>Broken</AlertDescription>
      </Alert>,
    );
    const classes = classesOf(screen.getByTestId('alert'));
    expect(classes.has('bg-danger-soft')).toBe(true);
    expect(classes.has('text-ink')).toBe(true);
    expect(classes.has('rounded-lg')).toBe(true);
  });
});

describe('the text field', () => {
  it('is a pill on surface-2 with no border, whose focus is an inset ring in the ink of the accent', () => {
    render(<Input aria-label="Name" />);
    const classes = classesOf(screen.getByRole('textbox', { name: 'Name' }));
    for (const name of [
      'rounded-pill',
      'bg-surface-2',
      'border-0',
      'h-11',
      'focus-visible:shadow-[inset_0_0_0_2px_var(--accent-ink)]',
      'aria-invalid:shadow-[inset_0_0_0_2px_var(--danger)]',
    ])
      expect(classes.has(name), name).toBe(true);
  });

  it('applies the read-only look to fields and text areas only: a select is read-only to the browser too', () => {
    // :read-only matches a <select>; a bare read-only: variant made every filter select transparent with a hairline
    expect(FIELD).not.toMatch(/(^|\s)read-only:/);
    expect(FIELD).toContain('[&:is(input,textarea):read-only]:bg-transparent');
  });
});

describe('Table', () => {
  it('becomes a list under 640 px: the header goes, a row is a block, a cell says what it is', () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Campus</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow data-testid="row">
            <TableCell>Alice</TableCell>
            <TableCell data-label="Campus">Paris</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(classesOf(screen.getByRole('table')).has('max-sm:block')).toBe(true);
    expect(classesOf(screen.getAllByRole('rowgroup')[0]!).has('max-sm:sr-only')).toBe(true);
    expect(classesOf(screen.getByTestId('row')).has('max-sm:flex')).toBe(true);
    const cell = screen.getByRole('cell', { name: 'Paris' });
    expect(cell).toHaveAttribute('data-label', 'Campus');
    expect([...classesOf(cell)].some((name) => name.includes('content-[attr(data-label)]'))).toBe(true);
  });
});
