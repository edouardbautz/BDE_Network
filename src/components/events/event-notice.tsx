import { Info } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { EventNotice } from '@/lib/events/notice';

/** The message left by an action that found its event or date gone (see lib/events/notice.ts). */
export async function EventNoticeAlert({ notice }: { notice: EventNotice | null }) {
  if (!notice) return null;
  const t = await getTranslations('events.notices');

  return (
    <Alert>
      <Info />
      <AlertDescription>{t(notice)}</AlertDescription>
    </Alert>
  );
}
