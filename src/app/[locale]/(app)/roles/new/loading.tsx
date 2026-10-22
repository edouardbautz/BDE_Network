import { PageHeaderSkeleton } from '@/components/layout/page-header-skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function NewRoleLoading() {
  return (
    <div className="flex max-w-3xl flex-col">
      <PageHeaderSkeleton />
      <div className="flex flex-col gap-3 sm:gap-4">
        <Card>
          <CardContent className="flex flex-col gap-5">
            <Skeleton className="h-11 w-full rounded-pill" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="flex items-start gap-3">
                <Skeleton className="mt-0.5 size-5 shrink-0 rounded-xs" />
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-4 w-44" />
                  <Skeleton className="h-3 w-72 max-w-full" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
