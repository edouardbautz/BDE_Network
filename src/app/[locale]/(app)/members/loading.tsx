import { PageHeaderSkeleton } from '@/components/layout/page-header-skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

function RowsSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="size-8 shrink-0 rounded-pill" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="ml-auto h-9 w-24 rounded-pill" />
        </div>
      ))}
    </div>
  );
}

export default function MembersLoading() {
  return (
    <>
      <PageHeaderSkeleton eyebrow={false} />
      <div className="flex flex-col gap-3 sm:gap-4">
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-40" />
          </CardHeader>
          <CardContent>
            <RowsSkeleton rows={2} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardContent>
            <RowsSkeleton rows={5} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
