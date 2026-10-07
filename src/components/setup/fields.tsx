'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Label } from '@/components/ui/label';
import type { ActionFailure } from '@/app/[locale]/setup/actions';

/** A label, its control, a hint and the error of the field: wired together for screen readers. */
export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

/** The sentence for the code a failed action answered with. */
export function useFailureText() {
  const t = useTranslations('setup.errors');
  return (failure: Pick<ActionFailure, 'code' | 'detail' | 'retryAfterSeconds'>): string => {
    const key = failure.code;
    return t.has(key)
      ? t(key, { detail: failure.detail ?? '', seconds: failure.retryAfterSeconds ?? 0 })
      : t('unknown');
  };
}

/** Whether `failure` belongs to the field `name` (it says so, or says nothing and there is one field). */
export function fieldError(
  failure: ActionFailure | null,
  name: string,
  text: (failure: ActionFailure) => string,
): string | null {
  return failure && failure.field === name ? text(failure) : null;
}
