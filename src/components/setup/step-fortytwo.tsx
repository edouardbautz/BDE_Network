'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, ExternalLink } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  skipFortyTwoVerification,
  verifyFortyTwo,
  type ActionFailure,
} from '@/app/[locale]/setup/actions';
import type { DraftView } from '@/lib/setup/draft';
import { redirectUrl } from '@/lib/setup/validate';
import { CopyField } from '@/components/events/copy-field';
import { Field, fieldError, useFailureText } from './fields';
import { StepFrame, type StepProps } from './step-frame';

const INTRA_APPS = 'https://profile.intra.42.fr/oauth/applications';

export function StepFortyTwo({
  view,
  onSaved,
  run,
  onNext,
  onBack,
}: StepProps & { view: DraftView; onSaved: (patch: Partial<DraftView>) => void }) {
  const t = useTranslations('setup.fortyTwo');
  const text = useFailureText();
  const [clientId, setClientId] = useState(view.clientId);
  const [clientSecret, setClientSecret] = useState('');
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, start] = useTransition();

  const credentials = { clientId, clientSecret };

  function verify() {
    start(async () => {
      const result = await run(verifyFortyTwo(credentials));
      if (!result.ok) return setFailure(result);
      setFailure(null);
      onSaved({
        clientId: clientId.trim(),
        hasClientSecret: true,
        credentialsVerified: true,
        credentialsSkipped: false,
      });
      onNext();
    });
  }

  function skip() {
    start(async () => {
      const result = await run(skipFortyTwoVerification(credentials));
      if (!result.ok) return setFailure(result);
      setFailure(null);
      onSaved({
        clientId: clientId.trim(),
        hasClientSecret: true,
        credentialsVerified: false,
        credentialsSkipped: true,
      });
      onNext();
    });
  }

  // 42 could not be asked (or answered with something unexpected): the person may go on by hand.
  const unreachable = failure?.code === 'network' || failure?.code === 'rateLimited';

  return (
    <StepFrame
      title={t('title')}
      description={t('description')}
      onSubmit={verify}
      onBack={onBack}
      pending={pending}
      nextLabel={pending ? t('verifying') : t('verify')}
      failure={failure && !unreachable ? failure : null}
    >
      <div className="bg-muted/50 flex flex-col gap-3 rounded-lg p-3">
        <p className="text-sm font-medium">{t('stepsTitle')}</p>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
          <li>{t('step1')}</li>
          <li>{t('step2')}</li>
          <li>{t('step3')}</li>
          <li>{t('step4')}</li>
          <li>{t('step5')}</li>
        </ol>
        <a
          href={INTRA_APPS}
          target="_blank"
          rel="noreferrer noopener"
          className={buttonVariants({ variant: 'outline', className: 'w-fit' })}
        >
          {t('openIntra')}
          <ExternalLink data-icon="inline-end" />
        </a>
      </div>

      <Field id="setup-redirect" label={t('redirectLabel')}>
        <CopyField
          id="setup-redirect"
          value={redirectUrl(view.addressUrl)}
          label={t('redirectCopy')}
        />
      </Field>

      <Field id="setup-uid" label={t('uidLabel')} error={fieldError(failure, 'clientId', text)}>
        <Input
          id="setup-uid"
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-xs"
          aria-invalid={failure?.field === 'clientId'}
        />
      </Field>

      <Field
        id="setup-secret"
        label={t('secretLabel')}
        hint={view.hasClientSecret ? t('secretKept') : undefined}
        error={fieldError(failure, 'clientSecret', text)}
      >
        <Input
          id="setup-secret"
          type="password"
          value={clientSecret}
          onChange={(event) => setClientSecret(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-xs"
          aria-invalid={failure?.field === 'clientSecret'}
          aria-describedby={view.hasClientSecret ? 'setup-secret-hint' : undefined}
        />
      </Field>

      {view.credentialsVerified && !failure && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
          <CheckCircle2 className="size-4 text-green-600" aria-hidden="true" />
          {t('verified')}
        </p>
      )}

      {unreachable && failure && (
        <div role="alert" className="bg-destructive/10 flex flex-col gap-2 rounded-lg p-3 text-sm">
          <p className="font-medium">{t('unreachableTitle')}</p>
          <p>{text(failure)}</p>
          <p>{t('unreachableBody')}</p>
          <Button
            type="button"
            variant="outline"
            onClick={skip}
            disabled={pending}
            className="w-fit"
          >
            {t('skip')}
          </Button>
        </div>
      )}
    </StepFrame>
  );
}
