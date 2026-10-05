import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function SharedCalendarLoading() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-8 w-24 rounded-lg" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <Card className="max-w-3xl">
        <CardHeader>
          <Skeleton className="h-4 w-56" />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Skeleton className="h-8 w-full rounded-lg" />
          <Skeleton className="h-3 w-80 max-w-full" />
          <Skeleton className="h-14 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </CardContent>
      </Card>
    </div>
  );
}
