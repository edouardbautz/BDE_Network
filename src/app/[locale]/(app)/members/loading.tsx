import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

function TableSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="size-6 shrink-0 rounded-full" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="ml-auto h-7 w-20 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

export default function MembersLoading() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-7 w-52" />

      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <Skeleton className="h-4 w-40" />
        </CardHeader>
        <CardContent>
          <TableSkeleton rows={2} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent>
          <TableSkeleton rows={4} />
        </CardContent>
      </Card>
    </div>
  );
}
