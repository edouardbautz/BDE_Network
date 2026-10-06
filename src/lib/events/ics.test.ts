import { describe, expect, it } from 'vitest';
import {
  buildIcs,
  escapeIcsText,
  foldIcsLine,
  formatIcsDate,
  icsFilename,
  occurrenceUid,
  type IcsEvent,
} from './ics';

const NOW = new Date('2026-05-01T08:00:00Z');

function event(overrides: Partial<IcsEvent> = {}): IcsEvent {
  return {
    uid: 'evt1-20260510T180000Z@bde-network',
    start: new Date('2026-05-10T18:00:00Z'),
    end: new Date('2026-05-10T20:30:00Z'),
    summary: 'Soirée de rentrée',
    confirmed: true,
    lastModified: new Date('2026-04-30T09:15:00Z'),
    ...overrides,
  };
}

describe('icsFilename', () => {
  it('names the file after the event, without accents or spaces', () => {
    expect(icsFilename('Soirée de rentrée')).toBe('soiree-de-rentree.ics');
    expect(icsFilename('  Tournoi  #2 !! ')).toBe('tournoi-2.ics');
  });

  it('falls back to "event" when nothing usable is left', () => {
    expect(icsFilename('')).toBe('event.ics');
    expect(icsFilename('🎉🎉')).toBe('event.ics');
  });

  it('can never contain a path or a quote', () => {
    expect(icsFilename('../../etc/passwd"; rm')).toBe('etc-passwd-rm.ics');
  });
});

describe('formatIcsDate', () => {
  it('formats a UTC instant as YYYYMMDDTHHMMSSZ', () => {
    expect(formatIcsDate(new Date('2026-05-10T18:05:09Z'))).toBe('20260510T180509Z');
  });
});

describe('escapeIcsText', () => {
  it('escapes backslashes, semicolons, commas and newlines', () => {
    expect(escapeIcsText('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf');
  });
});

describe('foldIcsLine', () => {
  it('leaves short lines untouched', () => {
    expect(foldIcsLine('SUMMARY:short')).toBe('SUMMARY:short');
  });

  it('folds long lines at 75 octets with a leading space on continuations', () => {
    const folded = foldIcsLine(`DESCRIPTION:${'a'.repeat(200)}`);
    const lines = folded.split('\r\n');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]).toHaveLength(75);
    for (const line of lines.slice(1)) {
      expect(line.startsWith(' ')).toBe(true);
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(lines.map((l, i) => (i === 0 ? l : l.slice(1))).join('')).toBe(
      `DESCRIPTION:${'a'.repeat(200)}`,
    );
  });

  it('never splits a multi-byte character', () => {
    const text = `SUMMARY:${'é'.repeat(100)}😀${'日'.repeat(50)}`;
    const folded = foldIcsLine(text);
    const lines = folded.split('\r\n');
    for (const line of lines) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    const unfolded = lines.map((l, i) => (i === 0 ? l : l.slice(1))).join('');
    expect(unfolded).toBe(text);
    expect(unfolded).not.toContain('�');
  });
});

describe('buildIcs', () => {
  it('wraps events in a VCALENDAR with CRLF line endings', () => {
    const ics = buildIcs({ name: 'BDE Test', events: [event()] }, NOW);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(ics).toContain('X-WR-CALNAME:BDE Test');
  });

  it('writes UTC times, a stable UID and the event fields', () => {
    const ics = buildIcs(
      {
        name: 'BDE',
        events: [
          event({
            description: 'Apportez, vos amis;\nà 18h',
            location: 'Salle B, bâtiment 2',
            category: 'Soirée',
          }),
        ],
      },
      NOW,
    );
    expect(ics).toContain('UID:evt1-20260510T180000Z@bde-network\r\n');
    expect(ics).toContain('DTSTART:20260510T180000Z\r\n');
    expect(ics).toContain('DTEND:20260510T203000Z\r\n');
    expect(ics).toContain('DTSTAMP:20260501T080000Z\r\n');
    expect(ics).toContain('LAST-MODIFIED:20260430T091500Z\r\n');
    expect(ics).toContain('SUMMARY:Soirée de rentrée\r\n');
    expect(ics).toContain('DESCRIPTION:Apportez\\, vos amis\\;\\nà 18h\r\n');
    expect(ics).toContain('LOCATION:Salle B\\, bâtiment 2\r\n');
    expect(ics).toContain('CATEGORIES:Soirée\r\n');
    expect(ics).toContain('STATUS:CONFIRMED\r\n');
  });

  it('marks drafts as TENTATIVE and omits empty optional fields', () => {
    const ics = buildIcs({ name: 'BDE', events: [event({ confirmed: false })] }, NOW);
    expect(ics).toContain('STATUS:TENTATIVE\r\n');
    expect(ics).not.toContain('DESCRIPTION');
    expect(ics).not.toContain('LOCATION');
    expect(ics).not.toContain('CATEGORIES');
  });

  it('produces a valid empty calendar', () => {
    const ics = buildIcs({ name: 'BDE', events: [] }, NOW);
    expect(ics).not.toContain('BEGIN:VEVENT');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('does not let user text inject extra calendar lines', () => {
    const ics = buildIcs(
      { name: 'BDE', events: [event({ summary: 'x\r\nEND:VEVENT\r\nBEGIN:VEVENT' })] },
      NOW,
    );
    const lines = ics.split('\r\n');
    expect(lines.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(lines.filter((line) => line === 'END:VEVENT')).toHaveLength(1);
  });
});

describe('occurrenceUid', () => {
  it('is deterministic and unique per occurrence', () => {
    const a = occurrenceUid('evt1', new Date('2026-05-10T18:00:00Z'));
    const b = occurrenceUid('evt1', new Date('2026-05-17T18:00:00Z'));
    expect(a).toBe('evt1-20260510T180000Z@bde-network');
    expect(a).not.toBe(b);
    expect(occurrenceUid('evt1', new Date('2026-05-10T18:00:00Z'))).toBe(a);
  });
});
