'use client';

import { DEFAULT_ACCENT } from '@/config/schema';
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import type { ActionFailure } from '@/app/[locale]/setup/actions';
import { useFrameMode, type StepApi } from './api';
import type { DraftView } from '@/lib/setup/draft';
import { NativeSelect } from '@/components/events/field-styles';
import { Field, fieldError, useFailureText } from './fields';
import { AccentPreview } from './accent-preview';
import { StepFrame, type StepProps } from './step-frame';

/** A few colors to start from; the picker and the text field accept any. */
// The accents of the specification's checklist first, then two more: choices offered to a person, not styling.
const PRESETS = [DEFAULT_ACCENT, '#E4572E', '#1E9E6A', '#F0B429', '#7c3aed', '#db2777'];

export function StepIdentity({
  api,
  view,
  onSaved,
  run,
  onNext,
}: StepProps & { api: StepApi; view: DraftView; onSaved: (patch: Partial<DraftView>) => void }) {
  const mode = useFrameMode();
  const t = useTranslations('setup.identity');
  const text = useFailureText();
  const [name, setName] = useState(view.name);
  const [color, setColor] = useState(view.accentColor);
  const [locale, setLocale] = useState(view.messageLocale);
  const [contact, setContact] = useState(view.contactEmail);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const result = await run(
        api.saveIdentity({
          name,
          accentColor: color,
          messageLocale: locale,
          contactEmail: contact,
        }),
      );
      if (!result.ok) return setFailure(result);
      setFailure(null);
      onSaved({
        name: name.trim(),
        accentColor: color,
        messageLocale: locale,
        contactEmail: contact.trim(),
      });
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
          autoFocus={mode === 'wizard'}
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
            value={colorValid ? color : DEFAULT_ACCENT}
            onChange={(event) => setColor(event.target.value)}
            className="size-9 shrink-0 cursor-pointer rounded-pill bg-surface-2 p-1"
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
                aria-pressed={color.toLowerCase() === preset.toLowerCase()}
                onClick={() => setColor(preset)}
                style={{ backgroundColor: preset }}
                className="size-7 rounded-pill border border-black/10 aria-pressed:ring-2 aria-pressed:ring-offset-2 aria-pressed:ring-offset-surface aria-pressed:ring-ink"
              />
            ))}
          </div>
        </div>
        {colorValid && <AccentPreview color={color} name={name} />}
      </Field>

      <Field
        id="setup-contact"
        label={t('contactLabel')}
        hint={t('contactHelp')}
        error={fieldError(failure, 'contactEmail', text)}
      >
        <Input
          id="setup-contact"
          type="email"
          value={contact}
          onChange={(event) => setContact(event.target.value)}
          placeholder={t('contactPlaceholder')}
          maxLength={120}
          autoComplete="off"
          aria-invalid={failure?.field === 'contactEmail'}
          aria-describedby={failure?.field === 'contactEmail' ? 'setup-contact-error' : undefined}
        />
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
