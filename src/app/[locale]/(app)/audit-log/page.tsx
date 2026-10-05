import { ScrollText } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getEffectiveSession } from '@/lib/auth/session';
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
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </div>

      <Card>
        <CardContent>
          {entries.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <div className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full">
                <ScrollText className="size-5" />
              </div>
              <p className="text-muted-foreground text-sm">{t('empty')}</p>
            </div>
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
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {dateFormatter.format(entry.createdAt)}
                    </TableCell>
                    <TableCell className="font-medium">{entry.actorLogin}</TableCell>
                    <TableCell>
                      <code className="bg-muted rounded-sm px-1.5 py-0.5 text-xs">
                        {entry.action}
                      </code>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {entry.targetLabel ?? entry.targetType}
                    </TableCell>
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
