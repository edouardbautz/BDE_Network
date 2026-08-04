import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canViewAuditLog } from '@/lib/permissions';
import { redirect } from '@/i18n/navigation';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const dynamic = 'force-dynamic';

export default async function AuditLogPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await auth();

  if (!session?.user || !canViewAuditLog(session.user.role)) {
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
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground mt-1">{t('subtitle')}</p>
      </div>

      <Card>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('empty')}</p>
          ) : (
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
                    <TableCell className="whitespace-nowrap">
                      {dateFormatter.format(entry.createdAt)}
                    </TableCell>
                    <TableCell>{entry.actorLogin}</TableCell>
                    <TableCell>{entry.action}</TableCell>
                    <TableCell>{entry.targetLabel ?? entry.targetType}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
