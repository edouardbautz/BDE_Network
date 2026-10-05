import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/** Shared loading shape of the create and edit forms. */
export function EventFormSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-7 w-56" />
      <Card>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <Skeleton className="h-14 rounded-lg sm:col-span-2" />
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-14 rounded-lg" />
          ))}
          <Skeleton className="h-40 rounded-lg sm:col-span-2" />
        </CardContent>
      </Card>
      <div className="flex gap-3">
        <Skeleton className="h-8 w-28 rounded-lg" />
        <Skeleton className="h-8 w-20 rounded-lg" />
      </div>
    </div>
  );
}
