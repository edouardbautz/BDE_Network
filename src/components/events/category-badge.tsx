import { cn } from '@/lib/utils';
import type { CategoryView } from '@/lib/events/categories';

/**
 * A category as a neutral badge (docs/design.md, "Badges"): its colour, which comes from bde.config.yml and so is applied inline,
 * is a dot; the label stays in ink, so that contrast never depends on the BDE's palette choice.
 */
export function CategoryBadge({
  category,
  className,
}: {
  category: CategoryView;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5.5 max-w-full min-w-0 items-center gap-1.5 rounded-pill bg-surface-2 px-2.5 text-caption text-ink',
        className,
      )}
    >
      <span
        aria-hidden
        className="bg-muted-foreground size-2 shrink-0 rounded-pill"
        style={category.color ? { backgroundColor: category.color } : undefined}
      />
      <span className="truncate">{category.label}</span>
    </span>
  );
}
