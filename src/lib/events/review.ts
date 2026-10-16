import type { EventStatus } from '@/generated/prisma/client';
import type { DraftVisibility } from './occurrences';

// The rules of the proposal circuit, pure like lib/roles/guards.ts: who may do what to an event, given what they
// hold and what the event is. The actions and the pages ask these functions and nothing else (see "Events module"
// in docs/architecture.md); `review.test.ts` checks every row of the tables below, and it was mutation-checked.
//
// Two kinds of people write events:
// - a VALIDATOR (`events.validate`) edits everything and publishes directly, as managers did before;
// - a PROPOSER (`events.propose` without it) creates events, which wait for a validator, and edits only its own
//   events that are not published: a draft, a proposal, a refused event. A published event is never touched by
//   a proposer, so it never leaves the calendar without a validator's action.

/** What the rules need to know about the person. */
export interface ReviewActor {
  login: string;
  canPropose: boolean;
  canValidate: boolean;
}

/** The part of the events access (lib/events/access.ts) the rules need: who is acting and what they hold. */
export interface ReviewAccess {
  session: { user: { login: string } };
  canPropose: boolean;
  canValidate: boolean;
}

/** The person as the rules of the circuit see them. */
export function reviewActorOf(access: ReviewAccess): ReviewActor {
  return {
    login: access.session.user.login,
    canPropose: access.canPropose,
    canValidate: access.canValidate,
  };
}

/** What a person sees of the events that are not published (see `listOccurrences`): everything for a
 * validator, their own for somebody who only proposes, nothing for the others. */
export function draftVisibility(access: ReviewAccess): DraftVisibility {
  if (access.canValidate) return { includeDrafts: true };
  if (access.canPropose) return { includeDrafts: false, ownLogin: access.session.user.login };
  return { includeDrafts: false };
}

/** What the rules need to know about an event: its status, its author, and the dates that have a status of their
 * own (a date confirmed alone makes an otherwise unpublished event partly published). */
export interface ReviewedEvent {
  status: EventStatus;
  authorLogin: string;
  dateStatuses?: readonly (EventStatus | null)[];
}

/** Whether members can see something of the event: the event is confirmed, or one of its dates was confirmed
 * alone. Nothing a proposer may change. */
export function isPublished(event: Pick<ReviewedEvent, 'status' | 'dateStatuses'>): boolean {
  return event.status === 'CONFIRMED' || (event.dateStatuses ?? []).some((s) => s === 'CONFIRMED');
}

/** Why a person cannot change an event, to say so on its page. */
export type EditRefusal = 'notAuthor' | 'published' | 'cannotPropose';

/** `null` when the person may edit and delete the event, the reason otherwise. */
export function editRefusal(actor: ReviewActor, event: ReviewedEvent): EditRefusal | null {
  if (actor.canValidate) return null;
  if (!actor.canPropose) return 'cannotPropose';
  if (event.authorLogin !== actor.login) return 'notAuthor';
  if (isPublished(event)) return 'published';
  return null;
}

export function canEditEvent(actor: ReviewActor, event: ReviewedEvent): boolean {
  return editRefusal(actor, event) === null;
}

/** Deleting an event is editing it: a validator any, a proposer its own unpublished events. */
export const canDeleteEvent = canEditEvent;

/** Creating an event: anybody who may propose (a validator holds it too). */
export function canCreateEvent(actor: ReviewActor): boolean {
  return actor.canPropose || actor.canValidate;
}

/**
 * Whether a date (or an event) may go from the status it has to the one asked.
 *
 * - A validator publishes (`PROPOSED`/`DRAFT` → `CONFIRMED`), unpublishes (`CONFIRMED` → `DRAFT`) and keeps what it
 *   is. A proposal does not go back to draft that way: that is a refusal, which has a comment (`refuseEvent`).
 *   It never makes a proposal: whoever may publish has nothing to submit.
 * - A proposer moves between draft and proposed, on what it may edit, and never to `CONFIRMED`.
 */
export function canChangeStatus(actor: ReviewActor, from: EventStatus, to: EventStatus): boolean {
  if (from === to) return true;
  if (actor.canValidate) {
    if (to === 'PROPOSED') return false;
    return !(from === 'PROPOSED' && to === 'DRAFT');
  }
  if (!actor.canPropose) return false;
  return (from === 'DRAFT' && to === 'PROPOSED') || (from === 'PROPOSED' && to === 'DRAFT');
}

/** The statuses the form offers for an event that is `current` (a new event has none). Only what
 * `canChangeStatus` would accept, `current` itself included. */
export function statusChoices(actor: ReviewActor, current: EventStatus | null): EventStatus[] {
  const from = current ?? 'DRAFT';
  return (['DRAFT', 'PROPOSED', 'CONFIRMED'] as const).filter((to) =>
    canChangeStatus(actor, from, to),
  );
}

/** A new event: the statuses it can be created with. A validator creates drafts and confirmed events, a proposer
 * drafts and proposals. */
export function canCreateWithStatus(actor: ReviewActor, status: EventStatus): boolean {
  if (!canCreateEvent(actor)) return false;
  if (actor.canValidate) return status !== 'PROPOSED';
  return status !== 'CONFIRMED';
}

/** Approving and refusing a proposal belong to validators. */
export function canReview(actor: ReviewActor): boolean {
  return actor.canValidate;
}

/** What a status change is called in the audit log and in the notifications. */
export type StatusMove = 'propose' | 'withdraw' | 'approve' | 'status_change';

export function statusMove(from: EventStatus, to: EventStatus): StatusMove {
  if (to === 'PROPOSED' && from !== 'PROPOSED') return 'propose';
  if (from === 'PROPOSED' && to === 'DRAFT') return 'withdraw';
  if (from === 'PROPOSED' && to === 'CONFIRMED') return 'approve';
  return 'status_change';
}

/** Longest refusal comment: it is read in a card and an e-mail. */
export const REFUSAL_COMMENT_MAX_LENGTH = 1000;

export type RefusalCommentError = 'required' | 'tooLong';

/** A refusal always says why: a comment of 1 to 1000 characters, surrounding spaces ignored. */
export function parseRefusalComment(
  value: unknown,
): { ok: true; comment: string } | { ok: false; error: RefusalCommentError } {
  const comment = typeof value === 'string' ? value.trim() : '';
  if (comment === '') return { ok: false, error: 'required' };
  if (comment.length > REFUSAL_COMMENT_MAX_LENGTH) return { ok: false, error: 'tooLong' };
  return { ok: true, comment };
}
