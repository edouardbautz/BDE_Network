'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { DraftView } from '@/lib/setup/draft';
import { Done } from './done';
import { StepAddress } from './step-address';
import { StepCampuses } from './step-campuses';
import { StepFortyTwo } from './step-fortytwo';
import { StepIdentity } from './step-identity';
import { StepModules } from './step-modules';
import { StepNotifications } from './step-notifications';
import { StepOwners } from './step-owners';
import { StepSummary } from './step-summary';

const LAST_STEP = 7;

/**
 * The installer: one step at a time, a progress bar, and a way back. Each step saves what it collected on the
 * server (the answers are kept there, never in the browser), so reloading the page loses nothing.
 */
export function SetupWizard({
  initial,
  locale,
  brand,
  switcher,
}: {
  initial: DraftView;
  locale: string;
  /** The name of the product, always shown. */
  brand: ReactNode;
  /** The language switch: it points at the installer, which is gone once the platform is installed. */
  switcher: ReactNode;
}) {
  const t = useTranslations('setup.progress');
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [current, setCurrent] = useState(Math.min(initial.step, LAST_STEP));
  const [done, setDone] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  // Moves the focus to the new step, so a screen reader announces it (not on the first display).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    frame.current?.focus();
  }, [current, done]);

  /** Runs a server action; "the session ended" brings the person back to the code. */
  const run = useCallback(
    async <T,>(promise: Promise<T>): Promise<T> => {
      const result = await promise;
      if ((result as { code?: unknown } | null)?.code === 'session') router.refresh();
      return result;
    },
    [router],
  );

  const save = (patch: Partial<DraftView>) =>
    setView((previous) => ({ ...previous, ...patch, step: Math.max(previous.step, current + 1) }));
  const next = () => setCurrent((step) => Math.min(step + 1, LAST_STEP));
  const back = current > 0 ? () => setCurrent((step) => step - 1) : undefined;
  const common = { run, onNext: next, onBack: back };

  const names = t.raw('steps') as string[];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        {brand}
        {!done && switcher}
      </header>

      {!done && (
        <div className="flex flex-col gap-2">
          <div
            role="progressbar"
            aria-label={t('label')}
            aria-valuemin={1}
            aria-valuemax={names.length}
            aria-valuenow={current + 1}
            aria-valuetext={`${t('step', { current: current + 1, total: names.length })} · ${names[current] ?? ''}`}
            className="flex gap-1.5"
          >
            {names.map((name, index) => (
              <div
                key={name}
                className={`h-1.5 flex-1 rounded-full ${index <= current ? 'bg-primary' : 'bg-muted'}`}
              />
            ))}
          </div>
          <p className="text-muted-foreground text-xs" aria-hidden="true">
            {t('step', { current: current + 1, total: names.length })} · {names[current]}
          </p>
        </div>
      )}

      <div ref={frame} tabIndex={-1} className="outline-none">
        {done ? (
          <Done locale={locale} />
        ) : current === 0 ? (
          <StepIdentity {...common} onBack={undefined} view={view} onSaved={save} />
        ) : current === 1 ? (
          <StepAddress {...common} view={view} onSaved={save} />
        ) : current === 2 ? (
          <StepFortyTwo {...common} view={view} onSaved={save} />
        ) : current === 3 ? (
          <StepCampuses {...common} view={view} onSaved={save} />
        ) : current === 4 ? (
          <StepOwners {...common} view={view} onSaved={save} />
        ) : current === 5 ? (
          <StepModules {...common} view={view} onSaved={save} />
        ) : current === 6 ? (
          <StepNotifications {...common} view={view} onSaved={save} />
        ) : (
          <StepSummary {...common} view={view} onNext={() => setDone(true)} />
        )}
      </div>
    </div>
  );
}
