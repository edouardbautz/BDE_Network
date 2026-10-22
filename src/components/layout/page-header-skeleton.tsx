import { Skeleton } from '@/components/ui/skeleton';

/**
 * What `PageHeader` takes before the page arrives: the same box (56 px at least, the same padding), a small line over the
 * title and, on a phone, the round picture of the account. A loading screen that is shorter or taller than its page moves the
 * footer when the page replaces it (a layout shift the performance budget counts).
 */
export function PageHeaderSkeleton({ eyebrow = true }: { eyebrow?: boolean }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 pt-2 pb-4 sm:pt-0 sm:pb-6">
      <div className="flex flex-col gap-2">
        {eyebrow && <Skeleton className="h-3.5 w-20" />}
        <Skeleton className="h-8 w-48" />
      </div>
      <Skeleton className="size-11 shrink-0 rounded-pill sm:hidden" />
    </div>
  );
}
