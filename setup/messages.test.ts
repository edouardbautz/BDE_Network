// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { catalogs, translator, type MessageKey } from './messages';

const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
const keys = Object.keys(catalogs.fr) as MessageKey[];

describe('the message catalogs', () => {
  it('have exactly the same keys in French and in English', () => {
    expect(Object.keys(catalogs.en).sort()).toEqual(Object.keys(catalogs.fr).sort());
  });

  it('use the same placeholders in both languages', () => {
    for (const key of keys) {
      expect(placeholders(catalogs.en[key]), key).toEqual(placeholders(catalogs.fr[key]));
    }
  });

  it('have no empty message', () => {
    for (const key of keys) {
      expect(catalogs.fr[key].trim(), `fr.${key}`).not.toBe('');
      expect(catalogs.en[key].trim(), `en.${key}`).not.toBe('');
    }
  });

  it('are really in two languages: only names and words common to both are written the same', () => {
    const same = keys.filter((key) => catalogs.fr[key] === catalogs.en[key]);
    // "Français" / "English", the words Campus, Modules and Notifications, and a message that is only a placeholder.
    expect(same.sort()).toEqual(
      [
        'askCampus',
        'invalid',
        'localeEn',
        'localeFr',
        'stepModules',
        'stepNotifications',
        'sumNotifications',
      ].sort(),
    );
  });

  it('are all used by the assistant: there is no dead message', () => {
    const sources = readdirSync(__dirname)
      .filter(
        (name) =>
          name.endsWith('.ts') &&
          !name.endsWith('.test.ts') &&
          name !== 'messages.ts' &&
          name !== 'test-helpers.ts',
      )
      .map((name) => readFileSync(join(__dirname, name), 'utf8'))
      .join('\n');
    // A key is used when it appears as a quoted string in the code, or is built from a quoted prefix.
    const unused = keys.filter((key) => !sources.includes(`'${key}'`));
    expect(unused).toEqual([]);
  });

  it('never ask for a secret to be typed without saying it stays invisible', () => {
    for (const key of ['askClientSecret', 'askDiscord', 'askSlack', 'askSmtpPassword'] as const) {
      expect(catalogs.fr[key], `fr.${key}`).toContain('invisible');
      expect(catalogs.en[key], `en.${key}`).toContain('invisible');
    }
  });
});

describe('translator', () => {
  it('writes a message of the chosen language', () => {
    expect(translator('fr')('welcome')).toBe("Assistant d'installation de BDE_Network");
    expect(translator('en')('welcome')).toBe('BDE_Network setup assistant');
  });

  it('replaces each placeholder, numbers included, and every occurrence of it', () => {
    expect(translator('fr')('step', { n: 3, total: 9, title: 'Adresse' })).toBe(
      'Étape 3/9 — Adresse',
    );
    expect(translator('en')('written', { files: '.env' })).toBe('✓ Files written: .env');
  });

  it('leaves a placeholder that was given no value as it is, so a mistake is visible', () => {
    expect(translator('fr')('step', { n: 1 })).toBe('Étape 1/{total} — {title}');
  });

  it('does not interpret special characters of a value', () => {
    expect(translator('en')('addressSummary', { url: '$& $1 {x}' })).toBe(
      'Address of the platform (APP_URL): $& $1 {x}',
    );
  });
});
