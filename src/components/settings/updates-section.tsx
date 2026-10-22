'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { BellRing } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useFailureText } from '@/components/setup/fields';
import { saveUpdates } from '@/app/[locale]/(app)/settings/actions';
import type { ActionFailure } from '@/app/[locale]/setup/actions';

/**
 * Whether the owners are told when a newer version of the platform is published. It asks GitHub for the project's
 * latest release (nothing about the BDE goes with the request); turned off, the platform asks nobody.
 */
export function UpdatesSection({ check }: { check: boolean }) {
  const t = useTranslations('settings.updates');
  const tSaved = useTranslations('settings');
  const tNav = useTranslations('setup.nav');
  const text = useFailureText();
  const [enabled, setEnabled] = useState(check);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, start] = useTransition();

  function save() {
    start(async () => {
      const result = await saveUpdates({ check: enabled });
      if (!result.ok) return setFailure(result);
      setFailure(null);
      toast.success(tSaved('saved'));
    });
  }

  return (
    <section aria-labelledby="settings-updates" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 id="settings-updates" className="text-title-3">
          {t('title')}
        </h2>
        <p className="text-muted-foreground text-body">{t('description')}</p>
      </div>

      <form
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending) save();
        }}
        noValidate
      >
        <div className="border-border flex items-start gap-3 rounded-lg border p-3">
          <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-full">
            <BellRing className="size-4" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <p id="settings-updates-title" className="text-body-strong">
              {t('checkTitle')}
            </p>
            <p className="text-muted-foreground text-body">{t('checkBody')}</p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            aria-labelledby="settings-updates-title"
          />
        </div>

        {failure && (
          <p role="alert" className="text-destructive text-body">
            {text(failure)}
          </p>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? tNav('saving') : tNav('save')}
          </Button>
        </div>
      </form>
    </section>
  );
}
