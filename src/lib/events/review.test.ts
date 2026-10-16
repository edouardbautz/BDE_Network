import { describe, expect, it } from 'vitest';
import type { EventStatus } from '@/generated/prisma/client';
import {
  REFUSAL_COMMENT_MAX_LENGTH,
  canChangeStatus,
  canCreateEvent,
  canCreateWithStatus,
  canDeleteEvent,
  canEditEvent,
  canReview,
  draftVisibility,
  editRefusal,
  isPublished,
  parseRefusalComment,
  reviewActorOf,
  statusChoices,
  statusMove,
  type ReviewActor,
  type ReviewedEvent,
} from './review';

// The rules of the proposal circuit, row by row. Re-break one (let a proposer confirm, forget the author check,
// let a validator send a proposal back without a comment) and one of these must fail.

const validator: ReviewActor = { login: 'val', canPropose: true, canValidate: true };
const proposer: ReviewActor = { login: 'pol', canPropose: true, canValidate: false };
const member: ReviewActor = { login: 'mem', canPropose: false, canValidate: false };

const event = (
  status: EventStatus,
  authorLogin = 'pol',
  dateStatuses: (EventStatus | null)[] = [],
) => ({ status, authorLogin, dateStatuses }) satisfies ReviewedEvent;

const STATUSES: EventStatus[] = ['DRAFT', 'PROPOSED', 'CONFIRMED'];

describe('isPublished', () => {
  it('is true for a confirmed event, or one with a date confirmed alone', () => {
    expect(isPublished(event('CONFIRMED'))).toBe(true);
    expect(isPublished(event('DRAFT', 'pol', [null, 'CONFIRMED']))).toBe(true);
    expect(isPublished(event('PROPOSED', 'pol', ['CONFIRMED']))).toBe(true);
  });

  it('is false for a draft or a proposal, whatever its dates say otherwise', () => {
    expect(isPublished(event('DRAFT'))).toBe(false);
    expect(isPublished(event('PROPOSED', 'pol', [null, 'DRAFT', 'PROPOSED']))).toBe(false);
    expect(isPublished({ status: 'DRAFT' })).toBe(false);
  });
});

describe('who may edit or delete an event', () => {
  it('lets a validator edit anything, whoever wrote it', () => {
    for (const status of STATUSES) {
      expect(canEditEvent(validator, event(status, 'somebody'))).toBe(true);
      expect(canDeleteEvent(validator, event(status, 'somebody'))).toBe(true);
    }
  });

  it('lets a proposer edit their own draft, proposal and refused event', () => {
    expect(canEditEvent(proposer, event('DRAFT'))).toBe(true);
    expect(canEditEvent(proposer, event('PROPOSED'))).toBe(true);
    expect(canDeleteEvent(proposer, event('DRAFT'))).toBe(true);
    expect(canDeleteEvent(proposer, event('PROPOSED'))).toBe(true);
  });

  it('never lets a proposer touch a published event, even their own: a validator decides', () => {
    expect(editRefusal(proposer, event('CONFIRMED'))).toBe('published');
    expect(canEditEvent(proposer, event('CONFIRMED'))).toBe(false);
    expect(canDeleteEvent(proposer, event('CONFIRMED'))).toBe(false);
  });

  it('counts a date confirmed alone as published', () => {
    expect(editRefusal(proposer, event('DRAFT', 'pol', ['CONFIRMED']))).toBe('published');
  });

  it("never lets a proposer touch somebody else's event", () => {
    for (const status of STATUSES) {
      expect(editRefusal(proposer, event(status, 'colleague'))).toBe('notAuthor');
      expect(canDeleteEvent(proposer, event(status, 'colleague'))).toBe(false);
    }
  });

  it('says a member who cannot propose has no right at all', () => {
    expect(editRefusal(member, event('DRAFT', 'mem'))).toBe('cannotPropose');
    expect(canEditEvent(member, event('DRAFT', 'mem'))).toBe(false);
  });

  it('is the author that counts, not the display of the login', () => {
    expect(canEditEvent(proposer, event('DRAFT', 'POL'))).toBe(false);
    expect(canEditEvent(proposer, event('DRAFT', ''))).toBe(false);
  });
});

describe('who may create an event, and with which status', () => {
  it('lets whoever proposes or validates create, nobody else', () => {
    expect(canCreateEvent(proposer)).toBe(true);
    expect(canCreateEvent(validator)).toBe(true);
    expect(canCreateEvent(member)).toBe(false);
  });

  it('gives a proposer drafts and proposals, never a confirmed event', () => {
    expect(canCreateWithStatus(proposer, 'DRAFT')).toBe(true);
    expect(canCreateWithStatus(proposer, 'PROPOSED')).toBe(true);
    expect(canCreateWithStatus(proposer, 'CONFIRMED')).toBe(false);
  });

  it('gives a validator drafts and confirmed events: they have nothing to propose to anybody', () => {
    expect(canCreateWithStatus(validator, 'DRAFT')).toBe(true);
    expect(canCreateWithStatus(validator, 'CONFIRMED')).toBe(true);
    expect(canCreateWithStatus(validator, 'PROPOSED')).toBe(false);
  });

  it('gives a member nothing', () => {
    for (const status of STATUSES) expect(canCreateWithStatus(member, status)).toBe(false);
  });
});

