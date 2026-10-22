import { Skeleton } from '@/components/ui/skeleton';

/** The dashboard as it will be: a title, the one accent card, the list under it, and the narrow column. */
export default function DashboardLoading() {
  return (
    <>
      <div className="flex flex-col gap-2 pt-2 pb-4 sm:pt-0 sm:pb-6">
        <Skeleton className="h-3.5 w-20" />
        <Skeleton className="h-8 w-48" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-12">
        <div className="flex flex-col gap-3 sm:gap-4 lg:col-span-8">
          <Skeleton className="h-60 rounded-xl sm:rounded-3xl" />
          <div className="bg-surface elev-1 flex flex-col gap-4 rounded-xl p-5 sm:rounded-2xl sm:p-5.5">
            <Skeleton className="h-4 w-40" />
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="flex items-center gap-3">
                <Skeleton className="h-12.5 w-12 shrink-0 rounded-md" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-3 w-56 max-w-full" />
                  <Skeleton className="h-3 w-36 max-w-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:gap-4 lg:col-span-4">
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-2">
            <Skeleton className="h-22 rounded-xl sm:rounded-lg" />
            <Skeleton className="h-22 rounded-xl sm:rounded-lg" />
            <Skeleton className="h-22 rounded-xl sm:rounded-lg" />
          </div>
          <Skeleton className="h-32 rounded-xl sm:rounded-2xl lg:-order-1" />
        </div>
      </div>
    </>
  );
}
