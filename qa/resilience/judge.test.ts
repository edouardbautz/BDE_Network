import { describe, expect, it } from 'vitest';
import { heldFor, outageAnswer, parseHangLog, wholeWrites } from './judge';

const answered = (n: number) => Array.from({ length: n }, () => ({ answered: true }));

describe('wholeWrites', () => {
  it('accepts a batch where some writes happened, whole, and the others did not', () => {
    const attempts = [...answered(2), { answered: false }, { answered: false }];
    expect(wholeWrites(attempts, { events: ['a', 'b', 'c'], audited: ['a', 'b', 'c'] })).toEqual(
      [],
    );
  });

  it('accepts a write that happened although its answer was lost', () => {
    expect(wholeWrites([{ answered: false }], { events: ['a'], audited: ['a'] })).toEqual([]);
  });

  it('sees an event without its audit entry', () => {
    const problems = wholeWrites(answered(2), { events: ['a', 'b'], audited: ['a'] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/without their audit entry/);
  });

  it('sees an audit entry about an event that is not there', () => {
    const problems = wholeWrites(answered(1), { events: ['a'], audited: ['a', 'ghost'] });
    expect(problems.join()).toMatch(/does not exist/);
  });

  it('sees a write that was announced and lost', () => {
    const problems = wholeWrites(answered(3), { events: ['a'], audited: ['a'] });
    expect(problems.join()).toMatch(/lost write/);
  });
});

describe('outageAnswer', () => {
  it('accepts the page that says the service is unavailable, and a 503', () => {
    expect(outageAnswer(307, '/fr/unavailable', '').ok).toBe(true);
    expect(outageAnswer(307, 'http://localhost:3100/fr/unavailable?from=%2Fdashboard', '').ok).toBe(
      true,
    );
    expect(outageAnswer(503, null, 'Service unavailable').ok).toBe(true);
    expect(
      outageAnswer(
        200,
        null,
        '<meta id="__next-page-redirect" http-equiv="refresh" content="1;url=/fr/unavailable"/>',
      ).ok,
    ).toBe(true);
  });

  it('refuses a page drawn as if all was well, a login page for a signed-in member, or a bare error', () => {
    expect(outageAnswer(200, null, '<html>Tableau de bord</html>').ok).toBe(false);
    expect(outageAnswer(307, '/fr', '').ok).toBe(false);
    expect(outageAnswer(500, null, 'Internal Server Error').ok).toBe(false);
  });

  it('refuses any answer that shows a trace or the address of the database', () => {
    expect(outageAnswer(503, null, 'connect ECONNREFUSED 172.18.0.2:5432').ok).toBe(false);
    expect(outageAnswer(503, null, 'postgresql://bde:secret@qa-postgres:5432/db').ok).toBe(false);
    expect(
      outageAnswer(503, null, 'at Object.query (/app/node_modules/pg/lib/client.js:12:3)').ok,
    ).toBe(false);
  });
});

describe('the log of the listener that never answers', () => {
  const log = [
    'listening',
    'open 1 1000',
    'open 2 1500',
    'close 1 6000',
    'noise',
    'close 9 7000',
  ].join('\n');

  it('pairs the openings and the closings', () => {
    expect(parseHangLog(log)).toEqual([
      { id: 1, openedAt: 1000, closedAt: 6000 },
      { id: 2, openedAt: 1500, closedAt: null },
    ]);
  });

  it('measures how long each was held, an open one up to now', () => {
    expect(heldFor(parseHangLog(log), 9000)).toEqual([5000, 7500]);
  });
});
