import { PageHeaderSkeleton } from '@/components/layout/page-header-skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function IntraRequestLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <div className="flex flex-col gap-3 sm:gap-4">
        <Card>
          <CardContent className="flex flex-col gap-3">
            <Skeleton className="h-5.5 w-32 rounded-pill" />
            <div className="flex gap-2">
              <Skeleton className="h-10 w-40 rounded-pill" />
              <Skeleton className="h-10 w-28 rounded-pill" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-5">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="flex flex-col gap-2 sm:flex-row sm:justify-between">
                <Skeleton className="h-3 w-40 max-w-full" />
                <Skeleton className="h-9 w-24 rounded-pill" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
