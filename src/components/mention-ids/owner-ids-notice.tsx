import { AtSign } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Link } from '@/i18n/navigation';
import type { MentionPlatform } from '@/lib/mention-ids/required';

/** The reminder an owner sees above the settings while an id is missing: always there, nothing to dismiss, and a link to the place that asks for it. */
export async function OwnerIdsNotice({ missing }: { missing: readonly MentionPlatform[] }) {
  const t = await getTranslations('mentionIds');
  const platforms = missing.map((platform) => t(`platformNames.${platform}`)).join(' / ');
  return (
    <Alert role="status" data-owner-ids-notice>
      <AtSign aria-hidden="true" />
      <AlertTitle>{t('ownerNotice.title', { platforms })}</AlertTitle>
      <AlertDescription>
        {t('ownerNotice.body')}{' '}
        <Link href="/dashboard" className="text-body-strong underline underline-offset-3">
          {t('ownerNotice.link')}
        </Link>
      </AlertDescription>
    </Alert>
  );
}
