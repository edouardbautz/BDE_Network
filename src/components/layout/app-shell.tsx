'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import { LayoutDashboard, Menu, ScrollText, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Link, usePathname } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { ThemeToggle } from '@/components/theme-toggle';

export interface NavItem {
  id: 'dashboard' | 'members' | 'auditLog';
  href: string;
  label: string;
}

const NAV_ICONS: Record<NavItem['id'], typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  members: Users,
  auditLog: ScrollText,
};

interface AppShellProps {
  bdeName: string;
  logoPath: string;
  navItems: NavItem[];
  userMenu: ReactNode;
  footer: ReactNode;
  menuLabel: string;
  navLabel: string;
  navDescription: string;
  children: ReactNode;
}

function BrandMark({ bdeName, logoPath }: { bdeName: string; logoPath: string }) {
  return (
    <Link
      href="/dashboard"
      className="flex min-w-0 items-center gap-2.5 rounded-sm font-semibold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- local SVG logo, next/image blocks SVG optimization by default */}
      <img src={logoPath} alt="" width={24} height={24} className="shrink-0" />
      <span className="truncate">{bdeName}</span>
    </Link>
  );
}

function NavList({
  items,
  label,
  onNavigate,
}: {
  items: NavItem[];
  label: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5" aria-label={label}>
      {items.map((item) => {
        const Icon = NAV_ICONS[item.id];
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'relative flex items-center gap-2.5 rounded-md py-2 pr-2.5 pl-3.5 text-sm font-medium outline-none transition-colors',
              'focus-visible:ring-3 focus-visible:ring-ring/50',
              isActive
                ? 'bg-primary/10 text-sidebar-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground',
            )}
          >
            <Icon className={cn('size-4 shrink-0', isActive && 'text-primary')} />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({
  bdeName,
  logoPath,
  navItems,
  userMenu,
  footer,
  menuLabel,
  navLabel,
  navDescription,
  children,
}: AppShellProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-3 focus-visible:left-3 focus-visible:z-50 focus-visible:rounded-md focus-visible:bg-primary focus-visible:px-3 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:text-primary-foreground"
      >
        {navLabel}
      </a>

      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex h-14 items-center border-b border-sidebar-border px-4">
          <BrandMark bdeName={bdeName} logoPath={logoPath} />
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <NavList items={navItems} label={navLabel} />
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-sidebar-border p-3">
          {userMenu}
          <ThemeToggle />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur md:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger render={<Button variant="ghost" size="icon" aria-label={menuLabel} />}>
              <Menu className="size-5" />
            </SheetTrigger>
            <SheetContent
              side="left"
              className="flex w-64 flex-col gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
            >
              <SheetHeader className="border-b border-sidebar-border p-4">
                <SheetTitle className="sr-only">{navLabel}</SheetTitle>
                <SheetDescription className="sr-only">{navDescription}</SheetDescription>
                <BrandMark bdeName={bdeName} logoPath={logoPath} />
              </SheetHeader>
              <div className="flex-1 overflow-y-auto px-3 py-4">
                <NavList items={navItems} label={navLabel} onNavigate={() => setOpen(false)} />
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-sidebar-border p-3">
                {userMenu}
                <ThemeToggle />
              </div>
            </SheetContent>
          </Sheet>
          <div className="min-w-0 flex-1">
            <BrandMark bdeName={bdeName} logoPath={logoPath} />
          </div>
        </header>

        <main
          id="main-content"
          className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 md:px-8 md:py-8"
        >
          {children}
        </main>
        {footer}
      </div>
    </div>
  );
}
