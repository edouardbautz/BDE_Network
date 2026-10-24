import { isIntraKind, type EventCardKind, type IntraCardKind } from './card-kind';
import type { NotificationEventData, Translate } from './messages';

/**
 * What the cards, Slack messages and e-mails about the publication on the intra show of it, drawn once: each channel only decides
 * how to lay these out (a field, a column, a row). The labels are the platform's own words; a template renames them item by item.
 */

export interface IntraCardParts {
  /** Why: the refusal's reason, or why the event was taken back. */
  reason?: { label: string; text: string };
  /** Who asked for the publication. */
  requestedBy?: { label: string; name: string };
  /** Who changed or took back the event, or the staff member who answered. */
  actor?: { label: string; name: string };
  /** The fields of the intra's form (for a request). */
  fields?: { label: string; lines: { label: string; value: string }[] };
  /** What changed since the event was published, one line each. */
  changes?: { label: string; lines: string[] };
  /** Where the event is on the intra. */
  link?: { label: string; url: string };
}

const ACTOR_LABEL: Record<IntraCardKind, string | null> = {
  intraRequested: null,
  intraChanged: 'embed.fields.changedBy',
  intraCancelled: 'embed.fields.cancelledBy',
  intraPublished: 'embed.fields.publishedBy',
  intraRefused: 'embed.fields.refusedBy',
};

export function intraParts(
  kind: EventCardKind,
  data: NotificationEventData,
  t: Translate,
): IntraCardParts {
  const facts = data.intra;
  if (!facts || !isIntraKind(kind)) return {};
  const parts: IntraCardParts = {};
  const reason =
    kind === 'intraRefused' ? facts.comment : kind === 'intraCancelled' ? facts.cause : null;
  if (reason) parts.reason = { label: t('embed.fields.reason'), text: reason };
  if (kind === 'intraRequested' && facts.requestedByName) {
    parts.requestedBy = { label: t('embed.fields.requestedBy'), name: facts.requestedByName };
  }
  const actorLabel = ACTOR_LABEL[kind];
  if (actorLabel && facts.actorName) parts.actor = { label: t(actorLabel), name: facts.actorName };
  if (kind === 'intraRequested' && facts.fields.length > 0) {
    parts.fields = { label: t('embed.fields.intraFields'), lines: facts.fields };
  }
  if (kind === 'intraChanged' && facts.changes.length > 0) {
    parts.changes = { label: t('embed.fields.changes'), lines: facts.changes };
  }
  if (kind === 'intraPublished' && facts.intraUrl) {
    parts.link = { label: t('embed.fields.intraLink'), url: facts.intraUrl };
  }
  return parts;
}
