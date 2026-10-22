import { describe, expect, it } from 'vitest';
import { cn } from './utils';

const SIZES = [
  'display',
  'title-1',
  'title-2',
  'title-3',
  'figure',
  'card-title',
  'body',
  'body-strong',
  'small',
  'caption',
  'micro',
];

describe('cn', () => {
  it.each(SIZES)(
    'keeps the colour of a text when the size %s is added, in either order',
    (size) => {
      // twMerge alone takes `text-micro` for a colour and drops `text-accent-on`: a counter was drawn dark on the accent
      expect(cn('text-accent-on', `text-${size}`)).toBe(`text-accent-on text-${size}`);
      expect(cn(`text-${size}`, 'text-ink')).toBe(`text-${size} text-ink`);
    },
  );

  it('lets a later size replace an earlier one, and a later colour an earlier one', () => {
    expect(cn('text-body', 'text-small')).toBe('text-small');
    expect(cn('text-ink', 'text-muted-foreground')).toBe('text-muted-foreground');
  });

  it('lets a later shadow replace an earlier one', () => {
    expect(cn('elev-1', 'elev-2')).toBe('elev-2');
    expect(cn('shadow-lg', 'elev-1')).toBe('elev-1');
  });

  it('lets a later radius replace an earlier one, the pill included', () => {
    expect(cn('rounded-lg', 'rounded-pill')).toBe('rounded-pill');
    expect(cn('rounded-pill', 'rounded-md')).toBe('rounded-md');
  });

  it('still merges the ordinary classes', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('a', false, undefined, 'b')).toBe('a b');
  });
});