describe('which status an event may go to', () => {
  // [from, to, validator, proposer]
  it.each<[EventStatus, EventStatus, boolean, boolean]>([
    ['DRAFT', 'DRAFT', true, true],
    ['DRAFT', 'PROPOSED', false, true],
    ['DRAFT', 'CONFIRMED', true, false],
    ['PROPOSED', 'DRAFT', false, true], // a validator sends a proposal back by refusing it, with a comment
    ['PROPOSED', 'PROPOSED', true, true],
    ['PROPOSED', 'CONFIRMED', true, false], // approving
    ['CONFIRMED', 'DRAFT', true, false],
    ['CONFIRMED', 'PROPOSED', false, false],
    ['CONFIRMED', 'CONFIRMED', true, true],
  ])('%s → %s: validator %s, proposer %s', (from, to, byValidator, byProposer) => {
    expect(canChangeStatus(validator, from, to)).toBe(byValidator);
    expect(canChangeStatus(proposer, from, to)).toBe(byProposer);
  });

  it('gives a member no move at all (staying where it is is not a move)', () => {
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        expect(canChangeStatus(member, from, to)).toBe(from === to);
      }
    }
  });
});

describe('the statuses the form offers', () => {
  it('offers a validator draft and confirmed for a new event', () => {
    expect(statusChoices(validator, null)).toEqual(['DRAFT', 'CONFIRMED']);
  });

  it('offers a proposer draft and proposed for a new event', () => {
    expect(statusChoices(proposer, null)).toEqual(['DRAFT', 'PROPOSED']);
  });

  it('offers a validator the proposal itself and its approval, not a way back to draft', () => {
    expect(statusChoices(validator, 'PROPOSED')).toEqual(['PROPOSED', 'CONFIRMED']);
  });

  it('offers a proposer withdrawing and keeping a proposal', () => {
    expect(statusChoices(proposer, 'PROPOSED')).toEqual(['DRAFT', 'PROPOSED']);
  });

  it('only ever offers what canChangeStatus accepts', () => {
    for (const actor of [validator, proposer, member]) {
      for (const from of STATUSES) {
        for (const to of statusChoices(actor, from)) {
          expect(canChangeStatus(actor, from, to)).toBe(true);
        }
      }
    }
  });
});

describe('who reviews', () => {
  it('is the validators', () => {
    expect(canReview(validator)).toBe(true);
    expect(canReview(proposer)).toBe(false);
    expect(canReview(member)).toBe(false);
  });
});

describe('what a status change is called', () => {
  it.each<[EventStatus, EventStatus, string]>([
    ['DRAFT', 'PROPOSED', 'propose'],
    ['PROPOSED', 'DRAFT', 'withdraw'],
    ['PROPOSED', 'CONFIRMED', 'approve'],
    ['DRAFT', 'CONFIRMED', 'status_change'],
    ['CONFIRMED', 'DRAFT', 'status_change'],
  ])('%s → %s is %s', (from, to, move) => {
    expect(statusMove(from, to)).toBe(move);
  });
});

describe('the comment of a refusal', () => {
  it('is required: nothing, spaces and non-text are refused', () => {
    for (const value of ['', '   ', '\n\t', undefined, null, 12]) {
      expect(parseRefusalComment(value)).toEqual({ ok: false, error: 'required' });
    }
  });

  it('is trimmed, and kept as typed otherwise (new lines included)', () => {
    expect(parseRefusalComment('  Date trop proche.\nMerci.  ')).toEqual({
      ok: true,
      comment: 'Date trop proche.\nMerci.',
    });
  });

  it('is at most 1000 characters', () => {
    expect(parseRefusalComment('x'.repeat(REFUSAL_COMMENT_MAX_LENGTH))).toMatchObject({ ok: true });
    expect(parseRefusalComment('x'.repeat(REFUSAL_COMMENT_MAX_LENGTH + 1))).toEqual({
      ok: false,
      error: 'tooLong',
    });
  });
});

describe('what each person sees of the events that are not published', () => {
  const access = (canPropose: boolean, canValidate: boolean) => ({
    session: { user: { login: 'pol' } },
    canPropose,
    canValidate,
  });

  it('is everything for a validator', () => {
    expect(draftVisibility(access(true, true))).toEqual({ includeDrafts: true });
  });

  it('is their own events for somebody who only proposes', () => {
    expect(draftVisibility(access(true, false))).toEqual({
      includeDrafts: false,
      ownLogin: 'pol',
    });
  });

  it('is nothing for a member who only views', () => {
    expect(draftVisibility(access(false, false))).toEqual({ includeDrafts: false });
  });
});

describe('reviewActorOf', () => {
  it('is the login and the two rights', () => {
    expect(
      reviewActorOf({ session: { user: { login: 'pol' } }, canPropose: true, canValidate: false }),
    ).toEqual({ login: 'pol', canPropose: true, canValidate: false });
  });
});
