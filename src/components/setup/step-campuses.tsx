'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/events/field-styles';
import type { ActionFailure, CampusOption } from '@/app/[locale]/setup/actions';
import type { StepApi } from './api';
import type { DraftView } from '@/lib/setup/draft';
import { searchCampuses } from '@/lib/setup/campus-search';
import { Field, fieldError, useFailureText } from './fields';
import { StepFrame, type StepProps } from './step-frame';

const MAX_SUGGESTIONS = 8;
const DEFAULT_TIMEZONE = 'Europe/Paris';

export function StepCampuses({
  api,
  view,
  onSaved,
  run,
  onNext,
  onBack,
}: StepProps & { api: StepApi; view: DraftView; onSaved: (patch: Partial<DraftView>) => void }) {
  const t = useTranslations('setup.campuses');
  const text = useFailureText();
  // `undefined`: loading; `null`: 42 could not give the list (names are typed by hand).
  const [options, setOptions] = useState<CampusOption[] | null | undefined>(undefined);
  const [allowAll, setAllowAll] = useState(view.step > 3 && view.campuses.length === 0);
  const [selected, setSelected] = useState<string[]>(view.campuses);
  const [main, setMain] = useState(view.mainCampus);
  const [timezone, setTimezone] = useState(view.timezone || DEFAULT_TIMEZONE);
  const [query, setQuery] = useState('');
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void run(api.loadCampuses()).then((result) => {
      if (!cancelled) setOptions(result.ok ? result.campuses : null);
    });
    return () => {
      cancelled = true;
    };
    // The list is asked once, when the step opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const suggestions = useMemo(
    () =>
      options
        ? searchCampuses(
            options.filter((campus) => !selected.includes(campus.name)),
            query,
          ).slice(0, MAX_SUGGESTIONS)
        : [],
    [options, selected, query],
  );

  function chooseTimezoneOf(name: string) {
    const zone = options?.find((campus) => campus.name === name)?.timeZone;
    if (zone) setTimezone(zone);
  }

  function add(name: string) {
    const clean = name.trim();
    if (!clean || selected.includes(clean)) return;
    setSelected([...selected, clean]);
    if (!main) {
      setMain(clean);
      chooseTimezoneOf(clean);
    }
    setQuery('');
  }

  function remove(name: string) {
    const rest = selected.filter((campus) => campus !== name);
    setSelected(rest);
    if (main === name) setMain(rest[0] ?? '');
  }

  function submit() {
    start(async () => {
      const campuses = allowAll ? [] : selected;
      const result = await run(api.saveCampuses({ campuses, mainCampus: main, timezone }));
      if (!result.ok) return setFailure(result);
      setFailure(null);
      onSaved({ campuses, mainCampus: main, timezone });
      onNext();
    });
  }

  const mainChoices = allowAll ? (options?.map((campus) => campus.name) ?? []) : selected;
  const loading = options === undefined;

  return (
    <StepFrame
      title={t('title')}
      description={t('description')}
      onSubmit={submit}
      onBack={onBack}
      pending={pending}
      failure={failure}
      nextDisabled={loading}
    >
      {loading && (
        <p className="text-muted-foreground text-sm" role="status">
          {t('loading')}
        </p>
      )}

      {options === null && <p className="text-muted-foreground text-sm">{t('manualHelp')}</p>}

      {!loading && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={allowAll}
            onChange={(event) => setAllowAll(event.target.checked)}
            className="size-4"
          />
          <span>
            <span className="font-medium">{t('all')}</span>
            <span className="text-muted-foreground block text-xs">{t('allHelp')}</span>
          </span>
        </label>
      )}

      {!loading && !allowAll && (
        <>
          <Field
            id="setup-campus-search"
            label={options ? t('searchLabel') : t('manualLabel')}
            error={fieldError(failure, 'campuses', text)}
          >
            <div className="flex gap-2">
              <Input
                id="setup-campus-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  // Enter adds the typed name (by hand) or the best match; it does not submit the form.
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    add(options ? (suggestions[0]?.name ?? '') : query);
                  }
                }}
                placeholder={options ? t('searchPlaceholder') : undefined}
                autoComplete="off"
              />
              {options === null && (
                <Button type="button" variant="outline" onClick={() => add(query)}>
                  {t('add')}
                </Button>
              )}
            </div>
            {options && query.trim() !== '' && (
              <ul className="border-border mt-1 flex flex-col overflow-hidden rounded-lg border">
                {suggestions.length === 0 && (
                  <li className="text-muted-foreground px-3 py-2 text-sm">{t('noMatch')}</li>
                )}
                {suggestions.map((campus) => (
                  <li key={campus.name}>
                    <button
                      type="button"
                      onClick={() => add(campus.name)}
                      className="hover:bg-muted focus-visible:bg-muted flex w-full items-center justify-between px-3 py-2 text-left text-sm outline-none"
                    >
                      <span>{campus.name}</span>
                      <span className="text-muted-foreground text-xs">{campus.country}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Field>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">{t('selectedTitle')}</p>
            {selected.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('none')}</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {selected.map((name) => (
                  <li
                    key={name}
                    className="bg-muted flex items-center gap-1 rounded-full py-0.5 pr-1 pl-3 text-sm"
                  >
                    {name}
                    <button
                      type="button"
                      onClick={() => remove(name)}
                      aria-label={t('remove', { name })}
                      className="hover:bg-background focus-visible:ring-ring/50 rounded-full p-1 outline-none focus-visible:ring-3"
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {!loading && (
        <>
          <Field
            id="setup-main-campus"
            label={t('mainLabel')}
            hint={t('mainHelp')}
            error={fieldError(failure, 'mainCampus', text)}
          >
            {allowAll && options === null ? (
              // Every campus allowed and no list to choose from: the BDE's own campus is typed.
              <Input
                id="setup-main-campus"
                value={main}
                onChange={(event) => setMain(event.target.value)}
                autoComplete="off"
                aria-invalid={failure?.field === 'mainCampus'}
              />
            ) : (
              <NativeSelect
                id="setup-main-campus"
                value={main}
                onChange={(event) => {
                  setMain(event.target.value);
                  chooseTimezoneOf(event.target.value);
                }}
                aria-invalid={failure?.field === 'mainCampus'}
              >
                <option value="" />
                {mainChoices.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>

          <Field
            id="setup-timezone"
            label={t('timezoneLabel')}
            error={fieldError(failure, 'timezone', text)}
          >
            <Input
              id="setup-timezone"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={failure?.field === 'timezone'}
            />
          </Field>
        </>
      )}
    </StepFrame>
  );
}
