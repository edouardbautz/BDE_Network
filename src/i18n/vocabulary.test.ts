// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';

/**
 * One word per thing (docs/design.md, "Copywriting"; the glossary): an **access request** is APPROVED or refused, never validated; the
 * **proposal of an event** is VALIDATED or refused (by a validator), never approved. The two circuits are different and the words are what
 * tells people which one a message is about.
 *
 * What is read: the catalogs by the place a text belongs to, the references of the notifications, and the documentation by line.
 * The key names (`eventApproved`, `event.approve` in the audit log) are identifiers and keep their spelling: only words people read count.
 */

const ROOT = join(__dirname, '..', '..');

/** Every text of a catalog, with the path of its key. */
function texts(node: unknown, path = '', out: [string, string][] = []): [string, string][] {
  if (typeof node === 'string') out.push([path, node]);
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node))
      texts(value, path ? `${path}.${key}` : key, out);
  }
  return out;
}

// valid, valide, validé, valider, validez, validation, validate, validated, validator, validateur... but not invalid / invalide / invalidAssignee
const VALIDATE =
  /(?<![a-z])valid(?:e|é|ée|és|ées|er|ez|ons|ation|ations|ate|ated|ates|ating|ator|ateur|ateurs)?(?![a-z])/i;
const APPROVE = /approv|approuv|approba/i;

const ACCESS = [
  /^pending\./,
  /^members\./,
  /^permissions\.items\.members\./,
  /^setup\.notifications\.types\.member/,
  /^templates\.types\.member/,
  /^roles\.errors\.targetNotMember$/,
  /^roles\.list\.defaultNote$/,
  /^events\.form\.formErrors\.invalidAssignee$/,
];
const EVENTS = [
  /^events\./,
  /^permissions\.items\.events\./,
  /^setup\.notifications\.types\.event/,
  /^templates\.types\.event/,
  /^nav\.items?\.events/,
];
/** The one text of the events' catalog that is about a member, not an event. */
const ABOUT_A_MEMBER = new Set(['events.form.formErrors.invalidAssignee']);

const catalogs = { fr: texts(fr), en: texts(en) };

describe('the word of an access request is approve, never validate', () => {
  for (const [locale, all] of Object.entries(catalogs)) {
    it(`in the ${locale} catalog`, () => {
      const found = all.filter(
        ([path, text]) => ACCESS.some((rule) => rule.test(path)) && VALIDATE.test(text),
      );
      expect(found).toEqual([]);
    });
  }

  it('is also true of the titles of the waiting page and of the section of the requests, which say it', () => {
    expect(fr.pending.title).toBe("Votre compte est en attente d'approbation");
    expect(fr.members.pendingSection).toBe("En attente d'approbation");
    expect(en.pending.title).toBe('Your account is awaiting approval');
    expect(en.members.pendingSection).toBe('Awaiting approval');
  });
});

describe('the word of the proposal of an event is validate, never approve', () => {
  for (const [locale, all] of Object.entries(catalogs)) {
    it(`in the ${locale} catalog`, () => {
      const found = all.filter(
        ([path, text]) =>
          EVENTS.some((rule) => rule.test(path)) && !ABOUT_A_MEMBER.has(path) && APPROVE.test(text),
      );
      expect(found).toEqual([]);
    });
  }
});

function files(dir: string, accepts: (path: string) => boolean, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '.git', 'generated'].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files(path, accepts, found);
    else if (accepts(path)) found.push(path);
  }
  return found;
}
const rel = (path: string) => relative(ROOT, path).replaceAll('\\', '/');

describe('the references of the notifications', () => {
  it('say that a proposal is validated and that a request is approved', () => {
    for (const file of files(join(ROOT, 'src/lib/notifications/__golden__'), (p) =>
      /^(events|events-plain)-(en|fr)\.json$/.test(p.split(/[\\/]/).pop() ?? ''),
    )) {
      // the key of a card (`"full/approved"`, `"approved"`) is an identifier, not a word anyone reads
      const read = readFileSync(file, 'utf8').replace(/"(?:[a-z]+\/)?approved"/g, '');
      expect(APPROVE.test(read), rel(file)).toBe(false);
    }
    for (const file of files(join(ROOT, 'src/lib/notifications/__golden__'), (p) =>
      /^members-(en|fr)\.json$/.test(p.split(/[\\/]/).pop() ?? ''),
    )) {
      expect(VALIDATE.test(readFileSync(file, 'utf8')), rel(file)).toBe(false);
    }
  });
});

/** Code (`eventApproved`) is an identifier; the lines of the glossary that state the rule name both words on purpose. */
const reading = (line: string) =>
  /^\| \*\*(Approve|Approuver|Validate|Valider)\*\*/.test(line) ? '' : line.replace(/`[^`]*`/g, '');

const ACCESS_WORDS =
  /access request|demande d'accès|demandes d'accès|account|compte|awaiting approval|waiting for approval|en attente d'approbation|new members|nouveaux membres|requests? to approve/i;
const EVENT_WORDS =
  /event|événement|proposal|proposition|validator|validateur|propos|valide[rz]? l|to validate|à valider|draft|brouillon|role|rôle|right|droit|Submit|42 intra|intra/i;
const MEMBER_WORDS =
  /member|membre|request|demande|access|accès|removal|retrait|BDE|sign|connexion/i;

describe('the documentation', () => {
  const documents = files(
    ROOT,
    (p) =>
      /(^|[\\/])(docs[\\/](en|fr)[\\/][^\\/]+|README(\.fr)?)\.md$/.test(p) &&
      !/quality\.md$/.test(p),
  );

  it('finds the pages it reads', () => {
    expect(documents.length).toBeGreaterThan(20);
  });

  it('does not validate an access request', () => {
    const found: string[] = [];
    for (const file of documents) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((raw, index) => {
          const line = reading(raw);
          if (VALIDATE.test(line) && ACCESS_WORDS.test(line) && !EVENT_WORDS.test(line)) {
            found.push(`${rel(file)}:${index + 1}: ${line.trim().slice(0, 100)}`);
          }
        });
    }
    expect(found).toEqual([]);
  });

  it('does not approve an event or a proposal', () => {
    const found: string[] = [];
    for (const file of documents) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((raw, index) => {
          const line = reading(raw);
          if (
            APPROVE.test(line) &&
            /event|événement|proposal|proposition|eventApproved/i.test(line) &&
            !MEMBER_WORDS.test(line)
          ) {
            found.push(`${rel(file)}:${index + 1}: ${line.trim().slice(0, 100)}`);
          }
        });
    }
    expect(found).toEqual([]);
  });
});

describe('what this test looks for', () => {
  it('sees the words and only the words', () => {
    for (const word of [
      'En attente de validation',
      'validate',
      'Validation',
      'valider',
      'validé',
      'validator',
    ]) {
      expect(VALIDATE.test(word), word).toBe(true);
    }
    for (const word of ['invalid', 'invalide', 'invalidAssignee', 'Submit', 'valeur', 'valable']) {
      expect(VALIDATE.test(word), word).toBe(false);
    }
    for (const word of ['approved', 'Approuver', 'approbation', 'Approve']) {
      expect(APPROVE.test(word), word).toBe(true);
    }
    expect(APPROVE.test('validated')).toBe(false);
  });
});
