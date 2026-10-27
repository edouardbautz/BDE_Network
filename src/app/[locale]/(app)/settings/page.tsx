import { FileWarning, ShieldAlert } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { BackupsSection } from '@/components/settings/backups-section';
import { OAuthRejectedAlert } from '@/components/settings/oauth-rejected-alert';
import { UpdateBanner } from '@/components/updates/update-banner';
import { SettingsPanels } from '@/components/settings/settings-panels';
import { getConfig } from '@/config';
import { channelsFor } from '@/config/schema';
import { checkFortyTwoCredentials } from '@/lib/auth/oauth-check';
import { readOverview } from '@/lib/backups/list';
import { readBackupNotice } from '@/lib/backups/notice';
import { backupDir } from '@/lib/backups/service';
import { prisma } from '@/lib/prisma';
import { PageHeader } from '@/components/layout/page-header';
import { pageTitle } from '@/lib/page-title';
import { getSettingsManager, isSettingsEditable } from '@/lib/settings/access';
import { getRuntimeSettings } from '@/lib/settings/runtime';
import { settingsExtras, settingsView } from '@/lib/settings/view';
import { runningVersion } from '@/lib/updates/version';

export const dynamic = 'force-dynamic';
export const generateMetadata = pageTitle('settings', 'title');

/** The settings of the platform: owners only (a simulated role in development does not count). */
export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ backup?: string | string[] }>;
}) {
  const { locale } = await params;
  const { backup } = await searchParams;
  const session = await getSettingsManager();
  if (!session) {
    redirect({ href: '/dashboard', locale });
    return null;
  }

  const t = await getTranslations('settings');
  const editable = isSettingsEditable();
  const secretsStatus = getRuntimeSettings()?.secretsStatus ?? 'ok';
  // Written into the image when it is built (docker/start.mjs hands it over); absent in development.
  const version = runningVersion();
  const installation = editable
    ? await prisma.platformSettings.findUnique({
        where: { id: 'platform' },
        select: { installedAt: true },
      })
    : null;

  return (
    <>
      <PageHeader title={t('title')} />
      <div className="-mt-2 mb-4 flex max-w-[68ch] flex-col gap-1 sm:-mt-3 sm:mb-5">
        <p className="text-body text-muted-foreground">{t('subtitle')}</p>
        {installation && (
          <p className="text-small text-muted-foreground">
            {t('since', {
              date: new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(
                installation.installedAt,
              ),
            })}
          </p>
        )}
        {version && <p className="text-small text-muted-foreground">{t('version', { version })}</p>}
      </div>

      <div className="flex max-w-3xl flex-col gap-3 sm:gap-4">
        {editable && <UpdateBanner enabled={getConfig().updates.check} />}

        {/* The backups: the keys are not in the database, and a backup that holds both is the one thing to keep safe, so it is always in view. */}
        <BackupsSection
          overview={await readOverview(backupDir(), new Date())}
          notice={readBackupNotice(backup)}
          locale={locale}
          timeZone={getConfig().bde.timezone}
          told={
            channelsFor(getConfig(), 'backupFailed').length > 0 ||
            channelsFor(getConfig(), 'backupStale').length > 0
          }
        />

        {editable && (await checkFortyTwoCredentials()) === 'rejected' && <OAuthRejectedAlert />}

        {secretsStatus === 'lost' && (
          <Alert variant="destructive">
            <ShieldAlert aria-hidden="true" />
            <AlertTitle>{t('secrets.lostTitle')}</AlertTitle>
            <AlertDescription>{t('secrets.lostBody')}</AlertDescription>
          </Alert>
        )}
        {secretsStatus === 'resealed' && (
          <Alert>
            <ShieldAlert aria-hidden="true" />
            <AlertTitle>{t('secrets.resealedTitle')}</AlertTitle>
            <AlertDescription>{t('secrets.resealedBody')}</AlertDescription>
          </Alert>
        )}

        {editable ? (
          <SettingsPanels
            view={settingsView()}
            extras={await settingsExtras()}
            actorLogin={session.user.login}
          />
        ) : (
          <Alert>
            <FileWarning aria-hidden="true" />
            <AlertTitle>{t('readOnly.title')}</AlertTitle>
            <AlertDescription>{t('readOnly.body')}</AlertDescription>
          </Alert>
        )}
      </div>
    </>
  );
}
