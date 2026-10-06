import type { ComponentType, ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StatusCardProps {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  /** Buttons, links or a short extra line, under the description. */
  children?: ReactNode;
  /** Centered on the whole screen (public pages) rather than inside the app shell. */
  fullPage?: boolean;
}

/** The card shown when there is nothing to display but an explanation: a page that does not
 * exist, an error. Same look as the waiting and unavailable pages (docs/design.md). It has no
 * hook and no translation of its own, so even the last-resort error page can render it. */
export function StatusCard({
  icon: Icon,
  title,
  description,
  children,
  fullPage = false,
}: StatusCardProps) {
  return (
    <main
      className={cn('flex items-center justify-center p-6', fullPage ? 'min-h-screen' : 'py-16')}
    >
      <Card className="w-full max-w-sm text-center">
        <CardHeader className="items-center gap-1">
          <div className="bg-muted text-muted-foreground mb-2 flex size-10 items-center justify-center justify-self-center rounded-full">
            <Icon className="size-5" />
          </div>
          <CardTitle className="text-xl font-semibold tracking-tight">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {children && <CardContent className="flex flex-col gap-3">{children}</CardContent>}
      </Card>
    </main>
  );
}
