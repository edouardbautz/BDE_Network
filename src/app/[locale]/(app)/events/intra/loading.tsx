import { PageHeaderSkeleton } from '@/components/layout/page-header-skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function IntraRequestsLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <Card>
        <CardContent className="flex flex-col gap-5">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="flex flex-col gap-2">
              <Skeleton className="h-4 w-56 max-w-full" />
              <Skeleton className="h-3 w-72 max-w-full" />
              <Skeleton className="h-3 w-48 max-w-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
