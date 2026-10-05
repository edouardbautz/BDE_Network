import { cn } from '@/lib/utils';
import type { CategoryView } from '@/lib/events/categories';

/** A category's colour dot + label. The colour comes from bde.config.yml, so
 * it is applied inline; the label stays in the neutral foreground colour so
 * contrast never depends on the BDE's palette choice. */
export function CategoryBadge({
  category,
  className,
}: {
  category: CategoryView;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-xs font-medium', className)}>
      <span
        aria-hidden
        className="bg-muted-foreground/40 size-2.5 shrink-0 rounded-full"
        style={category.color ? { backgroundColor: category.color } : undefined}
      />
      <span className="truncate">{category.label}</span>
    </span>
  );
}
