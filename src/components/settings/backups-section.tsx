import { CheckCircle2, DatabaseBackup, ShieldAlert, ShieldCheck } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { ActionButton } from '@/components/action-button';
import { EmptyState } from '@/components/galets/empty-state';
import { ScrollableTable } from '@/components/scrollable-table';
import { BackupDownload } from '@/components/settings/backup-download';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { runBackupNow } from '@/app/[locale]/(app)/settings/actions';
import { formatSize } from '@/lib/backups/format';
import type { BackupOverview } from '@/lib/backups/list';
import { isFailure, type BackupNotice } from '@/lib/backups/notice';
import type { FailureCode } from '@/lib/backups/status';

/**
 * The backups, for the owners (the Settings page): when the last one was made, how big it is and how far it was checked, whether the
 * platform has fallen behind, the ones that are kept with a download for each, and the button that makes one now.
 */
export async function BackupsSection({
  overview,
  notice,
  locale,
  timeZone,
}: {
  overview: BackupOverview;
  /** What the backup the owner asked for came to (`?backup=`), when the page was loaded after one. */
  notice: BackupNotice | null;
  locale: string;
  timeZone: string;
}) {
  const t = await getTranslations('settings.backups');
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short', timeZone });
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone });
  const reason = (code: FailureCode) => t(`reasons.${code}`);
  const { last } = overview;

  return (
    <Card>
      <CardContent>
        <section aria-labelledby="settings-backups" className="flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <h2 id="settings-backups" className="text-title-3">
              {t('title')}
            </h2>
            <p className="text-muted-foreground text-body">{t('description')}</p>
          </div>

          {notice && (
            <Alert variant={notice !== 'made' && isFailure(notice) ? 'destructive' : 'default'}>
              {notice === 'made' ? (
                <CheckCircle2 aria-hidden="true" />
              ) : (
                <ShieldAlert aria-hidden="true" />
              )}
              <AlertDescription>
                {isFailure(notice)
                  ? t('notice.failed', { reason: reason(notice) })
                  : t(`notice.${notice}`)}
              </AlertDescription>
            </Alert>
          )}

          <div className="bg-surface-2 flex items-start gap-3 rounded-lg p-3.5">
            <div className="bg-accent-soft text-accent-ink flex size-9 shrink-0 items-center justify-center rounded-sm">
              {last ? (
                <ShieldCheck className="size-4" aria-hidden="true" />
              ) : (
                <DatabaseBackup className="size-4" aria-hidden="true" />
              )}
            </div>
            <div className="flex-1">
              <p className="text-small text-muted-foreground">{t('last.title')}</p>
              {last ? (
                <>
                  <p id="backups-last" className="text-body-strong">
                    {when.format(last.at)} · {formatSize(last.bytes, locale)}
                  </p>
                  <p className="text-muted-foreground text-body">
                    {last.level === 'restored'
                      ? t('last.restored')
                      : last.level === 'read'
                        ? t('last.read')
                        : t('last.unknown')}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-body-strong">{t('last.none')}</p>
                  <p className="text-muted-foreground text-body">{t('last.noneBody')}</p>
                </>
              )}
            </div>
          </div>

          {overview.stale && (
            <Alert variant="destructive">
              <ShieldAlert aria-hidden="true" />
              <AlertTitle>{t('stale.title')}</AlertTitle>
              <AlertDescription>{t('stale.body')}</AlertDescription>
            </Alert>
          )}
          {overview.lastFailure && (
            <Alert variant="destructive">
              <ShieldAlert aria-hidden="true" />
              <AlertTitle>{t('failure.title')}</AlertTitle>
              <AlertDescription>
                {t('failure.body', { reason: reason(overview.lastFailure.code) })}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <ActionButton action={runBackupNow} variant="default" size="default">
              {t('run.button')}
            </ActionButton>
            <span className="text-small text-muted-foreground">{t('run.hint')}</span>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h3 className="text-title-4">{t('list.title')}</h3>
              <p className="text-muted-foreground text-body">{t('list.description')}</p>
            </div>
            {!overview.readable ? (
              <Alert variant="destructive">
                <ShieldAlert aria-hidden="true" />
                <AlertDescription>{t('list.unreadable')}</AlertDescription>
              </Alert>
            ) : overview.backups.length === 0 ? (
              <EmptyState
                icon={DatabaseBackup}
                title={t('list.empty')}
                description={t('list.emptyHint')}
              />
            ) : (
              <ScrollableTable label={t('list.label')}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('list.columns.date')}</TableHead>
                      <TableHead>{t('list.columns.size')}</TableHead>
                      <TableHead>{t('list.columns.download')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.backups.map((backup) => (
                      <TableRow key={backup.name}>
                        <TableCell
                          className="whitespace-nowrap"
                          data-label={t('list.columns.date')}
                        >
                          {when.format(backup.at)}
                        </TableCell>
                        <TableCell
                          className="text-muted-foreground whitespace-nowrap"
                          data-label={t('list.columns.size')}
                        >
                          {formatSize(backup.bytes, locale)}
                        </TableCell>
                        <TableCell data-label={t('list.columns.download')}>
                          <BackupDownload name={backup.name} dateLabel={day.format(backup.at)} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollableTable>
            )}
          </div>

          <p className="text-small text-muted-foreground">{t('where')}</p>
        </section>
      </CardContent>
    </Card>
  );
}
