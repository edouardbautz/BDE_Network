import { PageHeaderSkeleton } from '@/components/layout/page-header-skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function SharedCalendarLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <Card className="max-w-3xl">
        <CardHeader>
          <Skeleton className="h-4 w-56" />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Skeleton className="h-11 w-full rounded-pill" />
          <Skeleton className="h-3 w-80 max-w-full" />
          <Skeleton className="h-14 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </CardContent>
      </Card>
    </>
  );
}
