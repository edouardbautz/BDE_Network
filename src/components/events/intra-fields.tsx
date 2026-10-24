'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Send, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  INTRA_AUDIENCES,
  INTRA_KEYWORDS_LIMIT,
  INTRA_KEYWORD_MAX_LENGTH,
  INTRA_LOGIN_MAX_LENGTH,
  groupedKinds,
  normalizeKeyword,
  type IntraField,
  type RawIntra,
} from '@/lib/events/intra';
import { cn } from '@/lib/utils';
import { NativeSelect } from './field-styles';

/** A choice among a few, drawn as pills: radio buttons underneath, so the keyboard and a screen reader get the group. */
function Choices({
  name,
  legend,
  options,
  value,
  error,
}: {
  name: IntraField;
  legend: string;
  options: readonly { value: string; label: string }[];
  value: string;
  error: string | null;
}) {
  return (
    <fieldset
      className="flex flex-col gap-1.5"
      aria-describedby={error ? `${name}-error` : undefined}
    >
      <legend className="mb-1.5 text-body-strong">
        {legend}
        <span aria-hidden className="text-muted-foreground">
          {' '}
          *
        </span>
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option, index) => (
          <label key={option.value} className="cursor-pointer">
            <input
              type="radio"
              name={name}
              value={option.value}
              defaultChecked={value === option.value}
              required={index === 0}
              aria-invalid={error && index === 0 ? true : undefined}
              className="peer sr-only"
            />
            <span className="bg-surface-2 hover:bg-surface-3 text-body-strong peer-checked:bg-accent-soft peer-checked:text-accent-ink inline-flex min-h-11 items-center rounded-pill px-4 peer-focus-visible:outline-3 peer-focus-visible:outline-solid peer-focus-visible:outline-accent-ink peer-focus-visible:outline-offset-2">
              {option.label}
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p id={`${name}-error`} className="text-destructive text-small">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** The keywords as removable chips, added with Enter or a comma (or by leaving the field); one hidden input each. */
function KeywordsField({
  initial,
  error,
  onChange,
}: {
  initial: readonly string[];
  error: string | null;
  onChange: () => void;
}) {
  const t = useTranslations('events.form.intra');
  const [list, setList] = useState<string[]>([...initial]);
  const [draft, setDraft] = useState('');
  const first = useRef(true);

  // The form re-checks itself when what it holds changes (hidden inputs raise no event of their own).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    onChange();
  }, [list]); // eslint-disable-line react-hooks/exhaustive-deps

  function add(text: string) {
    const pieces = text.split(/[,\n]/).map(normalizeKeyword).filter(Boolean);
    if (pieces.length === 0) return;
    setList((current) => {
      const next = [...current];
      for (const piece of pieces) {
        const known = next.some((word) => word.toLocaleLowerCase() === piece.toLocaleLowerCase());
        if (!known && next.length < INTRA_KEYWORDS_LIMIT) next.push(piece);
      }
      return next;
    });
    setDraft('');
  }

  return (
    <div className="flex flex-col gap-2">
      {list.map((word) => (
        <input key={word} type="hidden" name="intraKeywords" value={word} />
      ))}
      {list.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('keywords')}>
          {list.map((word) => (
            <li
              key={word}
              className="bg-surface-2 text-body-strong inline-flex items-center gap-1 rounded-pill py-0.5 pr-1 pl-3"
            >
              {word}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('keywordRemove', { word })}
                onClick={() => setList((current) => current.filter((w) => w !== word))}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Input
        id="intraKeywords"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            add(draft);
          } else if (event.key === 'Backspace' && draft === '' && list.length > 0) {
            setList((current) => current.slice(0, -1));
          }
        }}
        onBlur={() => add(draft)}
        onPaste={(event) => {
          const text = event.clipboardData.getData('text');
          if (/[,\n]/.test(text)) {
            event.preventDefault();
            add(draft + text);
          }
        }}
        maxLength={INTRA_KEYWORD_MAX_LENGTH * 4}
        disabled={list.length >= INTRA_KEYWORDS_LIMIT}
        placeholder={t('keywordsPlaceholder')}
        autoComplete="off"
        aria-required
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'intraKeywords-error' : 'intraKeywords-help'}
      />
      <p id="intraKeywords-help" className="text-muted-foreground text-small">
        {t('keywordsHelp', { max: INTRA_KEYWORDS_LIMIT })}
      </p>
      {error && (
        <p id="intraKeywords-error" className="text-destructive text-small">
          {error}
        </p>
      )}
    </div>
  );
}

