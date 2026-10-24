import { z } from 'zod';
import type { EventStatus } from '@/generated/prisma/client';
import {
  parseIntra,
  type IntraErrorCode,
  type IntraField,
  type IntraFields,
  type RawIntra,
} from './intra';
import type { RepeatRule } from './repeat';
import {
  parseRepeatInput,
  planRepeat,
  type RawRepeat,
  type RepeatErrorCode,
  type RepeatField,
} from './repeat-input';
import { fromLocalDateTime, parseLocalInput, schoolYearOf } from './time';

// This module is pure (no server-only imports): the event form runs it in the
// browser to show errors before submitting, and the server actions run the very
// same code again — the browser is never trusted.

export const EVENT_STATUSES: readonly EventStatus[] = ['DRAFT', 'PROPOSED', 'CONFIRMED'];

export const TITLE_MAX_LENGTH = 120;
export const LOCATION_MAX_LENGTH = 200;
export const DESCRIPTION_MAX_LENGTH = 5000;

export type EventFormField =
  | 'title'
  | 'description'
  | 'location'
  | 'categoryKey'
  | 'startsAt'
  | 'endsAt'
  | RepeatField
  | IntraField
  | 'status';

/** Keys of `events.form.errors.*` in the message catalogs. */
export type EventFormErrorCode =
  'required' | 'tooLong' | 'invalid' | 'endBeforeStart' | IntraErrorCode | RepeatErrorCode;

export type EventFormErrors = Partial<Record<EventFormField, EventFormErrorCode>>;

/** Raw values as submitted by the form (all strings, wall-clock dates). */
export interface RawEventInput extends RawRepeat, RawIntra {
  title: string;
  description: string;
  location: string;
  categoryKey: string;
  startsAt: string;
  endsAt: string;
  status: string;
  assigneeLogins: string[];
}

export interface EventData {
  title: string;
  description: string;
  location: string;
  categoryKey: string;
  status: EventStatus;
  startsAt: Date;
  endsAt: Date;
  /** null: the event does not repeat. */
  repeat: RepeatRule | null;
  /** When the series ends (see `Event.recurrenceUntil`); null exactly when `repeat` is. */
  recurrenceUntil: Date | null;
  schoolYear: string;
  assigneeLogins: string[];
  /** What the intra's form asks for; null when the platform does not publish on the intra (nothing was asked). */
  intra: IntraFields | null;
}

export type ParsedEventInput =
  { ok: true; data: EventData } | { ok: false; errors: EventFormErrors };

function isOneOf<T extends string>(allowed: readonly T[], value: string): value is T {
  return (allowed as readonly string[]).includes(value);
}

/** A required text: surrounding spaces ignored, so "   " counts as empty. The
 * messages are error codes, translated by the form (`events.form.errors.*`). */
const requiredText = (maxLength: number) =>
  z.string().trim().min(1, 'required').max(maxLength, 'tooLong');

const requiredLocalDateTime = z
  .string()
  .min(1, 'required')
  .refine((value) => parseLocalInput(value) !== null, 'invalid');

/**
 * Field-level rules. Required: title, description, location, category, start,
 * end (and the series end date, checked below once the recurrence is known).
 * Only the members in charge are optional.
 */
function fieldSchema(categoryKeys: readonly string[]) {
  return z.object({
    title: requiredText(TITLE_MAX_LENGTH),
    description: requiredText(DESCRIPTION_MAX_LENGTH),
    location: requiredText(LOCATION_MAX_LENGTH),
    categoryKey: z
      .string()
      .min(1, 'required')
      .refine((value) => categoryKeys.includes(value), 'invalid'),
    startsAt: requiredLocalDateTime,
    endsAt: requiredLocalDateTime,
    status: z.string().refine((value) => isOneOf(EVENT_STATUSES, value), 'invalid'),
  });
}

/**
 * Validates and normalises the event form. Dates are wall-clock values in
 * `timeZone` (the BDE timezone) and are converted to UTC here — the only
 * place a form date becomes an instant. All problems are reported together,
 * one code per field, so the form can show every error at once.
 */
export function parseEventInput(
  raw: RawEventInput,
  options: { timeZone: string; categoryKeys: readonly string[]; intra?: boolean },
): ParsedEventInput {
  const errors: EventFormErrors = {};

  const fields = fieldSchema(options.categoryKeys).safeParse(raw);
  if (!fields.success) {
    for (const issue of fields.error.issues) {
      const field = issue.path[0] as EventFormField;
      // Keep the first (most basic) problem of each field: "required" before "invalid".
      errors[field] ??= issue.message as EventFormErrorCode;
    }
  }

  const startLocal = parseLocalInput(raw.startsAt);
  const endLocal = parseLocalInput(raw.endsAt);
  const startsAt = startLocal ? fromLocalDateTime(startLocal, options.timeZone) : null;
  const endsAt = endLocal ? fromLocalDateTime(endLocal, options.timeZone) : null;
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
    errors.endsAt = 'endBeforeStart';
  }

  // The intra's fields are required, all of them, once the platform publishes on the intra.
  const parsedIntra = options.intra ? parseIntra(raw) : null;
  if (parsedIntra && !parsedIntra.ok) Object.assign(errors, parsedIntra.errors);

  const parsedRepeat = parseRepeatInput(raw, startLocal);
  if (!parsedRepeat.ok) Object.assign(errors, parsedRepeat.errors);

  if (Object.keys(errors).length > 0 || !startsAt || !endsAt || !startLocal) {
    return { ok: false, errors };
  }

  // Reported only when everything else is fine, so it never sits next to an unrelated error.
  const plan = planRepeat(raw, { startsAt, endsAt, startLocal }, options.timeZone);
  if (!plan.ok) return { ok: false, errors: plan.errors };

  return {
    ok: true,
    data: {
      title: raw.title.trim(),
      description: raw.description.trim(),
      location: raw.location.trim(),
      categoryKey: raw.categoryKey,
      status: raw.status as EventStatus,
      // The first date is the one typed, or the first that fits the rule (a Tuesday, with "Monday and Wednesday").
      startsAt: plan.startsAt,
      endsAt: plan.endsAt,
      repeat: plan.rule,
      recurrenceUntil: plan.recurrenceUntil,
      schoolYear: schoolYearOf(plan.startsAt, options.timeZone),
      assigneeLogins: [...new Set(raw.assigneeLogins.map((login) => login.trim()).filter(Boolean))],
      intra: parsedIntra?.ok ? parsedIntra.data : null,
    },
  };
}

/** The columns of the Event row for validated input (assignees live in their own table, the intra fields in their own
 * columns: see `intraColumns`). */
export function toEventRow(data: EventData): Omit<EventData, 'assigneeLogins' | 'intra'> {
  return {
    title: data.title,
    description: data.description,
    location: data.location,
    categoryKey: data.categoryKey,
    status: data.status,
    startsAt: data.startsAt,
    endsAt: data.endsAt,
    repeat: data.repeat,
    recurrenceUntil: data.recurrenceUntil,
    schoolYear: data.schoolYear,
  };
}
