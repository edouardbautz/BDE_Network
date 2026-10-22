import { PageHeaderSkeleton } from '@/components/layout/page-header-skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function ProfileLoading() {
  return (
    <>
      <PageHeaderSkeleton eyebrow={false} />
      <div className="flex flex-col gap-3 sm:gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center gap-3">
            <Skeleton className="size-12 rounded-pill" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-40" />
            </div>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-48" />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Skeleton className="h-3 w-full max-w-md" />
            <Skeleton className="h-11 w-full max-w-xl rounded-pill" />
            <Skeleton className="h-10 w-40 rounded-pill" />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
