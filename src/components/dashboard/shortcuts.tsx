import type { LucideIcon } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

export interface Shortcut {
  href: string;
  label: string;
  icon: LucideIcon;
  /** A counter on the tile (the proposals waiting for a validator), with what a screen reader says for it. */
  count?: number;
  countLabel?: string;
}

/**
 * The shortcut tiles (spec 5.3): a surface with a soft shadow, an icon tile and a name. Three to a row on a phone; two in
 * the column of a computer. Each is a link: the whole tile is the target.
 */
export function Shortcuts({
  title,
  items,
  className,
}: {
  title: string;
  items: readonly Shortcut[];
  className?: string;
}) {
  return (
    <section aria-label={title} className={className}>
      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-2">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className={cn(
                'bg-surface elev-1 flex h-full min-h-22 flex-col items-start gap-2 rounded-xl px-3.5 py-3 outline-none sm:rounded-lg',
                'transition-[box-shadow,transform] duration-(--dur-fast) ease-(--ease-standard)',
                'hover:elev-2 motion-safe:active:scale-[.99] focus-visible:outline-offset-3',
              )}
            >
              <span className="relative">
                <span className="bg-accent-soft text-accent-ink flex size-9 items-center justify-center rounded-sm">
                  <item.icon aria-hidden="true" className="size-5" />
                </span>
                {item.count !== undefined && item.count > 0 && (
                  <>
                    <span
                      aria-hidden="true"
                      className="bg-accent-fill text-accent-on accent-edge text-micro tabular absolute -top-2 -right-3 flex h-4.5 min-w-4.5 items-center justify-center rounded-pill px-1 font-extrabold"
                    >
                      {item.count}
                    </span>
                    <span className="sr-only">{item.countLabel}</span>
                  </>
                )}
              </span>
              <span className="text-body-strong text-ink">{item.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
