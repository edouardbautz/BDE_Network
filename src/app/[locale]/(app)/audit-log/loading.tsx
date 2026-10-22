import { PageHeaderSkeleton } from '@/components/layout/page-header-skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function AuditLogLoading() {
  return (
    <>
      <PageHeaderSkeleton eyebrow={false} />
      <Card>
        <CardContent className="flex flex-col gap-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
