import { describe, expect, it } from 'vitest';
import {
  diffCounts,
  diffBoxes,
  diffFeeds,
  diffRoles,
  migratedPermissions,
  parseFeed,
  sameCounts,
  tickedBoxes,
} from './compare';

const ics = (...events: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events, 'END:VCALENDAR', ''].join('\r\n');
const event = (uid: string, start: string, summary: string, extra: string[] = []) =>
  [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTAMP:20261021T100000Z',
    `DTSTART:${start}`,
    `SUMMARY:${summary}`,
    ...extra,
    'END:VEVENT',
  ].join('\r\n');

describe('parseFeed', () => {
  it('reads the events, unfolds long lines, and ignores what the moment of the request writes', () => {
    const events = parseFeed(
      ics(
        event('a@x', '20270302T180000Z', 'Soirée', ['DESCRIPTION:une ligne très', ' longue']),
        event('b@x', '20270309T180000Z', 'Autre'),
      ),
    );
    expect(events.map((e) => e.uid)).toEqual(['a@x', 'b@x']);
    expect(events[0]?.properties.DESCRIPTION).toBe('une ligne très' + 'longue');
    expect(events[0]?.properties.DTSTAMP).toBeUndefined();
  });

  it('keeps the parameters of a property in its name', () => {
    const [first] = parseFeed(
      ics(event('a@x', '', 'S', ['DTSTART;TZID=Europe/Paris:20270302T190000'])),
    );
    expect(first?.properties['DTSTART;TZID=Europe/Paris']).toBe('20270302T190000');
  });
});

describe('diffFeeds', () => {
  const before = parseFeed(
    ics(event('a@x', '20270302T180000Z', 'A'), event('b@x', '20270309T180000Z', 'B')),
  );

  it('finds nothing between two files of the same data, whatever the stamp says', () => {
    const after = parseFeed(
      ics(event('b@x', '20270309T180000Z', 'B'), event('a@x', '20270302T180000Z', 'A')).replace(
        /20261021T100000Z/g,
        '20261022T090000Z',
      ),
    );
    expect(diffFeeds(before, after)).toEqual([]);
  });

  it('sees an event that is gone, a new one, and one that moved', () => {
    const after = parseFeed(
      ics(event('a@x', '20270302T190000Z', 'A'), event('c@x', '20270316T180000Z', 'C')),
    );
    const problems = diffFeeds(before, after);
    expect(problems.join('\n')).toMatch(/changed: a@x DTSTART/);
    expect(problems.join('\n')).toMatch(/gone: b@x/);
    expect(problems.join('\n')).toMatch(/new: c@x/);
  });
});

describe('migratedPermissions', () => {
  it('turns events.manage into validating, proposing and viewing, sorted, and touches nothing else', () => {
    expect(migratedPermissions(['members.manage', 'events.manage', 'events.view'])).toEqual([
      'events.propose',
      'events.validate',
      'events.view',
      'members.manage',
    ]);
  });

  it('leaves a role without events.manage as it is', () => {
    expect(migratedPermissions(['events.view'])).toEqual(['events.view']);
    expect(migratedPermissions([])).toEqual([]);
  });
});

describe('diffRoles', () => {
  const before = [
    { name: 'Trésorier', permissions: ['events.view', 'events.manage'] },
    { name: 'Lecteur', permissions: ['events.view'] },
  ];

  it('accepts exactly the conversion', () => {
    const after = [
      { name: 'Trésorier', permissions: ['events.view', 'events.propose', 'events.validate'] },
      { name: 'Lecteur', permissions: ['events.view'] },
    ];
    expect(diffRoles(before, after)).toEqual([]);
  });

  it('sees a role that lost a right, kept the old key, vanished or appeared', () => {
    const after = [
      { name: 'Trésorier', permissions: ['events.view', 'events.manage'] },
      { name: 'Nouveau', permissions: [] },
    ];
    const problems = diffRoles(before, after).join('\n');
    expect(problems).toMatch(/role Trésorier: expected/);
    expect(problems).toMatch(/role gone: Lecteur/);
    expect(problems).toMatch(/role appeared: Nouveau/);
  });
});

describe('diffCounts and sameCounts', () => {
  it('lets the audit log grow and nothing else', () => {
    expect(diffCounts({ User: 6, AuditLog: 3 }, { User: 6, AuditLog: 4 })).toEqual([]);
    expect(diffCounts({ User: 6 }, { User: 7 }).join()).toMatch(/rows appeared/);
  });

  it('sees a row lost and a table gone', () => {
    expect(diffCounts({ Event: 6 }, { Event: 5 }).join()).toMatch(/6 rows before, 5 after/);
    expect(diffCounts({ Event: 6 }, {}).join()).toMatch(/the table is gone/);
  });

  it('is strict after a restore', () => {
    expect(sameCounts({ AuditLog: 3 }, { AuditLog: 4 }).length).toBe(1);
    expect(sameCounts({ AuditLog: 3 }, { AuditLog: 3 })).toEqual([]);
  });
});

describe('tickedBoxes and diffBoxes: the table of notifications as the page draws it', () => {
  const page = `
    <input type="checkbox" aria-label="Event confirmed — Discord" checked="" class="x"/>
    <input type="checkbox" aria-label="Event confirmed — Slack" disabled="" class="x"/>
    <input class="x" aria-label="Request &#x27;approved&#x27; — E-mail" type="checkbox" checked=""/>
    <input type="text" aria-label="Not a box" checked=""/>
    <input type="checkbox" class="x" checked="" aria-label="Access request waiting — E-mail" />
    <input type="checkbox" aria-label="Member removed — Discord"/>`;

  it('lists the boxes that are ticked, by name, sorted, and nothing else', () => {
    expect(tickedBoxes(page)).toEqual([
      'Access request waiting — E-mail',
      'Event confirmed — Discord',
      "Request 'approved' — E-mail",
    ]);
  });

  it('is empty when nothing is ticked, or when there is no table', () => {
    expect(tickedBoxes('<input type="checkbox" aria-label="a — b"/>')).toEqual([]);
    expect(tickedBoxes('<p>no box</p>')).toEqual([]);
  });

  it('says what is missing and what ticked itself', () => {
    expect(diffBoxes(['a', 'b'], ['b', 'a'])).toEqual([]);
    expect(diffBoxes(['a', 'b'], ['b', 'c'])).toEqual(['not ticked: a', 'ticked by itself: c']);
  });
});
