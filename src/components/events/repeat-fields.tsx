'use client';

import { useState } from 'react';
import { Info } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  MAX_OCCURRENCES,
  WEEKDAYS,
  expandRepeat,
  weekdayOf,
  type Weekday,
} from '@/lib/events/repeat';
import {
  REPEAT_PRESETS,
  monthlyPatternOf,
  planRepeat,
  presetRule,
  type MonthlyChoice,
  type RawRepeat,
  type RepeatErrorCode,
  type RepeatField,
  type RepeatPreset,
} from '@/lib/events/repeat-input';
import {
  describeRepeat,
  patternText,
  summarizeRepeat,
  weekdayName,
  type RepeatTranslate,
} from '@/lib/events/repeat-summary';
import { formatDayMonth, formatLongDate, formatWeekdayDayMonth } from '@/lib/events/format';
import {
  formatLocalInput,
  fromLocalDateTime,
  parseLocalInput,
  toLocalDateTime,
} from '@/lib/events/time';
import { NativeSelect } from './field-styles';

/** How many of the next dates the preview lists. */
const PREVIEW_DATES = 3;

/** A day to work the choices out from while the first date typed is not a date (any: it only words the labels). */
const REFERENCE_DAY = { year: 2024, month: 1, day: 15 };

interface RepeatFieldsProps {
  /** What the form starts from (an event that does not repeat, or the rule of the one being edited). */
  values: RawRepeat;
  /** The first date and the end typed in the form (`YYYY-MM-DDTHH:mm`), which the choices are worked out from. */
  startsAt: string;
  endsAt: string;
  timeZone: string;
  /**
   * Moves the first date of the form (and its end, so the duration stays) to the day the series would start on: the button
   * of the notice shown when the date typed is not one of the rule's days.
   */
  onStartChange: (startsAt: string, endsAt: string) => void;
  /** The message of the error a field carries (the form validates, here and on the server), or null. */
  error: (field: RepeatField) => string | null;
}

const MONTHLY_CHOICES: readonly MonthlyChoice[] = ['day', 'nth', 'last', 'lastDay'];

/**
 * The "Repeat" part of the event form: a list of the usual choices worded from the first date ("Every week on Monday",
 * "Every month on the 2nd Tuesday"…), "Custom" for the rest, how the series ends, and under it the sentence that says
 * the rule and the next dates it gives. Everything is worked out by the same functions the server runs again.
 */
