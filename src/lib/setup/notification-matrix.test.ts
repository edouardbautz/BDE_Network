// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_EVENTS } from '@/config/schema';
import {
  MATRIX_GROUPS,
  clearRows,
  columnState,
  countFor,
  effectiveMatrix,
  isOffered,
  isTickable,
  setCell,
  setColumn,
  visibleRows,
  type Configured,
} from './notification-matrix';
import { emptyMatrix } from './notifications';

const ALL: Configured = { discord: true, slack: true, email: true };
const NOT_EMAIL: Configured = { discord: true, slack: true, email: false };

describe('the rows of the table', () => {
  it('are every type of notification, once, in two groups', () => {
    const rows = [...MATRIX_GROUPS.members, ...MATRIX_GROUPS.events];
    expect([...rows].sort()).toEqual([...NOTIFICATION_EVENTS].sort());
  });

  it('show the events ones only when the module is on', () => {
    expect(visibleRows(false)).toEqual(['memberPending', 'memberApproved', 'memberRemoved']);
    expect(visibleRows(true)).toHaveLength(8);
  });
});

describe('what can be ticked', () => {
  it('has no e-mail for a member who was removed: nobody writes to the person', () => {
    expect(isOffered('memberRemoved', 'email')).toBe(false);
    expect(isOffered('memberRemoved', 'discord')).toBe(true);
    expect(isOffered('memberPending', 'email')).toBe(true);
  });

  it('needs the channel to be configured', () => {
    expect(isTickable('memberPending', 'email', ALL)).toBe(true);
    expect(isTickable('memberPending', 'email', NOT_EMAIL)).toBe(false);
    expect(isTickable('memberRemoved', 'email', ALL)).toBe(false);
  });
});

describe('one box', () => {
  it('is ticked and cleared, and a list stays in the order of the table, once', () => {
    let matrix = setCell(emptyMatrix(), 'eventConfirmed', 'email', true);
    matrix = setCell(matrix, 'eventConfirmed', 'discord', true);
    matrix = setCell(matrix, 'eventConfirmed', 'discord', true);
    expect(matrix.eventConfirmed).toEqual(['discord', 'email']);
    matrix = setCell(matrix, 'eventConfirmed', 'email', false);
    expect(matrix.eventConfirmed).toEqual(['discord']);
  });

  it('leaves the other types alone', () => {
    const matrix = setCell(emptyMatrix(), 'eventConfirmed', 'slack', true);
    expect(matrix.eventReminder).toEqual([]);
  });
});

describe('the shortcut of a column', () => {
  const rows = visibleRows(true);

  it('ticks every box of the column that can be ticked: not the e-mail of a removed member', () => {
    const matrix = setColumn(emptyMatrix(), 'email', rows, ALL, true);
    expect(countFor(matrix, 'email')).toBe(7);
    expect(matrix.memberRemoved).toEqual([]);
    expect(countFor(matrix, 'discord')).toBe(0);
  });

  it('ticks the whole Discord column, memberRemoved included', () => {
    expect(countFor(setColumn(emptyMatrix(), 'discord', rows, ALL, true), 'discord')).toBe(8);
  });

  it('does nothing for a channel that is not configured', () => {
    expect(setColumn(emptyMatrix(), 'email', rows, NOT_EMAIL, true)).toEqual(emptyMatrix());
  });

  it('only touches the rows shown: the events ones, when the module is off, keep what they hold', () => {
    const held = setCell(emptyMatrix(), 'eventConfirmed', 'discord', true);
    const next = setColumn(held, 'discord', visibleRows(false), ALL, true);
    expect(next.eventConfirmed).toEqual(['discord']);
    expect(next.memberPending).toEqual(['discord']);
    expect(next.eventReminder).toEqual([]);
    const cleared = setColumn(next, 'discord', visibleRows(false), ALL, false);
    expect(cleared.eventConfirmed).toEqual(['discord']);
    expect(cleared.memberPending).toEqual([]);
  });

  it('says whether the column is all ticked, some, or none (and none when nothing can be ticked)', () => {
    expect(columnState(emptyMatrix(), 'discord', rows, ALL)).toBe('none');
    const some = setCell(emptyMatrix(), 'memberPending', 'discord', true);
    expect(columnState(some, 'discord', rows, ALL)).toBe('some');
    expect(
      columnState(setColumn(emptyMatrix(), 'discord', rows, ALL, true), 'discord', rows, ALL),
    ).toBe('all');
    // every box that can be ticked is: the e-mail column is all there is, without the removed member
    expect(
      columnState(setColumn(emptyMatrix(), 'email', rows, ALL, true), 'email', rows, ALL),
    ).toBe('all');
    expect(columnState(emptyMatrix(), 'email', rows, NOT_EMAIL)).toBe('none');
  });

  it('clears everything in the rows shown', () => {
    const matrix = setColumn(emptyMatrix(), 'discord', rows, ALL, true);
    expect(clearRows(matrix, visibleRows(false)).memberPending).toEqual([]);
    expect(clearRows(matrix, visibleRows(false)).eventConfirmed).toEqual(['discord']);
  });
});

describe('what is really ticked', () => {
  it('drops the boxes of a channel that is not configured, and the e-mail of a removed member', () => {
    let matrix = setCell(emptyMatrix(), 'memberPending', 'email', true);
    matrix = setCell(matrix, 'memberPending', 'discord', true);
    matrix = { ...matrix, memberRemoved: ['discord', 'email'] };
    const real = effectiveMatrix(matrix, NOT_EMAIL);
    expect(real.memberPending).toEqual(['discord']);
    expect(real.memberRemoved).toEqual(['discord']);
    expect(effectiveMatrix(matrix, ALL).memberRemoved).toEqual(['discord']);
  });
});
