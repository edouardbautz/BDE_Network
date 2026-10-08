'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import * as settingsActions from '@/app/[locale]/(app)/settings/actions';
import { FrameModeContext, type StepApi } from '@/components/setup/api';
import { StepAddress } from '@/components/setup/step-address';
import { StepCampuses } from '@/components/setup/step-campuses';
import { StepFortyTwo } from '@/components/setup/step-fortytwo';
import { StepIdentity } from '@/components/setup/step-identity';
import { StepModules } from '@/components/setup/step-modules';
import { StepNotifications } from '@/components/setup/step-notifications';
import type { DraftView } from '@/lib/setup/draft';
import type { SettingsExtras } from '@/lib/settings/view';
import { EventsSection } from './events-section';
import { LogoSection } from './logo-section';
import { OwnersSection } from './owners-section';

const api: StepApi = settingsActions;

/** The forms are the installer's, in "section" mode: their own Save button, nothing takes the focus. */
const noop = () => undefined;
const run = <T,>(promise: Promise<T>): Promise<T> => promise;

function Panel({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/**
 * Every section of the settings page. Each saves on its own and says so (the page reloads its data behind): there
 * is no big "save" at the bottom that could overwrite a section somebody else has just changed.
 */
export function SettingsPanels({
  view,
  extras,
  actorLogin,
}: {
  view: DraftView;
  extras: SettingsExtras;
  actorLogin: string;
}) {
  const t = useTranslations('settings');
  const saved = () => void toast.success(t('saved'));
  const common = { api, view, run, onNext: saved, onSaved: noop };

  return (
    <FrameModeContext.Provider value="section">
      <div className="flex flex-col gap-6">
        <Panel>
          <StepIdentity {...common} />
        </Panel>
        <Panel>
          <LogoSection logoPath={extras.logo.path} custom={extras.logo.custom} />
        </Panel>
        <Panel>
          <StepAddress {...common} />
        </Panel>
        <Panel>
          <StepFortyTwo {...common} />
        </Panel>
        <Panel>
          <StepCampuses {...common} />
        </Panel>
        <Panel>
          <OwnersSection owners={view.owners} actorLogin={actorLogin} />
        </Panel>
        <Panel>
          <StepModules {...common} />
        </Panel>
        {extras.events && (
          <Panel>
            {/* Remounted when what is saved changes, so that the form shows what the server holds (new keys...). */}
            <EventsSection key={JSON.stringify(extras.events)} settings={extras.events} />
          </Panel>
        )}
        <Panel>
          <StepNotifications {...common} />
        </Panel>
      </div>
    </FrameModeContext.Provider>
  );
}