function Labelled({
  htmlFor,
  label,
  error,
  hint,
  children,
}: {
  htmlFor: string;
  label: string;
  error: string | null;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>
        {label}
        <span aria-hidden className="text-muted-foreground -ml-1">
          *
        </span>
      </Label>
      {children}
      {hint && !error && <p className="text-muted-foreground text-small">{hint}</p>}
      {error && (
        <p id={`${htmlFor}-error`} className="text-destructive text-small">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * What the school's staff copies into the intra's event form (see `lib/events/intra.ts`), asked once the platform publishes
 * on the intra. They belong to the whole series, so a person editing one date of a series is told they are saved with
 * "this date and the following".
 */
export function IntraFields({
  values,
  error,
  onChange,
  legacy,
  inSeries,
}: {
  values: RawIntra;
  error: (field: IntraField) => string | null;
  onChange: () => void;
  /** An event written before these fields: they are asked at this edit, and before it can be confirmed. */
  legacy: boolean;
  inSeries: boolean;
}) {
  const t = useTranslations('events.form.intra');
  const kinds = groupedKinds();
  const errorOf = (name: IntraField) => error(name);
  const props = (name: IntraField) => ({
    'aria-required': true as const,
    'aria-invalid': errorOf(name) ? (true as const) : undefined,
    'aria-describedby': errorOf(name) ? `${name}-error` : undefined,
  });

  return (
    <section aria-labelledby="intra-title" className="flex flex-col gap-5 sm:col-span-2">
      <div className="flex items-start gap-3">
        <div className="bg-accent-soft text-accent-ink flex size-9 shrink-0 items-center justify-center rounded-sm">
          <Send className="size-4" aria-hidden="true" />
        </div>
        <div>
          <h2 id="intra-title" className="text-card-title">
            {t('title')}
          </h2>
          <p className="text-muted-foreground text-small">{t('description')}</p>
        </div>
      </div>

      {legacy && (
        <Alert>
          <AlertDescription>{t('legacy')}</AlertDescription>
        </Alert>
      )}
      {inSeries && <p className="text-muted-foreground text-small">{t('seriesHint')}</p>}

      <div className="grid gap-5 sm:grid-cols-2">
        <Labelled
          htmlFor="intraOrganizerLogin"
          label={t('organizer')}
          error={errorOf('intraOrganizerLogin')}
          hint={t('organizerHelp')}
        >
          <Input
            id="intraOrganizerLogin"
            name="intraOrganizerLogin"
            defaultValue={values.intraOrganizerLogin}
            maxLength={INTRA_LOGIN_MAX_LENGTH}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            {...props('intraOrganizerLogin')}
          />
        </Labelled>

        <Choices
          name="intraAudience"
          legend={t('audience')}
          options={INTRA_AUDIENCES.map((value) => ({ value, label: t(`audiences.${value}`) }))}
          value={values.intraAudience}
          error={errorOf('intraAudience')}
        />

        <Labelled htmlFor="intraMaxPeople" label={t('maxPeople')} error={errorOf('intraMaxPeople')}>
          <Input
            id="intraMaxPeople"
            name="intraMaxPeople"
            type="number"
            inputMode="numeric"
            min={1}
            defaultValue={values.intraMaxPeople}
            {...props('intraMaxPeople')}
          />
        </Labelled>

        <Choices
          name="intraWaitingList"
          legend={t('waitingList')}
          options={[
            { value: 'yes', label: t('yes') },
            { value: 'no', label: t('no') },
          ]}
          value={values.intraWaitingList}
          error={errorOf('intraWaitingList')}
        />

        <Labelled htmlFor="intraKind" label={t('kind')} error={errorOf('intraKind')}>
          <NativeSelect
            id="intraKind"
            name="intraKind"
            defaultValue={values.intraKind}
            {...props('intraKind')}
          >
            <option value="">{t('kindPlaceholder')}</option>
            {kinds.map(({ group, kinds: items }) =>
              group === null ? (
                items.map((kind) => (
                  <option key={kind.value} value={kind.value}>
                    {kind.label}
                  </option>
                ))
              ) : (
                <optgroup key={group} label={group}>
                  {items.map((kind) => (
                    <option key={kind.value} value={kind.value}>
                      {kind.label}
                    </option>
                  ))}
                </optgroup>
              ),
            )}
          </NativeSelect>
        </Labelled>

        <Labelled
          htmlFor="intraUnsubscribeHours"
          label={t('unsubscribe')}
          error={errorOf('intraUnsubscribeHours')}
          hint={t('unsubscribeHelp')}
        >
          <Input
            id="intraUnsubscribeHours"
            name="intraUnsubscribeHours"
            type="number"
            inputMode="numeric"
            min={0}
            defaultValue={values.intraUnsubscribeHours}
            className={cn('w-40')}
            {...props('intraUnsubscribeHours')}
          />
        </Labelled>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="intraKeywords">
            {t('keywords')}
            <span aria-hidden className="text-muted-foreground -ml-1">
              *
            </span>
          </Label>
          <KeywordsField
            initial={values.intraKeywords}
            error={errorOf('intraKeywords')}
            onChange={onChange}
          />
        </div>
      </div>
    </section>
  );
}
