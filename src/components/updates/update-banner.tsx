'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CircleArrowUp, ExternalLink } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CopyField } from '@/components/events/copy-field';
import type { UpdateStatus } from '@/lib/updates/status';

/** The version the owner chose to stop hearing about. A newer one speaks again. */
const DISMISSED_KEY = 'bde-update-dismissed';

function dismissedVersion(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null; // private window, storage blocked: the banner just comes back
  }
}

function rememberDismissed(version: string): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, version);
  } catch {
    /* nothing to do: it comes back at the next visit */
  }
}

type Available = Extract<UpdateStatus, { state: 'available' }>;

/**
 * "A new version is available", for the owners. It asks the platform's own route AFTER the page is shown, so a slow
 * or unreachable GitHub never delays a page (the route answers from a cache and gives up after three seconds). The
 * two commands are the whole update; the platform makes a copy of its database by itself before changing it.
 * `enabled` is `updates.check` of the settings: turned off, nothing is asked and nothing is shown.
 */
export function UpdateBanner({ enabled }: { enabled: boolean }) {
  const t = useTranslations('updates.banner');
  const locale = useLocale();
  const [available, setAvailable] = useState<Available | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch('/api/updates', { signal: controller.signal, cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((status: UpdateStatus | null) => {
        if (status?.state !== 'available') return;
        setHidden(dismissedVersion() === status.latest);
        setAvailable(status);
      })
      .catch(() => undefined); // offline, aborted: no banner, no message
    return () => controller.abort();
  }, [enabled]);

  if (!enabled || !available || hidden) return null;

  return (
    <Alert id="update-banner">
      <CircleArrowUp aria-hidden="true" />
      <AlertTitle>{t('title', { latest: available.latest })}</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <span>{t('running', { current: available.current })}</span>
        {available.summary && <span>{available.summary}</span>}
        <span>
          <a
            href={available.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline underline-offset-4"
          >
            {t('notes')}
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
          {' · '}
          <a
            href={`https://github.com/edouardbautz/BDE_Network/blob/main/docs/${locale === 'fr' ? 'fr' : 'en'}/upgrading.md`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline underline-offset-4"
          >
            {t('guide')}
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        </span>
        <span>{t('howTo')}</span>
        <div className="flex flex-col gap-2">
          <CopyField id="update-command-pull" value="git pull" label={t('commandPull')} />
          <CopyField id="update-command-up" value="docker compose up -d" label={t('commandUp')} />
        </div>
        <span className="text-muted-foreground text-small">{t('backup')}</span>
        <div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              rememberDismissed(available.latest);
              setHidden(true);
            }}
          >
            {t('dismiss')}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
