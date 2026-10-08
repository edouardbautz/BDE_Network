import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/** The shape of the page: a title, the backup notice and a few forms. */
export default function SettingsLoading() {
  return (
    <div className="flex max-w-3xl flex-col gap-6" aria-hidden="true">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-40 w-full" />
      {[0, 1, 2].map((index) => (
        <Card key={index}>
          <CardContent className="flex flex-col gap-4">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-80 max-w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
