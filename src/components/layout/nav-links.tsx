'use client';

import { cn } from '@/lib/utils';
import { Link, usePathname } from '@/i18n/navigation';

interface NavLinksProps {
  items: { href: string; label: string }[];
}

export function NavLinks({ items }: NavLinksProps) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto">
      {items.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
