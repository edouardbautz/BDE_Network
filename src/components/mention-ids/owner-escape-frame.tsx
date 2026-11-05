'use client';

import type { ReactNode } from 'react';
import { usePathname } from '@/i18n/navigation';

/**
 * What an owner who still has an id to give sees (docs/architecture.md, "The ids asked of everybody", "The owner is never locked out"). On the settings
 * page, and on it alone, the page itself with a permanent notice above it; on every other address the same blocking step as everybody else. This is
 * only the choice of what to draw: the settings are open to this owner by `getSettingsOwner` on the server, and every other page and action refuses
 * the session, which holds nothing.
 */
export function OwnerEscapeFrame({
  gate,
  notice,
  children,
}: {
  gate: ReactNode;
  notice: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  if (pathname !== '/settings') return gate;
  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-4 p-4 sm:p-8">
      {notice}
      <main id="main-content">{children}</main>
    </div>
  );
}
