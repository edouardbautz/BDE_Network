import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * What a list says when it has nothing to show (spec 5.11): an icon tile on the soft accent, a title, one sentence saying what
 * is missing and how to create it, and at most one action. No illustration.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center py-8 text-center">
      <div className="bg-accent-soft text-accent-ink flex size-14 items-center justify-center rounded-xl">
        <Icon aria-hidden="true" className="size-7" />
      </div>
      <p className="text-card-title text-ink mt-3.5 font-extrabold">{title}</p>
      <p className="text-body text-muted-foreground mt-1.5 max-w-80">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
