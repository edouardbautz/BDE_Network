import { PageHeaderSkeleton } from '@/components/layout/page-header-skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/** The shape of the page: a title, the backup notice and a few forms. */
export default function SettingsLoading() {
  return (
    <div className="flex max-w-3xl flex-col" aria-hidden="true">
      <PageHeaderSkeleton eyebrow={false} />
      <div className="flex flex-col gap-3 sm:gap-4">
        <Skeleton className="h-40 w-full rounded-xl sm:rounded-2xl" />
        {[0, 1, 2].map((index) => (
          <Card key={index}>
            <CardContent className="flex flex-col gap-4">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-80 max-w-full" />
              <Skeleton className="h-11 w-full rounded-pill" />
              <Skeleton className="h-11 w-full rounded-pill" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
