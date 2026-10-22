'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useShell } from './shell-context';

interface PageHeaderProps {
  /** What the page is about, small and above the title: the date, a count (spec 5.6). */
  eyebrow?: string;
  title: string;
  /** The actions of the page on a computer: the main one last. A phone has the tab bar for them. */
  actions?: ReactNode;
}

/**
 * The head of a page (spec 5.6). On a computer: eyebrow, title and the actions on the right. On a phone: eyebrow, title and the
 * avatar; once the title has scrolled away, a bar of 52 px keeps its name on screen, on the page background blurred (the one
 * place the specification allows a blur).
 */
export function PageHeader({ eyebrow, title, actions }: PageHeaderProps) {
  const { userMenu } = useShell();
  const sentinel = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  // The sentinel sits 48 px under the top of the page: once it has left the screen by the top, the header is compact.
  useEffect(() => {
    const element = sentinel.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => setCompact(!!entry && !entry.isIntersecting && entry.boundingClientRect.top < 0),
      { threshold: 0 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <header className="relative flex min-h-14 items-center justify-between gap-4 pt-2 pb-4 sm:pt-0 sm:pb-6">
      <div
        ref={sentinel}
        aria-hidden="true"
        className="pointer-events-none absolute top-12 left-0 h-px w-px"
      />

      {/* The compact bar of a phone repeats the title for the eye only: the heading below stays the one of the page. */}
      <div
        aria-hidden="true"
        className={cn(
          'bg-bg/92 text-title-3 fixed inset-x-0 top-0 z-30 flex h-13 items-center justify-center backdrop-blur-[12px] sm:hidden',
          'border-b border-transparent transition-[opacity,border-color] duration-(--dur-fast) ease-(--ease-standard)',
          compact ? 'border-line opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <span className="truncate px-16">{title}</span>
      </div>

      <div className="min-w-0">
        {eyebrow && <p className="text-small text-muted-foreground">{eyebrow}</p>}
        <h1 className="text-title-1 text-ink mt-0.5">{title}</h1>
      </div>

      <div className="hidden shrink-0 items-center gap-2 sm:flex">{actions}</div>
      <div className="shrink-0 sm:hidden">{userMenu}</div>
    </header>
  );
}
