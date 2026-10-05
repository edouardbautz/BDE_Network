'use client';

import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';

const POLL_INTERVAL_MS = 10_000;

/** Sends the visitor back to the platform as soon as the service answers again,
 * so nobody has to keep reloading the page. */
export function UnavailableRetry() {
  const t = useTranslations('unavailable');
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const response = await fetch('/api/health', { cache: 'no-store' });
        if (response.ok) router.replace('/');
      } catch {
        // Still down (or the network is): keep waiting.
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [router]);

  return (
    <Button type="button" variant="outline" className="w-full" onClick={() => router.replace('/')}>
      <RefreshCw data-icon="inline-start" />
      {t('retry')}
    </Button>
  );
}
