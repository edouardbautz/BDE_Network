import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await auth();
  const t = await getTranslations('dashboard');
  const tRoles = await getTranslations('roles');

  if (!session?.user) {
    return null;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground mt-1">
          {t('welcome', { name: session.user.name ?? session.user.login })}
        </p>
      </div>
      <Card className="max-w-sm">
        <CardHeader>
          <CardTitle className="text-base">{session.user.login}</CardTitle>
        </CardHeader>
        <CardContent>
          <Badge variant="secondary">{tRoles(session.user.role)}</Badge>
        </CardContent>
      </Card>
    </div>
  );
}
