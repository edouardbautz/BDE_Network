import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '../../../messages/en.json';
import fr from '../../../messages/fr.json';
import { REPEAT_FREQUENCIES, WEEKDAYS, type RepeatRule } from './repeat';
import {
  describeRepeat,
  patternText,
  summarizeRepeat,
  summaryInputOf,
  type RepeatSummaryInput,
} from './repeat-summary';

// The real messages and the real ICU formatter: the sentence a member reads is what is tested.
const translator = (locale: 'fr' | 'en') =>
  createTranslator({
    locale,
    messages: locale === 'fr' ? fr : en,
    namespace: 'events.repeat.summary',
  }) as unknown as (key: string, values?: Record<string, string | number>) => string;

const tFr = translator('fr');
const tEn = translator('en');

// Saturday 10 October 2026, the 2nd Saturday of its month
const FIRST = { year: 2026, month: 10, day: 10 };
const UNTIL = { year: 2026, month: 12, day: 19 };

const say = (rule: RepeatRule, locale: 'fr' | 'en' = 'fr', first = FIRST, until = UNTIL) =>
  summarizeRepeat({ rule, first, until }, locale === 'fr' ? tFr : tEn, locale);

describe('summarizeRepeat', () => {
  it('says the example of the specification', () => {
    const rule: RepeatRule = { freq: 'WEEKLY', interval: 2, weekdays: ['MO', 'WE'], count: 10 };
    expect(say(rule)).toBe('Toutes les 2 semaines le lundi et le mercredi, 10 fois');
    expect(say(rule, 'en')).toBe('Every 2 weeks on Monday and Wednesday, 10 times');
  });

  it.each<[string, RepeatRule, string, string]>([
    [
      'every day',
      { freq: 'DAILY', interval: 1 },
      "Tous les jours, jusqu'au 19 décembre 2026",
      'Every day, until December 19, 2026',
    ],
    [
      'every 3 days',
      { freq: 'DAILY', interval: 3 },
      "Tous les 3 jours, jusqu'au 19 décembre 2026",
      'Every 3 days, until December 19, 2026',
    ],
    [
      'every weekday',
      { freq: 'WEEKLY', interval: 1, weekdays: ['MO', 'TU', 'WE', 'TH', 'FR'] },
      "Tous les jours de la semaine (du lundi au vendredi), jusqu'au 19 décembre 2026",
      'Every weekday (Monday to Friday), until December 19, 2026',
    ],
    [
      'every week, on the weekday of the first date',
      { freq: 'WEEKLY', interval: 1 },
      "Toutes les semaines le samedi, jusqu'au 19 décembre 2026",
      'Every week on Saturday, until December 19, 2026',
    ],
    [
      'three days a week',
      { freq: 'WEEKLY', interval: 1, weekdays: ['MO', 'WE', 'FR'] },
      "Toutes les semaines le lundi, le mercredi et le vendredi, jusqu'au 19 décembre 2026",
      'Every week on Monday, Wednesday, and Friday, until December 19, 2026',
    ],
    [
      'every month, on the day of the first date',
      { freq: 'MONTHLY', interval: 1 },
      "Tous les mois le 10, jusqu'au 19 décembre 2026",
      'Every month on the 10th, until December 19, 2026',
    ],
    [
      'every 2 months, the 1st',
      { freq: 'MONTHLY', interval: 2, monthly: { kind: 'day', day: 1 } },
      "Tous les 2 mois le 1er, jusqu'au 19 décembre 2026",
      'Every 2 months on the 1st, until December 19, 2026',
    ],
    [
      'every month, the 2nd Saturday',
      { freq: 'MONTHLY', interval: 1, monthly: { kind: 'nth', nth: 2, weekday: 'SA' } },
      "Tous les mois le 2ᵉ samedi, jusqu'au 19 décembre 2026",
      'Every month on the 2nd Saturday, until December 19, 2026',
    ],
    [
      'every month, the last Friday',
      { freq: 'MONTHLY', interval: 1, monthly: { kind: 'nth', nth: -1, weekday: 'FR' } },
      "Tous les mois le dernier vendredi, jusqu'au 19 décembre 2026",
      'Every month on the last Friday, until December 19, 2026',
    ],
    [
      'every month, the last day',
      { freq: 'MONTHLY', interval: 1, monthly: { kind: 'lastDay' } },
      "Tous les mois le dernier jour du mois, jusqu'au 19 décembre 2026",
      'Every month on the last day of the month, until December 19, 2026',
    ],
    [
      'every year, on the day of the first date',
      { freq: 'YEARLY', interval: 1 },
      "Tous les ans le 10 octobre, jusqu'au 19 décembre 2026",
      'Every year on October 10th, until December 19, 2026',
    ],
    [
      'every 2 years, the 2nd Saturday of the month',
      { freq: 'YEARLY', interval: 2, monthly: { kind: 'nth', nth: 2, weekday: 'SA' } },
      "Tous les 2 ans le 2ᵉ samedi d’octobre, jusqu'au 19 décembre 2026",
      'Every 2 years on the 2nd Saturday of October, until December 19, 2026',
    ],
    [
      'every year, the last day of the month',
      { freq: 'YEARLY', interval: 1, monthly: { kind: 'lastDay' } },
      "Tous les ans le dernier jour d’octobre, jusqu'au 19 décembre 2026",
      'Every year on the last day of October, until December 19, 2026',
    ],
    [
      'a number of dates',
      { freq: 'DAILY', interval: 1, count: 1 },
      'Tous les jours, 1 fois',
      'Every day, 1 times',
    ],
  ])('%s', (_name, rule, french, english) => {
    expect(say(rule)).toBe(french);
    expect(say(rule, 'en')).toBe(english);
  });

  it('puts the days in the order of the week, whatever order the rule gives them in', () => {
    const rule: RepeatRule = { freq: 'WEEKLY', interval: 1, weekdays: ['WE', 'MO'] };
    expect(say(rule, 'en')).toContain('Monday and Wednesday');
  });

  it('elides the French "de" before a month that starts with a vowel, and only then', () => {
    const yearly: RepeatRule = { freq: 'YEARLY', interval: 1, monthly: { kind: 'lastDay' } };
    const on = (month: number) => say(yearly, 'fr', { year: 2026, month, day: 10 });
    expect(on(4)).toContain('le dernier jour d’avril');
    expect(on(8)).toContain('le dernier jour d’août');
    expect(on(10)).toContain('le dernier jour d’octobre');
    expect(on(3)).toContain('le dernier jour de mars');
    expect(on(12)).toContain('le dernier jour de décembre');
  });

  it('never leaves a placeholder or a missing value in a sentence, for any rule', () => {
    const rules: RepeatRule[] = [];
    for (const freq of REPEAT_FREQUENCIES) {
      for (const interval of [1, 2, 11]) {
        rules.push({ freq, interval });
        rules.push({ freq, interval, count: 7 });
        if (freq === 'WEEKLY') {
          for (const weekday of WEEKDAYS) rules.push({ freq, interval, weekdays: [weekday] });
        }
        if (freq === 'MONTHLY' || freq === 'YEARLY') {
          rules.push({ freq, interval, monthly: { kind: 'lastDay' } });
          for (const weekday of WEEKDAYS) {
            for (const nth of [1, 2, 3, 4, -1] as const) {
              rules.push({ freq, interval, monthly: { kind: 'nth', nth, weekday } });
            }
          }
          for (const day of [1, 2, 3, 21, 22, 23, 31]) {
            rules.push({ freq, interval, monthly: { kind: 'day', day } });
          }
        }
      }
    }
    for (const rule of rules) {
      for (const locale of ['fr', 'en'] as const) {
        const sentence = say(rule, locale);
        expect(sentence, JSON.stringify(rule)).not.toMatch(/[{}]|undefined|NaN|null/);
        expect(sentence.length).toBeGreaterThan(5);
      }
    }
  });
});

