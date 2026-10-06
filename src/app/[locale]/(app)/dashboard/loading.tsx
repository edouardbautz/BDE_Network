import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-56" />
      </div>

      <Card className="max-w-sm">
        <CardHeader className="flex flex-row items-center gap-3 space-y-0">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-40" />
          </div>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-5 w-20 rounded-4xl" />
        </CardContent>
      </Card>

      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-10">
          <Skeleton className="size-10 rounded-full" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-64" />
        </CardContent>
      </Card>
    </div>
  );
}