export function RepeatFields({
  values,
  startsAt,
  endsAt,
  timeZone,
  onStartChange,
  error,
}: RepeatFieldsProps) {
  const t = useTranslations('events.repeat.form');
  const tSummary = useTranslations('events.repeat.summary') as unknown as RepeatTranslate;
  const tErrors = useTranslations('events.form.errors');
  const locale = useLocale();

  const [preset, setPreset] = useState(values.repeat);
  const [freq, setFreq] = useState(values.repeatFreq);
  const [interval, setInterval] = useState(values.repeatInterval);
  const [weekdays, setWeekdays] = useState(values.repeatWeekdays);
  const [monthly, setMonthly] = useState(values.repeatMonthly);
  const [monthDay] = useState(values.repeatMonthDay);
  const [end, setEnd] = useState(values.repeatEnd);
  const [until, setUntil] = useState(values.recurrenceUntil);
  const [count, setCount] = useState(values.repeatCount);

  const startLocal = parseLocalInput(startsAt);
  const endLocal = parseLocalInput(endsAt);
  const day = startLocal ?? REFERENCE_DAY;
  const raw: RawRepeat = {
    repeat: preset,
    repeatFreq: freq,
    repeatInterval: interval,
    repeatWeekdays: weekdays,
    repeatMonthly: monthly,
    repeatMonthDay: monthDay,
    repeatEnd: end,
    recurrenceUntil: until,
    repeatCount: count,
  };

  const chooseRepeat = (next: string) => {
    setPreset(next);
    // "Custom" starts from something sensible: the weekday of the first date.
    if (next === 'CUSTOM' && weekdays.length === 0) setWeekdays([weekdayOf(day)]);
  };

  const toggleWeekday = (weekday: Weekday, checked: boolean) =>
    setWeekdays((current) =>
      checked ? [...current, weekday] : current.filter((w) => w !== weekday),
    );

  // What the form would save, from the first date typed, and the dates it gives.
  const plan =
    preset !== 'NONE' && startLocal && endLocal
      ? planRepeat(
          raw,
          {
            startsAt: fromLocalDateTime(startLocal, timeZone),
            endsAt: fromLocalDateTime(endLocal, timeZone),
            startLocal,
          },
          timeZone,
        )
      : null;
  const planned =
    plan?.ok && plan.rule && plan.recurrenceUntil ? { ...plan, rule: plan.rule } : null;
  const dates = planned
    ? expandRepeat(
        {
          startsAt: planned.startsAt,
          endsAt: planned.endsAt,
          repeat: planned.rule,
          recurrenceUntil: planned.recurrenceUntil,
        },
        timeZone,
      ).occurrences
    : [];
  const first = planned ? toLocalDateTime(planned.startsAt, timeZone) : null;
  const sentence =
    planned && first && planned.recurrenceUntil
      ? summarizeRepeat(
          {
            rule: planned.rule,
            first,
            until: toLocalDateTime(planned.recurrenceUntil, timeZone),
          },
          tSummary,
          locale,
        )
      : null;
  const moved =
    planned &&
    startLocal &&
    first &&
    (first.day !== startLocal.day ||
      first.month !== startLocal.month ||
      first.year !== startLocal.year);
  // The date typed is not one of the rule's days: the series starts on the first that is, and says so in a notice.
  const startsOn = moved && planned ? planned.startsAt : null;
  const startNow = () => {
    if (!planned) return;
    onStartChange(
      formatLocalInput(planned.startsAt, timeZone),
      formatLocalInput(planned.endsAt, timeZone),
    );
    // The button goes away with the notice: the focus goes back to where the date is typed.
    document.getElementById('startsAt')?.focus();
  };
  const problem: RepeatErrorCode | null =
    plan && !plan.ok ? (Object.values(plan.errors)[0] ?? null) : null;

  const presetLabel = (value: RepeatPreset): string => {
    if (value === 'NONE') return t('none');
    if (value === 'CUSTOM') return t('custom');
    const rule = presetRule(value, day);
    return rule ? describeRepeat(rule, day, tSummary, locale) : value;
  };

  const monthlyOptions = MONTHLY_CHOICES.flatMap((choice) => {
    const pattern = monthlyPatternOf(
      choice,
      day,
      choice === 'day' && monthDay ? Number(monthDay) : day.day,
    );
    if (!pattern) return []; // "the 5th Tuesday" does not exist every month
    return [
      {
        choice,
        label: patternText(
          { freq: freq === 'YEARLY' ? 'YEARLY' : 'MONTHLY', monthly: pattern },
          day,
          tSummary,
          locale,
        ),
      },
    ];
  });

  const intervalNumber = Number(interval) || 1;
  const fieldError = (field: RepeatField) => {
    const message = error(field);
    return message ? (
      <p id={`${field}-error`} className="text-destructive text-small">
        {message}
      </p>
    ) : null;
  };
  const invalid = (field: RepeatField) =>
    error(field) ? { 'aria-invalid': true as const, 'aria-describedby': `${field}-error` } : {};

  return (
    <div className="flex flex-col gap-3 sm:col-span-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="repeat">{t('label')}</Label>
        <NativeSelect
          id="repeat"
          name="repeat"
          value={preset}
          onChange={(event) => chooseRepeat(event.target.value)}
          {...invalid('repeat')}
        >
          {REPEAT_PRESETS.map((value) => (
            <option key={value} value={value}>
              {presetLabel(value)}
            </option>
          ))}
        </NativeSelect>
        {fieldError('repeat')}
      </div>

      {preset === 'CUSTOM' && (
        <fieldset className="flex flex-col gap-3 rounded-lg border p-3">
          <legend className="px-1 text-body-strong">{t('customLegend')}</legend>

          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="repeatInterval">
                {t('every')} <span className="sr-only">({t('intervalLabel')})</span>
              </Label>
              <Input
                id="repeatInterval"
                name="repeatInterval"
                type="number"
                inputMode="numeric"
                min={1}
                max={99}
                value={interval}
                onChange={(event) => setInterval(event.target.value)}
                className="w-20"
                {...invalid('repeatInterval')}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="repeatFreq" className="sr-only">
                {t('unitLabel')}
              </Label>
              <NativeSelect
                id="repeatFreq"
                name="repeatFreq"
                value={freq}
                onChange={(event) => setFreq(event.target.value)}
              >
                {(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const).map((unit) => (
                  <option key={unit} value={unit}>
                    {t(`units.${unit}`, { count: intervalNumber })}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          {fieldError('repeatInterval')}

          {freq === 'WEEKLY' && (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-body">{t('weekdaysLegend')}</legend>
              <div className="flex flex-wrap gap-1.5" {...invalid('repeatWeekdays')}>
                {WEEKDAYS.map((weekday) => (
                  <label key={weekday} className="cursor-pointer">
                    <input
                      type="checkbox"
                      name="repeatWeekdays"
                      value={weekday}
                      checked={weekdays.includes(weekday)}
                      onChange={(event) => toggleWeekday(weekday, event.target.checked)}
                      className="peer sr-only"
                    />
                    <span
                      className={cn(
                        'border-input hover:bg-muted flex h-8 min-w-11 items-center justify-center rounded-lg border px-2 text-body capitalize transition-colors',
                        'peer-checked:border-primary peer-checked:bg-primary/10 peer-checked:font-semibold',
                        'peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50',
                      )}
                    >
                      <span aria-hidden>{weekdayName(weekday, locale, 'short')}</span>
                      <span className="sr-only">{weekdayName(weekday, locale)}</span>
                    </span>
                  </label>
                ))}
              </div>
              {fieldError('repeatWeekdays')}
            </fieldset>
          )}

          {(freq === 'MONTHLY' || freq === 'YEARLY') && (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-body">{t('monthlyLegend')}</legend>
              <input type="hidden" name="repeatMonthDay" value={monthDay} />
              {monthlyOptions.map(({ choice, label }) => (
                <label key={choice} className="flex cursor-pointer items-center gap-2 text-body">
                  <input
                    type="radio"
                    name="repeatMonthly"
                    value={choice}
                    checked={monthly === choice}
                    onChange={() => setMonthly(choice)}
                    className="accent-primary size-4"
                  />
                  <span className="first-letter:uppercase">{label}</span>
                </label>
              ))}
              {fieldError('repeatMonthly')}
            </fieldset>
          )}
        </fieldset>
      )}

      {preset !== 'NONE' && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-body-strong">{t('endLegend')}</legend>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-body">
              <input
                type="radio"
                name="repeatEnd"
                value="until"
                checked={end === 'until'}
                onChange={() => setEnd('until')}
                className="accent-primary size-4"
              />
              {t('endUntil')}
            </label>
            <Input
              id="recurrenceUntil"
              name="recurrenceUntil"
              type="date"
              aria-label={t('untilLabel')}
              value={until}
              disabled={end !== 'until'}
              onChange={(event) => setUntil(event.target.value)}
              className="w-44"
              {...invalid('recurrenceUntil')}
            />
          </div>
          {end === 'until' && fieldError('recurrenceUntil')}
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-body">
              <input
                type="radio"
                name="repeatEnd"
                value="count"
                checked={end === 'count'}
                onChange={() => setEnd('count')}
                className="accent-primary size-4"
              />
              {t('endCount')}
            </label>
            <Input
              id="repeatCount"
              name="repeatCount"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_OCCURRENCES}
              aria-label={t('countLabel')}
              value={count}
              disabled={end !== 'count'}
              onChange={(event) => setCount(event.target.value)}
              className="w-24"
              {...invalid('repeatCount')}
            />
            <span className="text-body">{t('countUnit', { count: Number(count) || 1 })}</span>
          </div>
          {end === 'count' && fieldError('repeatCount')}
          <p className="text-muted-foreground text-small">{t('limit', { max: MAX_OCCURRENCES })}</p>
        </fieldset>
      )}

      {preset !== 'NONE' && startsOn && startLocal && first && (
        <Alert role="status">
          <Info />
          <AlertDescription className="text-foreground flex flex-col items-start gap-2">
            <p>
              {t('startNotice', {
                typed: formatDayMonth(
                  fromLocalDateTime(startLocal, timeZone),
                  locale,
                  timeZone,
                  startLocal.year !== first.year,
                ),
                first: formatWeekdayDayMonth(
                  startsOn,
                  locale,
                  timeZone,
                  startLocal.year !== first.year,
                ),
              })}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={startNow}>
              {t('startNoticeAction', {
                date: formatDayMonth(startsOn, locale, timeZone, startLocal.year !== first.year),
              })}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {preset !== 'NONE' && (sentence || problem) && (
        <div
          role="status"
          aria-live="polite"
          aria-label={t('previewTitle')}
          className="bg-muted/50 flex flex-col gap-1 rounded-lg p-3 text-body"
        >
          {sentence && planned && first ? (
            <>
              <p className="font-semibold">{sentence}</p>
              <p className="text-muted-foreground text-small">
                {t('previewNext', {
                  dates: dates
                    .slice(0, PREVIEW_DATES)
                    .map((date) => formatLongDate(date.start, locale, timeZone))
                    .join(' · '),
                })}{' '}
                · {t('previewTotal', { count: dates.length })}
              </p>
            </>
          ) : (
            problem && <p className="text-muted-foreground text-small">{tErrors(problem)}</p>
          )}
        </div>
      )}
    </div>
  );
}
