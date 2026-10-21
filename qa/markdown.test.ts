import { describe, expect, it } from 'vitest';
import { tableCell } from './markdown';

describe('tableCell', () => {
  it('escapes the bar that would end the cell', () => {
    expect(tableCell('a | b')).toBe('a \\| b');
  });

  it('escapes a backslash too, so that a backslash before a bar cannot undo the escape of the bar', () => {
    expect(tableCell('a \\| b')).toBe('a \\\\\\| b');
    expect(tableCell('C:\\path')).toBe('C:\\\\path');
  });

  it('leaves the rest as it is', () => {
    expect(tableCell('the platform is up: /api/health → 200')).toBe(
      'the platform is up: /api/health → 200',
    );
  });
});
