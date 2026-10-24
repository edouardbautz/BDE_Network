import type { EventCardKind } from '@/lib/events/card-kind';
import type { TemplateType } from './types';

/**
 * The card kind each notification about an event is drawn as: the events' own, the proposal circuit's and the publication on the intra's
 * (the reminder of tomorrow stands for both reminders: its words say `{day}`). A type that is not here is about a member.
 */
export const EVENT_KIND_OF: Partial<Record<TemplateType, EventCardKind>> = {
  eventConfirmed: 'confirmed',
  eventReminder: 'tomorrow',
  eventProposed: 'proposed',
  eventApproved: 'approved',
  eventRefused: 'refused',
  intraRequested: 'intraRequested',
  intraChanged: 'intraChanged',
  intraCancelled: 'intraCancelled',
  intraPublished: 'intraPublished',
  intraRefused: 'intraRefused',
};

/** The ones that speak to the school's staff (the others speak to the author and the BDE's room): `{@staff}` is theirs alone. */
export const STAFF_TYPES: readonly TemplateType[] = [
  'intraRequested',
  'intraChanged',
  'intraCancelled',
];

/** The notifications about the publication on the intra: they exist only while the platform publishes there. */
export const INTRA_TYPES: readonly TemplateType[] = [
  'intraRequested',
  'intraChanged',
  'intraCancelled',
  'intraPublished',
  'intraRefused',
];
