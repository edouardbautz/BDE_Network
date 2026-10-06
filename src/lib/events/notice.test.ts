import { describe, expect, it } from 'vitest';
import { readEventNotice } from './notice';

describe('readEventNotice', () => {
  it.each(['eventGone', 'occurrenceGone'])('accepts the known notice %s', (notice) => {
    expect(readEventNotice(notice)).toBe(notice);
  });

  it('takes the first value when the parameter is repeated', () => {
    expect(readEventNotice(['eventGone', 'occurrenceGone'])).toBe('eventGone');
  });

  it.each([undefined, '', 'unknown', '<script>alert(1)</script>', 'EVENTGONE', 'eventGone '])(
    'ignores anything else: %j',
    (value) => {
      expect(readEventNotice(value)).toBeNull();
    },
  );
});
