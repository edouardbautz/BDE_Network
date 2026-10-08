'use client';

import type { FormEvent, ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ActionFailure } from '@/app/[locale]/setup/actions';
import { useFrameMode } from './api';
import { useFailureText } from './fields';

export interface StepProps {
  /** Runs an action: a "session ended" answer sends the person back to the code. */
  run: <T>(promise: Promise<T>) => Promise<T>;
  /** The step is done: go on. */
  onNext: () => void;
  onBack?: () => void;
}

/** The title, the content and the buttons shared by every step. The form validates with Enter. */
export function StepFrame({
  title,
  description,
  onSubmit,
  onBack,
  pending,
  nextLabel,
  nextDisabled,
  failure,
  children,
}: {
  title: string;
  description: string;
  onSubmit: () => void;
  onBack?: () => void;
  pending: boolean;
  nextLabel?: string;
  nextDisabled?: boolean;
  /** An error that belongs to no field. */
  failure?: ActionFailure | null;
  children: ReactNode;
}) {
  const t = useTranslations('setup.nav');
  const mode = useFrameMode();
  const failureText = useFailureText();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!pending) onSubmit();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>

      <div className="flex flex-col gap-4">{children}</div>

      {failure && !failure.field && (
        <p role="alert" className="text-destructive text-sm">
          {failureText(failure)}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        {onBack && mode === 'wizard' ? (
          <Button type="button" variant="ghost" onClick={onBack} disabled={pending}>
            <ArrowLeft data-icon="inline-start" />
            {t('back')}
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={pending || nextDisabled}>
          {pending ? t('saving') : (nextLabel ?? (mode === 'section' ? t('save') : t('next')))}
        </Button>
      </div>
    </form>
  );
}
