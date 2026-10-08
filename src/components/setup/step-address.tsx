'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { TriangleAlert } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { ActionFailure } from '@/app/[locale]/setup/actions';
import { useFrameMode, type StepApi } from './api';
import type { DraftView } from '@/lib/setup/draft';
import { addressNotice, validateAddress } from '@/lib/setup/validate';
import { Field, fieldError, useFailureText } from './fields';
import { StepFrame, type StepProps } from './step-frame';

export function StepAddress({
  api,
  view,
  onSaved,
  run,
  onNext,
  onBack,
}: StepProps & { api: StepApi; view: DraftView; onSaved: (patch: Partial<DraftView>) => void }) {
  const mode = useFrameMode();
  const t = useTranslations('setup.address');
  const text = useFailureText();
  const [address, setAddress] = useState(view.addressUrl);
  const [accepted, setAccepted] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, start] = useTransition();
  // The address this browser is on: known after the first render only (the server cannot know it).
  const [browserOrigin, setBrowserOrigin] = useState<string | null>(null);
  useEffect(() => setBrowserOrigin(window.location.origin), []);

  // The same check as the server's, to warn at once; the server runs it again.
  const checked = validateAddress(address);
  const insecure = checked.ok && checked.value.insecureDomain;
  // Only a warning: an installation from another computer is legitimate. 42 sends people back to the saved
  // address, so a browser on another one will not be able to sign in.
  const notice =
    checked.ok && browserOrigin ? addressNotice(checked.value.url, browserOrigin) : null;

  function submit() {
    start(async () => {
      const result = await run(api.saveAddress({ address, acceptInsecure: accepted }));
      if (!result.ok) return setFailure(result);
      setFailure(null);
      onSaved({ addressUrl: result.url });
      onNext();
    });
  }

  return (
    <StepFrame
      title={t('title')}
      description={t('description')}
      onSubmit={submit}
      onBack={onBack}
      pending={pending}
      failure={failure}
    >
      <Field
        id="setup-address"
        label={t('label')}
        hint={t('help')}
        error={fieldError(failure, 'address', text)}
      >
        <Input
          id="setup-address"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          inputMode="url"
          autoComplete="off"
          autoFocus={mode === 'wizard'}
          aria-invalid={failure?.field === 'address'}
          aria-describedby="setup-address-hint"
        />
      </Field>

      {notice && browserOrigin && checked.ok && (
        <div role="status" className="bg-muted flex flex-col gap-2 rounded-lg p-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
            {t(notice === 'unspecified' ? 'unspecifiedTitle' : 'differsTitle')}
          </p>
          <p>
            {notice === 'unspecified'
              ? t('unspecifiedBody')
              : t('differsBody', { current: browserOrigin, typed: checked.value.url })}
          </p>
        </div>
      )}

      {insecure && (
        <div role="alert" className="bg-destructive/10 flex flex-col gap-2 rounded-lg p-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <TriangleAlert className="text-destructive size-4 shrink-0" aria-hidden="true" />
            {t('insecureTitle')}
          </p>
          <p>{t('insecureBody')}</p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(event) => setAccepted(event.target.checked)}
              className="size-4"
            />
            {t('insecureAccept')}
          </label>
        </div>
      )}
    </StepFrame>
  );
}
