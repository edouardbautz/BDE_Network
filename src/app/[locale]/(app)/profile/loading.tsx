import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function ProfileLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-56" />
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center gap-3 space-y-0">
          <Skeleton className="size-10 rounded-full" />
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
          <Skeleton className="h-8 w-full max-w-xl rounded-lg" />
          <Skeleton className="h-8 w-40 rounded-lg" />
        </CardContent>
      </Card>
    </div>
  );
}
