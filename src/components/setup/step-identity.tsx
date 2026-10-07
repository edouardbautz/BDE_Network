'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { saveIdentity, type ActionFailure } from '@/app/[locale]/setup/actions';
import type { DraftView } from '@/lib/setup/draft';
import { NativeSelect } from '@/components/events/field-styles';
import { Field, fieldError, useFailureText } from './fields';
import { StepFrame, type StepProps } from './step-frame';

/** A few colors to start from; the picker and the text field accept any. */
const PRESETS = ['#0f766e', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a'];

export function StepIdentity({
  view,
  onSaved,
  run,
  onNext,
}: StepProps & { view: DraftView; onSaved: (patch: Partial<DraftView>) => void }) {
  const t = useTranslations('setup.identity');
  const text = useFailureText();
  const [name, setName] = useState(view.name);
  const [color, setColor] = useState(view.accentColor);
  const [locale, setLocale] = useState(view.messageLocale);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const result = await run(saveIdentity({ name, accentColor: color, messageLocale: locale }));
      if (!result.ok) return setFailure(result);
      setFailure(null);
      onSaved({ name: name.trim(), accentColor: color, messageLocale: locale });
      onNext();
    });
  }

  const colorValid = /^#[0-9a-f]{6}$/i.test(color);

  return (
    <StepFrame
      title={t('title')}
      description={t('description')}
      onSubmit={submit}
      pending={pending}
      failure={failure}
    >
      <Field id="setup-name" label={t('nameLabel')} error={fieldError(failure, 'name', text)}>
        <Input
          id="setup-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('namePlaceholder')}
          maxLength={60}
          autoFocus
          autoComplete="off"
          aria-invalid={failure?.field === 'name'}
          aria-describedby={failure?.field === 'name' ? 'setup-name-error' : undefined}
        />
      </Field>

      <Field
        id="setup-color"
        label={t('accentLabel')}
        hint={t('accentHelp')}
        error={fieldError(failure, 'accentColor', text)}
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="color"
            aria-label={t('accentLabel')}
            value={colorValid ? color : '#0f766e'}
            onChange={(event) => setColor(event.target.value)}
            className="border-input size-8 shrink-0 cursor-pointer rounded-lg border bg-transparent p-0.5"
          />
          <Input
            id="setup-color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            className="w-28 font-mono"
            maxLength={7}
            autoComplete="off"
            aria-invalid={failure?.field === 'accentColor'}
          />
          <div className="flex gap-1.5" role="group" aria-label={t('accentLabel')}>
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-label={preset}
                aria-pressed={color.toLowerCase() === preset}
                onClick={() => setColor(preset)}
                style={{ backgroundColor: preset }}
                className="focus-visible:ring-ring/50 size-6 rounded-full border border-black/10 outline-none focus-visible:ring-3 aria-pressed:ring-2 aria-pressed:ring-offset-2 aria-pressed:ring-offset-card aria-pressed:ring-foreground"
              />
            ))}
          </div>
        </div>
        {colorValid && (
          <p className="text-muted-foreground flex items-center gap-2 text-xs">
            {t('preview')}
            <span
              className="inline-block rounded-lg px-3 py-1 text-sm font-medium text-white"
              style={{ backgroundColor: color }}
              aria-hidden="true"
            >
              {name.trim() || t('namePlaceholder')}
            </span>
          </p>
        )}
      </Field>

      <Field id="setup-locale" label={t('localeLabel')} hint={t('localeHelp')}>
        <NativeSelect
          id="setup-locale"
          value={locale}
          onChange={(event) => setLocale(event.target.value === 'en' ? 'en' : 'fr')}
        >
          <option value="fr">{t('fr')}</option>
          <option value="en">{t('en')}</option>
        </NativeSelect>
      </Field>
    </StepFrame>
  );
}
