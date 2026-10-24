import type { IntraAudience } from '@/generated/prisma/client';

// What the school's staff needs to publish an event on the intra 42 (the event form of the intra, common to the whole
// network). They sit on the event, all set or none; the form and the server action share this pure module, like
// `input.ts` (the browser shows the errors, the server checks again).

export const INTRA_AUDIENCES: readonly IntraAudience[] = ['STUDENTS', 'PISCINERS', 'BOTH'];

/** The kinds the intra offers, written as the intra writes them (they are copied as they are). Checked here and not
 * by the database: a kind the intra adds is one line and no migration. */
export const INTRA_KINDS = [
  'Pedago/Rush',
  'Pedago/Piscine',
  'Pedago/Partnership',
  'Meet/Conference',
  'Meet/meet_up',
  'Meet/event',
  'Association',
  'Speed working/Hackathon',
  'Speed working/Workshop',
  'Speed working/Challenge',
  'Extern',
] as const;

export const INTRA_MAX_PEOPLE_LIMIT = 10_000;
/** A year: the delay before the start after which nobody can unsubscribe. */
export const INTRA_UNSUBSCRIBE_HOURS_LIMIT = 8_760;
export const INTRA_KEYWORDS_LIMIT = 20;
export const INTRA_KEYWORD_MAX_LENGTH = 40;
export const INTRA_LOGIN_MAX_LENGTH = 30;

/** An intra login: lower case letters, digits, hyphen and underscore. */
const LOGIN_PATTERN = /^[a-z0-9_-]+$/;

export interface IntraFields {
  organizerLogin: string;
  audience: IntraAudience;
  maxPeople: number;
  waitingList: boolean;
  kind: string;
  unsubscribeHours: number;
  /** At least one, copied to the intra as a comma separated list. */
  keywords: string[];
}

/** Raw values as submitted by the form (all strings). `intraWaitingList` is `yes`, `no` or empty. */
export interface RawIntra {
  intraOrganizerLogin: string;
  intraAudience: string;
  intraMaxPeople: string;
  intraWaitingList: string;
  intraKind: string;
  intraUnsubscribeHours: string;
  intraKeywords: string[];
}

export type IntraField = keyof RawIntra;
/** Keys of `events.form.errors.*` in the message catalogs. */
export type IntraErrorCode = 'required' | 'tooLong' | 'invalid' | 'tooMany' | 'tooBig';
export type IntraErrors = Partial<Record<IntraField, IntraErrorCode>>;

/** The columns of an Event row that hold the intra fields. */
export interface IntraColumns {
  intraOrganizerLogin: string | null;
  intraAudience: IntraAudience | null;
  intraMaxPeople: number | null;
  intraWaitingList: boolean | null;
  intraKind: string | null;
  intraUnsubscribeHours: number | null;
  intraKeywords: string[];
}

/** A keyword as it is kept: one line, spaces collapsed, no comma (the intra takes a list separated by commas). */
export function normalizeKeyword(value: string): string {
  return value.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The keywords as they are kept: normalised, empty ones dropped, the same word once (whatever its case). */
export function normalizeKeywords(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const keyword = normalizeKeyword(value);
    const key = keyword.toLocaleLowerCase();
    if (keyword === '' || seen.has(key)) continue;
    seen.add(key);
    result.push(keyword);
  }
  return result;
}

function integerIn(value: string, min: number, max: number): number | 'invalid' | 'tooBig' {
  const text = value.trim();
  if (!/^\d{1,9}$/.test(text)) return 'invalid';
  const number = Number(text);
  if (number < min) return 'invalid';
  return number > max ? 'tooBig' : number;
}

/** Validates the intra fields. Every problem is reported, one code per field. */
export function parseIntra(
  raw: RawIntra,
): { ok: true; data: IntraFields } | { ok: false; errors: IntraErrors } {
  const errors: IntraErrors = {};

  const organizerLogin = raw.intraOrganizerLogin.trim().toLowerCase();
  if (organizerLogin === '') errors.intraOrganizerLogin = 'required';
  else if (organizerLogin.length > INTRA_LOGIN_MAX_LENGTH) errors.intraOrganizerLogin = 'tooLong';
  else if (!LOGIN_PATTERN.test(organizerLogin)) errors.intraOrganizerLogin = 'invalid';

  const audience = INTRA_AUDIENCES.find((value) => value === raw.intraAudience);
  if (!audience) errors.intraAudience = raw.intraAudience === '' ? 'required' : 'invalid';

  let maxPeople = 0;
  if (raw.intraMaxPeople.trim() === '') errors.intraMaxPeople = 'required';
  else {
    const parsed = integerIn(raw.intraMaxPeople, 1, INTRA_MAX_PEOPLE_LIMIT);
    if (typeof parsed === 'number') maxPeople = parsed;
    else errors.intraMaxPeople = parsed;
  }

  if (raw.intraWaitingList === '') errors.intraWaitingList = 'required';
  else if (raw.intraWaitingList !== 'yes' && raw.intraWaitingList !== 'no') {
    errors.intraWaitingList = 'invalid';
  }

  const kind = INTRA_KINDS.find((value) => value === raw.intraKind);
  if (!kind) errors.intraKind = raw.intraKind === '' ? 'required' : 'invalid';

  let unsubscribeHours = 0;
  if (raw.intraUnsubscribeHours.trim() === '') errors.intraUnsubscribeHours = 'required';
  else {
    const parsed = integerIn(raw.intraUnsubscribeHours, 0, INTRA_UNSUBSCRIBE_HOURS_LIMIT);
    if (typeof parsed === 'number') unsubscribeHours = parsed;
    else errors.intraUnsubscribeHours = parsed;
  }

  const keywords = normalizeKeywords(raw.intraKeywords);
  if (keywords.length === 0) errors.intraKeywords = 'required';
  else if (keywords.length > INTRA_KEYWORDS_LIMIT) errors.intraKeywords = 'tooMany';
  else if (keywords.some((keyword) => keyword.length > INTRA_KEYWORD_MAX_LENGTH)) {
    errors.intraKeywords = 'tooLong';
  }

  if (Object.keys(errors).length > 0 || !audience || !kind) return { ok: false, errors };
  return {
    ok: true,
    data: {
      organizerLogin,
      audience,
      maxPeople,
      waitingList: raw.intraWaitingList === 'yes',
      kind,
      unsubscribeHours,
      keywords,
    },
  };
}

