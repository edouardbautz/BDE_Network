import { PageHeaderSkeleton } from '@/components/layout/page-header-skeleton';
import { Skeleton } from '@/components/ui/skeleton';

export default function NotificationsLoading() {
  return (
    <>
      <PageHeaderSkeleton eyebrow={false} />
      <Skeleton className="mb-6 h-4 w-full max-w-xl" />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-14 w-full rounded-lg" />
          ))}
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-11 w-80 max-w-full rounded-pill" />
          <div className="grid gap-6 xl:grid-cols-2">
            <div className="flex flex-col gap-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-11 w-full rounded-pill" />
              ))}
            </div>
            <Skeleton className="h-96 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </>
  );
}
