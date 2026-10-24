import { Info } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { IntraPageNotice } from '@/lib/events/intra-notice';

/** The message left by an answer about the intra that was not taken (see lib/events/intra-notice.ts). */
export async function IntraNoticeAlert({ notice }: { notice: IntraPageNotice | null }) {
  if (!notice) return null;
  const t = await getTranslations('events.intra.notices');
  return (
    <Alert>
      <Info />
      <AlertDescription>{t(notice)}</AlertDescription>
    </Alert>
  );
}
