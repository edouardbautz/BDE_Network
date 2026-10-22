import { PageHeaderSkeleton } from '@/components/layout/page-header-skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function EventsLoading() {
  return (
    <>
      <PageHeaderSkeleton eyebrow={false} />
      <div className="flex flex-col gap-3 sm:gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Skeleton className="h-11 w-48 rounded-pill" />
          <Skeleton className="h-10 w-64 rounded-pill" />
        </div>
        <Skeleton className="h-28 rounded-xl sm:rounded-2xl" />

        <Card>
          <CardContent className="flex flex-col gap-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="flex flex-col gap-2 sm:flex-row sm:gap-4">
                <Skeleton className="h-4 w-32 shrink-0" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-56 max-w-full" />
                  <Skeleton className="h-3 w-40 max-w-full" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
