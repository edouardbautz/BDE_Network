'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarDays } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import type { ActionFailure } from '@/app/[locale]/setup/actions';
import type { StepApi } from './api';
import type { DraftView } from '@/lib/setup/draft';
import { StepFrame, type StepProps } from './step-frame';

export function StepModules({
  api,
  view,
  onSaved,
  run,
  onNext,
  onBack,
}: StepProps & { api: StepApi; view: DraftView; onSaved: (patch: Partial<DraftView>) => void }) {
  const t = useTranslations('setup.modules');
  const [events, setEvents] = useState(view.events);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const result = await run(api.saveModules({ events }));
      if (!result.ok) return setFailure(result);
      setFailure(null);
      onSaved({ events });
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
      <div className="border-border flex items-start gap-3 rounded-lg border p-3">
        <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-full">
          <CalendarDays className="size-4" aria-hidden="true" />
        </div>
        <div className="flex-1">
          <p id="setup-events-title" className="text-sm font-medium">
            {t('eventsTitle')}
          </p>
          <p className="text-muted-foreground text-sm">{t('eventsBody')}</p>
        </div>
        <Switch checked={events} onCheckedChange={setEvents} aria-labelledby="setup-events-title" />
      </div>
    </StepFrame>
  );
}