describe('describeRepeat and patternText', () => {
  it('describes the rule alone, without how it ends', () => {
    expect(describeRepeat({ freq: 'WEEKLY', interval: 1 }, FIRST, tEn, 'en')).toBe(
      'Every week on Saturday',
    );
  });

  it('reads what a rule leaves out from the first date it is given', () => {
    const rule: RepeatRule = { freq: 'MONTHLY', interval: 1 };
    // Wednesday 21 October 2026
    const other = { year: 2026, month: 10, day: 21 };
    expect(describeRepeat(rule, other, tEn, 'en')).toBe('Every month on the 21st');
  });

  it('says the pattern of a monthly rule', () => {
    expect(
      patternText(
        { freq: 'MONTHLY', monthly: { kind: 'nth', nth: 3, weekday: 'TU' } },
        FIRST,
        tEn,
        'en',
      ),
    ).toBe('on the 3rd Tuesday');
  });
});

describe('summaryInputOf', () => {
  const event = {
    repeat: { freq: 'WEEKLY', interval: 1 },
    // Saturday 10 October 2026, 23:30 in Paris (UTC+2): the local day is the one that counts
    startsAt: new Date('2026-10-10T21:30:00Z'),
    recurrenceUntil: new Date('2026-12-19T22:59:00Z'),
  };

  it('is null for an event that does not repeat, or whose rule cannot be read', () => {
    expect(summaryInputOf({ ...event, repeat: null }, 'Europe/Paris')).toBeNull();
    expect(summaryInputOf({ ...event, repeat: { freq: 'HOURLY' } }, 'Europe/Paris')).toBeNull();
    expect(summaryInputOf({ ...event, recurrenceUntil: null }, 'Europe/Paris')).toBeNull();
  });

  it('works on the days of the time zone of the BDE, not UTC', () => {
    const input = summaryInputOf(event, 'Europe/Paris') as RepeatSummaryInput;
    expect(input.first).toMatchObject({ year: 2026, month: 10, day: 10 });
    expect(input.until).toMatchObject({ year: 2026, month: 12, day: 19 });
    expect(summaryInputOf(event, 'Pacific/Auckland')?.first).toMatchObject({ day: 11 });
  });

  it('says the sentence of a stored event', () => {
    const input = summaryInputOf(event, 'Europe/Paris') as RepeatSummaryInput;
    expect(summarizeRepeat(input, tFr, 'fr')).toBe(
      "Toutes les semaines le samedi, jusqu'au 19 décembre 2026",
    );
  });
});
