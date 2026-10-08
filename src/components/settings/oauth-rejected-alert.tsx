import { TriangleAlert } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

/**
 * Shown to the owners only (never to a member, nor on the public pages) while 42 refuses the platform's
 * application: nobody can sign in, and an owner who still has a session is the one person who can fix it.
 * `withLink` adds the way to the settings page, for the pages that are not that page.
 */
export async function OAuthRejectedAlert({ withLink }: { withLink?: boolean }) {
  const t = await getTranslations('settings.oauthRejected');
  return (
    <Alert variant="destructive">
      <TriangleAlert aria-hidden="true" />
      <AlertTitle>{t('title')}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <span>{t('body')}</span>
        {withLink && (
          <Button size="sm" variant="outline" render={<Link href="/settings" />}>
            {t('cta')}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
