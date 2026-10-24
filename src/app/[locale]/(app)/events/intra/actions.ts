'use server';

import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { getPathname } from '@/i18n/navigation';
import type { ActionTarget } from '@/lib/action-target';
import { requireIntraPublisher, requireIntraRequester } from '@/lib/events/access';
import { auditIntraAction } from '@/lib/events/intra-audit';
import { parseIntraUrl } from '@/lib/events/intra-request';
import {
  markRequestUpdated,
  publishRequest,
  refuseRequest,
  sendRequest,
  type IntraActor,
  type IntraNotice,
} from '@/lib/events/intra-sync';
import { parseRefusalComment } from '@/lib/events/review';
import { inSeriesTransaction } from '@/lib/events/transaction';

// The answers of the school's staff to the requests to publish an event on the intra, and the sending of a request. Every action is
// an entry point: the right is asked first (a hidden button is not a permission), the input is read again, and the work is done in
// one SERIALIZABLE transaction with its audit entry. What turns out to be already answered or changed is a notice on the page the
// person comes back to, never an error (`throw` stays for a crafted request).

/** Where a request for the intra is sent from, and so where the person comes back: the page of the event, or the staff's page. */
const RETURNS = ['event', 'intra'] as const;

/** A SHA-256 in hexadecimal: the version of the event the staff member had in front of them. */
const HASH = /^[0-9a-f]{64}$/;

async function addressOf(
  href: string | { pathname: string; query: Record<string, string> },
): Promise<string> {
  return getPathname({ href, locale: await getLocale() });
}

/** The page of one request, with the notice that says why the answer was not taken. */
function withNotice(eventId: string, notice: IntraNotice | 'busy') {
  return { pathname: `/events/intra/${eventId}`, query: { notice } };
}

function actorOf(access: { session: { user: { id: string; login: string } } }): IntraActor {
  return { id: access.session.user.id, login: access.session.user.login };
}

function requireHash(value: unknown): string {
  if (typeof value !== 'string' || !HASH.test(value)) throw new Error('Invalid version');
  return value;
}

function requireEventId(value: unknown): string {
  if (typeof value !== 'string' || value === '' || value.length > 64) {
    throw new Error('Invalid event');
  }
  return value;
}

/** "Published on the intra": the staff has copied the event into the intra's form. `url` is the address of the event there (optional). */
export async function publishOnIntra(
  eventId: string,
  expectedHash: string,
  url: string,
): Promise<ActionTarget> {
  const access = await requireIntraPublisher();
  const id = requireEventId(eventId);
  const hash = requireHash(expectedHash);
  const parsedUrl = parseIntraUrl(url);
  if (!parsedUrl.ok) throw new Error('Invalid address');

  const outcome = await inSeriesTransaction(async (tx) => {
    const answer = await publishRequest(tx, id, {
      expectedHash: hash,
      url: parsedUrl.value,
      actor: actorOf(access),
    });
    if (!answer.ok) return answer;
    await auditIntraAction(
      access,
      'intra.publish',
      { id, title: answer.title },
      { dates: answer.content.dates.length, ...(parsedUrl.value ? { url: parsedUrl.value } : {}) },
      tx,
    );
    return answer;
  });
  if (!outcome) return { href: await addressOf(withNotice(id, 'busy')) };
  if (!outcome.ok) return { href: await addressOf(withNotice(id, outcome.notice)) };

  revalidatePath('/events');
  return { href: await addressOf('/events/intra') };
}

/** "Intra updated": what is on the intra now matches the event, as the staff member saw it (`expectedHash`). */
export async function markIntraUpdated(
  eventId: string,
  expectedHash: string,
): Promise<ActionTarget> {
  const access = await requireIntraPublisher();
  const id = requireEventId(eventId);
  const hash = requireHash(expectedHash);

  const outcome = await inSeriesTransaction(async (tx) => {
    const answer = await markRequestUpdated(tx, id, { expectedHash: hash, actor: actorOf(access) });
    if (!answer.ok) return answer;
    await auditIntraAction(
      access,
      'intra.update',
      { id, title: answer.title },
      { dates: answer.content.dates.length },
      tx,
    );
    return answer;
  });
  if (!outcome) return { href: await addressOf(withNotice(id, 'busy')) };
  if (!outcome.ok) return { href: await addressOf(withNotice(id, outcome.notice)) };

  revalidatePath('/events');
  return { href: await addressOf('/events/intra') };
}

/** A refusal, with the reason (1 to 1000 characters): the author reads it, and the request can be sent again. */
export async function refuseOnIntra(eventId: string, comment: string): Promise<ActionTarget> {
  const access = await requireIntraPublisher();
  const id = requireEventId(eventId);
  const parsed = parseRefusalComment(comment);
  if (!parsed.ok) throw new Error('Invalid comment');

  const outcome = await inSeriesTransaction(async (tx) => {
    const answer = await refuseRequest(tx, id, { comment: parsed.comment, actor: actorOf(access) });
    if (!answer.ok) return answer;
    await auditIntraAction(
      access,
      'intra.refuse',
      { id, title: answer.title },
      { comment: parsed.comment },
      tx,
    );
    return answer;
  });
  if (!outcome) return { href: await addressOf(withNotice(id, 'busy')) };
  if (!outcome.ok) return { href: await addressOf(withNotice(id, outcome.notice)) };

  revalidatePath('/events');
  return { href: await addressOf('/events/intra') };
}

/**
 * Sends the staff a request: again after a refusal, or for an event that is confirmed and has none. `returnTo` is the page the person
 * comes back to (a closed list, never an address).
 */
export async function requestOnIntra(eventId: string, returnTo: string = 'event'): Promise<ActionTarget> {
  const access = await requireIntraRequester();
  const id = requireEventId(eventId);
  if (!(RETURNS as readonly string[]).includes(returnTo)) throw new Error('Invalid target');

  const outcome = await inSeriesTransaction(async (tx) => {
    const answer = await sendRequest(tx, id, actorOf(access));
    if (!answer.ok) return answer;
    await auditIntraAction(
      access,
      'intra.request',
      { id, title: answer.title },
      { resent: answer.resent },
      tx,
    );
    return answer;
  });
  if (!outcome || !outcome.ok) {
    // The page where the person asked is where the notice goes.
    const notice = outcome ? outcome.notice : 'busy';
    return {
      href: await addressOf(
        returnTo === 'event'
          ? { pathname: `/events/${id}`, query: { notice } }
          : withNotice(id, notice),
      ),
    };
  }

  revalidatePath('/events');
  return { href: await addressOf(returnTo === 'event' ? `/events/${id}` : `/events/intra/${id}`) };
}
