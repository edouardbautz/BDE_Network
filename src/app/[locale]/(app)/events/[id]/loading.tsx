import { PageHeaderSkeleton } from '@/components/layout/page-header-skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/** The page of an event: the title with its way back, the badges and buttons, the facts and the dates of a series. */
export default function EventDetailLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <div className="flex flex-col gap-3 sm:gap-4">
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Skeleton className="h-5.5 w-20 rounded-pill" />
            <Skeleton className="h-5.5 w-24 rounded-pill" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-10 w-44 rounded-pill" />
            <Skeleton className="h-10 w-24 rounded-pill" />
          </div>
        </div>
        <Card>
          <CardContent className="flex flex-col gap-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-7 shrink-0 rounded-xs" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <Skeleton className="ml-10 h-4 w-64 max-w-full" />
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
