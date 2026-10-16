import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function ReviewLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-5">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-56 max-w-full" />
                <Skeleton className="h-3 w-72 max-w-full" />
                <Skeleton className="h-3 w-48 max-w-full" />
              </div>
              <div className="flex gap-2">
                <Skeleton className="h-8 w-24 rounded-lg" />
                <Skeleton className="h-8 w-24 rounded-lg" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
