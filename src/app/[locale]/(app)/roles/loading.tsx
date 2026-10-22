import { PageHeaderSkeleton } from '@/components/layout/page-header-skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function RolesLoading() {
  return (
    <>
      <PageHeaderSkeleton eyebrow={false} />
      <Card>
        <CardContent className="flex flex-col gap-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex items-center gap-4">
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48 max-w-full" />
              </div>
              <Skeleton className="hidden h-4 w-40 sm:block" />
              <Skeleton className="h-9 w-20 rounded-pill" />
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
