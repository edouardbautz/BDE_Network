import { ScrollText } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/galets/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { ScrollableTable } from '@/components/scrollable-table';
import { getEffectiveSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { canViewAuditLog } from '@/lib/permissions';
import { redirect } from '@/i18n/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { pageTitle } from '@/lib/page-title';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const dynamic = 'force-dynamic';
export const generateMetadata = pageTitle('auditLog', 'title');

export default async function AuditLogPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getEffectiveSession();

  if (!session?.user || !canViewAuditLog(session.user)) {
    redirect({ href: '/dashboard', locale });
  }

  const [t, entries] = await Promise.all([
    getTranslations('auditLog'),
    prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
  ]);

  const dateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <>
      <PageHeader title={t('title')} />
      <p className="text-body text-muted-foreground -mt-2 mb-4 max-w-[68ch] sm:-mt-3 sm:mb-5">
        {t('subtitle')}
      </p>

      <Card>
        <CardContent>
          {entries.length === 0 ? (
            <EmptyState icon={ScrollText} title={t('empty')} description={t('emptyHint')} />
          ) : (
            <ScrollableTable label={t('title')}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('columns.date')}</TableHead>
                    <TableHead>{t('columns.actor')}</TableHead>
                    <TableHead>{t('columns.action')}</TableHead>
                    <TableHead>{t('columns.target')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell
                        className="text-muted-foreground whitespace-nowrap"
                        data-label={t('columns.date')}
                      >
                        {dateFormatter.format(entry.createdAt)}
                      </TableCell>
                      <TableCell className="font-bold" data-label={t('columns.actor')}>
                        {entry.actorLogin}
                      </TableCell>
                      <TableCell data-label={t('columns.action')}>
                        <code className="rounded-xs bg-surface-2 px-2 py-0.5 text-small">
                          {entry.action}
                        </code>
                      </TableCell>
                      <TableCell className="text-muted-foreground" data-label={t('columns.target')}>
                        {entry.targetLabel ?? entry.targetType}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollableTable>
          )}
        </CardContent>
      </Card>
    </>
  );
}