/** The intra fields of an event row, or null when it has none (or, which the database refuses, only some). */
export function intraOf(row: Partial<IntraColumns>): IntraFields | null {
  if (
    row.intraOrganizerLogin == null ||
    row.intraAudience == null ||
    row.intraMaxPeople == null ||
    row.intraWaitingList == null ||
    row.intraKind == null ||
    row.intraUnsubscribeHours == null ||
    !row.intraKeywords ||
    row.intraKeywords.length === 0
  ) {
    return null;
  }
  return {
    organizerLogin: row.intraOrganizerLogin,
    audience: row.intraAudience,
    maxPeople: row.intraMaxPeople,
    waitingList: row.intraWaitingList,
    kind: row.intraKind,
    unsubscribeHours: row.intraUnsubscribeHours,
    keywords: row.intraKeywords,
  };
}

/** The columns to write for validated fields (none: the blank ones, which the database accepts only all together). */
export function intraColumns(fields: IntraFields | null): IntraColumns {
  if (!fields) {
    return {
      intraOrganizerLogin: null,
      intraAudience: null,
      intraMaxPeople: null,
      intraWaitingList: null,
      intraKind: null,
      intraUnsubscribeHours: null,
      intraKeywords: [],
    };
  }
  return {
    intraOrganizerLogin: fields.organizerLogin,
    intraAudience: fields.audience,
    intraMaxPeople: fields.maxPeople,
    intraWaitingList: fields.waitingList,
    intraKind: fields.kind,
    intraUnsubscribeHours: fields.unsubscribeHours,
    intraKeywords: fields.keywords,
  };
}

export function sameIntra(a: IntraFields | null, b: IntraFields | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.organizerLogin === b.organizerLogin &&
    a.audience === b.audience &&
    a.maxPeople === b.maxPeople &&
    a.waitingList === b.waitingList &&
    a.kind === b.kind &&
    a.unsubscribeHours === b.unsubscribeHours &&
    a.keywords.length === b.keywords.length &&
    a.keywords.every((keyword, index) => keyword === b.keywords[index])
  );
}

/** The form's raw values for an event: what it has, or the starting point of a new one (the author as organizer). */
export function rawIntraOf(row: Partial<IntraColumns> | null, authorLogin: string): RawIntra {
  const fields = row ? intraOf(row) : null;
  if (!fields) {
    return {
      intraOrganizerLogin: authorLogin,
      intraAudience: '',
      intraMaxPeople: '',
      intraWaitingList: '',
      intraKind: '',
      intraUnsubscribeHours: '',
      intraKeywords: [],
    };
  }
  return {
    intraOrganizerLogin: fields.organizerLogin,
    intraAudience: fields.audience,
    intraMaxPeople: String(fields.maxPeople),
    intraWaitingList: fields.waitingList ? 'yes' : 'no',
    intraKind: fields.kind,
    intraUnsubscribeHours: String(fields.unsubscribeHours),
    intraKeywords: fields.keywords,
  };
}

/** The kinds as the form's select groups them: `Meet/meet_up` is "meet_up" in the group "Meet"; one with no slash stands alone. */
export function groupedKinds(): {
  group: string | null;
  kinds: { value: string; label: string }[];
}[] {
  const groups: { group: string | null; kinds: { value: string; label: string }[] }[] = [];
  for (const value of INTRA_KINDS) {
    const slash = value.indexOf('/');
    const group = slash === -1 ? null : value.slice(0, slash);
    const label = slash === -1 ? value : value.slice(slash + 1);
    const last = groups[groups.length - 1];
    if (group !== null && last?.group === group) last.kinds.push({ value, label });
    else groups.push({ group, kinds: [{ value, label }] });
  }
  return groups;
}
