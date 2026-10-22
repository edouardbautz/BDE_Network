import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';

/**
 * Every column of the database that can hold a person, and what the platform does about it: exported when the person asks for a
 * copy of their data, and erased (or kept as plain text, as the privacy policy says) when the account is removed.
 *
 * The columns are READ FROM THE SCHEMA (`prisma/schema.prisma`): a foreign key to `User`, and a text column that is a login, an
 * e-mail, a name, a picture or a campus. A new column of that kind fails this test until it is written in `PERSON_COLUMNS` with
 * where the export finds it. Found by the quality campaign: the export promised "a copy of everything we hold about you" and left
 * out the dates a person is in charge of on their own, the dates they cancelled, the proposals they refused, and what was done to
 * their account.
 */

const ROOT = process.cwd();
const schema = readFileSync(join(ROOT, 'prisma', 'schema.prisma'), 'utf8');
const exportRoute = readFileSync(
  join(ROOT, 'src', 'app', 'api', 'me', 'export', 'route.ts'),
  'utf8',
);

interface Column {
  /** Where the export puts it, and a piece of the route that proves the query is there. */
  exportedAs: string;
  evidence: string;
}

const user = (as: string, evidence: string): Column => ({ exportedAs: as, evidence });

const PERSON_COLUMNS: Record<string, Column> = {
  'User.login': user('user.login', 'login: true'),
  'User.fullName': user('user.fullName', 'fullName: true'),
  'User.email': user('user.email', 'email: true'),
  'User.photoUrl': user('user.photoUrl', 'photoUrl: true'),
  'User.campus': user('user.campus', 'campus: true'),
  // only whether a link exists: the secret itself is not given back
  'User.calendarToken': user('calendarFeedActive', 'calendarToken: true'),
  'AuditLog.actorId': user('auditLogActions', 'actorId: userId'),
  'AuditLog.actorLogin': user('auditLogActions', 'actorId: userId'),
  'Event.authorId': user('events.authored', 'authorId: userId'),
  'Event.authorLogin': user('events.authored', 'authorId: userId'),
  'Event.refusedByLogin': user('events.refusedProposals', 'refusedByLogin: user.login'),
  'EventAssignee.userId': user('events.inChargeOf', 'prisma.eventAssignee'),
  'EventAssignee.login': user('events.inChargeOf', 'prisma.eventAssignee'),
  'EventOccurrenceAssignee.userId': user(
    'events.datesInChargeOf',
    'prisma.eventOccurrenceAssignee',
  ),
  'EventOccurrenceAssignee.login': user('events.datesInChargeOf', 'prisma.eventOccurrenceAssignee'),
  'EventCancellation.cancelledById': user('events.cancelledDates', 'cancelledById: userId'),
  'EventCancellation.cancelledByLogin': user('events.cancelledDates', 'cancelledById: userId'),
};

/** A text column that is a person: a login (`login`, `authorLogin`…), an e-mail, a name, a picture, a campus, a token. */
const PERSON_TEXT = /^(login|email|fullName|photoUrl|campus|calendarToken|\w+Login)$/;

interface Field {
  model: string;
  name: string;
  line: string;
}

function fieldsOf(): Field[] {
  const result: Field[] = [];
  for (const model of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    for (const line of model[2]!.split('\n')) {
      const field = /^\s{2}(\w+)\s+(\w+)(\?|\[\])?/.exec(line);
      if (field && !line.trim().startsWith('//') && !line.trim().startsWith('@@'))
        result.push({ model: model[1]!, name: field[1]!, line });
    }
  }
  return result;
}

/** The foreign keys that point to an account, and the text columns that are a person. */
function discovered(): { columns: string[]; keysToUser: Field[] } {
  const fields = fieldsOf();
  const keysToUser: Field[] = [];
  const columns: string[] = [];
  for (const field of fields) {
    const relation = /@relation\([^)]*fields:\s*\[(\w+)\]/.exec(field.line);
    const type = /^\s{2}\w+\s+(\w+)/.exec(field.line)?.[1];
    if (relation && type === 'User') {
      keysToUser.push({ ...field, name: relation[1]! });
      columns.push(`${field.model}.${relation[1]}`);
    } else if (/\sString\??\s*(@|$)/.test(field.line) && PERSON_TEXT.test(field.name)) {
      columns.push(`${field.model}.${field.name}`);
    }
  }
  return { columns: [...new Set(columns)].sort(), keysToUser };
}

describe('the columns that can hold a person', () => {
  it('are all classified: a new one has to say where the export finds it', () => {
    const { columns } = discovered();
    expect(
      columns.filter((column) => !(column in PERSON_COLUMNS)),
      'not in PERSON_COLUMNS',
    ).toEqual([]);
    expect(
      Object.keys(PERSON_COLUMNS).filter((column) => !columns.includes(column)),
      'no longer in the schema',
    ).toEqual([]);
  });

  it('are found by the export: the query is in the route, and the category is in its answer', () => {
    for (const [column, { exportedAs, evidence }] of Object.entries(PERSON_COLUMNS)) {
      expect(exportRoute, `${column}: the route has no ${evidence}`).toContain(evidence);
      const key = exportedAs.split('.').pop()!;
      expect(exportRoute, `${column}: the answer has no ${exportedAs}`).toMatch(
        new RegExp(`\\b${key}\\b`),
      );
    }
  });

  it('can be erased: every foreign key to an account lets the account be deleted (cleared, or deleted with it)', () => {
    const { keysToUser } = discovered();
    expect(keysToUser.length).toBeGreaterThanOrEqual(5);
    for (const key of keysToUser) {
      expect(key.line, `${key.model}.${key.name}`).toMatch(/onDelete:\s*(SetNull|Cascade)/);
    }
  });

  it('are announced to the person: the privacy policy lists what is collected about an account, in both languages', () => {
    const wording = {
      en: [/login/i, /full name/i, /email/i, /picture/i, /campus/i],
      fr: [/login|identifiant/i, /nom complet/i, /e-?mail|courriel/i, /photo/i, /campus/i],
    } as const;
    for (const [language, messages] of [
      ['en', en],
      ['fr', fr],
    ] as const) {
      const items = (messages as { privacy: { dataCollected: { items: string[] } } }).privacy
        .dataCollected.items;
      for (const pattern of wording[language]) {
        expect(
          items.some((item) => pattern.test(item)),
          `${language}: nothing in the list of collected data matches ${pattern}`,
        ).toBe(true);
      }
    }
  });

  it('are exported with the audit entries about the account too (the ones where the person is the target)', () => {
    expect(exportRoute).toContain("targetType: 'User', targetId: userId");
    expect(exportRoute).toMatch(/auditLogAboutYou/);
  });
});
