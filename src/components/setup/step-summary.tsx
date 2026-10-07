'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { finishInstallation, type ActionFailure } from '@/app/[locale]/setup/actions';
import type { DraftView } from '@/lib/setup/draft';
import { StepFrame, type StepProps } from './step-frame';

export function StepSummary({ view, run, onNext, onBack }: StepProps & { view: DraftView }) {
  const t = useTranslations('setup.summary');
  const tNotifications = useTranslations('setup.notifications');
  const tIdentity = useTranslations('setup.identity');
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const result = await run(finishInstallation());
      if (!result.ok) return setFailure(result);
      onNext();
    });
  }

  const rows: Array<[string, React.ReactNode]> = [
    [t('name'), view.name],
    [
      t('color'),
      <span key="color" className="inline-flex items-center gap-2">
        <span
          className="inline-block size-4 rounded-full border border-black/10"
          style={{ backgroundColor: view.accentColor }}
          aria-hidden="true"
        />
        <span className="font-mono">{view.accentColor}</span>
      </span>,
    ],
    [t('locale'), tIdentity(view.messageLocale)],
    [t('address'), view.addressUrl],
    [
      t('clientId'),
      <span key="uid" className="font-mono text-xs">
        {view.clientId}
      </span>,
    ],
    [
      t('clientSecret'),
      `${t('secretMasked')} · ${view.credentialsVerified ? t('verified') : t('unverified')}`,
    ],
    [t('campuses'), view.campuses.length > 0 ? view.campuses.join(', ') : t('allCampuses')],
    [t('mainCampus'), view.mainCampus],
    [t('timezone'), view.timezone],
    [t('owners'), view.owners.join(', ')],
    [t('events'), view.events ? t('on') : t('off')],
    [t('notifications'), tNotifications(view.notifications.mode)],
  ];

  return (
    <StepFrame
      title={t('title')}
      description={t('description')}
      onSubmit={submit}
      onBack={onBack}
      pending={pending}
      nextLabel={pending ? t('installing') : t('install')}
      failure={failure}
    >
      <dl className="border-border divide-border divide-y rounded-lg border text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-1 px-3 py-2 sm:grid-cols-[10rem_1fr] sm:gap-4">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </StepFrame>
  );
}
