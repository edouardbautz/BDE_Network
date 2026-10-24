'use client';

import type { ComponentProps, ReactNode } from 'react';
import { useState } from 'react';
import {
  Bell,
  CalendarDays,
  ClipboardCheck,
  Ellipsis,
  House,
  Plus,
  ScrollText,
  Send,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Link, usePathname } from '@/i18n/navigation';
import { initialsOf } from '@/lib/initials';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { ShellContext } from './shell-context';

export interface NavItem {
  id:
    | 'dashboard'
    | 'events'
    | 'eventsReview'
    | 'eventsIntra'
    | 'members'
    | 'roles'
    | 'notifications'
    | 'auditLog'
    | 'settings';
  href: string;
  /** The full name of the page. */
  label: string;
  /** What the rail and the tab bar print under the icon: one short word. */
  shortLabel: string;
  /** A counter shown on the entry (the proposals waiting for a validator); nothing when 0 or absent. */
  badge?: number;
  /** What a screen reader says for the counter ("3 proposals to validate"), since the number alone is not enough. */
  badgeLabel?: string;
}

/** What the Create button of the tab bar offers: a thing a person can start from anywhere. */
export interface CreateAction {
  href: string;
  label: string;
}

const NAV_ICONS: Record<NavItem['id'], typeof House> = {
  dashboard: House,
  events: CalendarDays,
  eventsReview: ClipboardCheck,
  eventsIntra: Send,
  members: Users,
  roles: ShieldCheck,
  notifications: Bell,
  auditLog: ScrollText,
  settings: Settings,
};

/** The entries the tab bar keeps in view, in this order; everything else is behind "More". */
const TAB_IDS: readonly NavItem['id'][] = ['dashboard', 'events', 'members'];

interface AppShellProps {
  bdeName: string;
  logoPath: string;
  /** The logo is the platform's default mark: the rail shows the initials of the BDE on the accent instead. */
  defaultLogo: boolean;
  navItems: NavItem[];
  createActions: CreateAction[];
  /** The account menu: an avatar at the foot of the rail, and (as `userMenuMobile`) in the header of a page on a phone. */
  userMenu: ReactNode;
  userMenuMobile: ReactNode;
  /** The account part of the "More" sheet (profile, theme, language, sign out). */
  moreFooter: ReactNode;
  footer: ReactNode;
  navLabel: string;
  navDescription: string;
  moreLabel: string;
  createLabel: string;
  /** The skip link, first stop of the keyboard: "Skip to the content". */
  skipLabel: string;
  children: ReactNode;
}

/** The mark of the BDE at the head of the rail (spec 5.4): the logo it uploaded, or its initials on the accent. */
function Logo({
  bdeName,
  logoPath,
  defaultLogo,
}: Pick<AppShellProps, 'bdeName' | 'logoPath' | 'defaultLogo'>) {
  return (
    <Link
      href="/dashboard"
      className="bg-accent-fill text-accent-on accent-edge text-body-strong flex size-11.5 shrink-0 items-center justify-center overflow-hidden rounded-md font-extrabold focus-visible:outline-offset-3"
    >
      {defaultLogo ? (
        <span aria-hidden="true">{initialsOf(bdeName)}</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- the BDE's own logo, served by the platform
        <img src={logoPath} alt="" className="size-full object-cover" />
      )}
      {/* The name is text, not an aria-label: a label that does not contain the visible initials fails WCAG 2.5.3. */}
      <span className="sr-only">{bdeName}</span>
    </Link>
  );
}

/** The longest address that matches is the active entry: `/events/review` does not light up "Events" too. */
function useActiveHref(items: readonly NavItem[]): string | undefined {
  const pathname = usePathname();
  return items
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .map((item) => item.href)
    .sort((a, b) => b.length - a.length)[0];
}

function Counter({ item, className }: { item: NavItem; className?: string }) {
  if (item.badge === undefined || item.badge <= 0) return null;
  return (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'bg-accent-fill text-accent-on accent-edge text-micro tabular flex h-4.5 min-w-4.5 items-center justify-center rounded-pill px-1 font-extrabold',
          className,
        )}
      >
        {item.badge}
      </span>
      <span className="sr-only">{item.badgeLabel}</span>
    </>
  );
}

function Rail({
  items,
  label,
  active,
}: {
  items: NavItem[];
  label: string;
  active: string | undefined;
}) {
  return (
    <nav aria-label={label} className="flex flex-col items-center gap-1.5">
      {items.map((item) => {
        const Icon = NAV_ICONS[item.id];
        const isActive = item.href === active;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'group relative flex w-18.5 flex-col items-center gap-1 rounded-lg px-2 py-2.5 text-center focus-visible:outline-offset-1',
              'transition-colors duration-(--dur-fast) ease-(--ease-standard)',
              isActive ? 'bg-accent-soft hover:bg-accent-soft-hover' : 'hover:bg-hover-on-bg',
            )}
          >
            <Icon
              aria-hidden="true"
              strokeWidth={isActive ? 2.4 : 2}
              className={cn(
                'size-5.75',
                isActive ? 'text-accent-ink' : 'text-muted-foreground group-hover:text-ink',
              )}
            />
            <span
              className={cn(
                'text-micro',
                isActive ? 'text-ink font-extrabold' : 'text-muted-foreground group-hover:text-ink',
              )}
            >
              {item.shortLabel}
            </span>
            {/* After the name in the page, over the corner of the icon on the screen: the name comes first for a screen reader. */}
            <Counter item={item} className="absolute top-1.5 left-1/2 ml-2" />
          </Link>
        );
      })}
    </nav>
  );
}

/** A row of a bottom sheet: an icon tile, a name. */
function SheetRow({
  href,
  icon: Icon,
  children,
  onNavigate,
}: {
  href: string;
  icon: typeof House;
  children: ReactNode;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="text-body-strong hover:bg-surface-2 flex min-h-12 items-center gap-3 rounded-lg px-2 focus-visible:outline-offset-1"
    >
      <span className="bg-accent-soft text-accent-ink flex size-9 shrink-0 items-center justify-center rounded-sm">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      {children}
    </Link>
  );
}

/** A sheet that rises from the bottom of a phone (spec 5.10): corners of 28, a handle, no close button (Escape, the veil). */
function BottomSheet({
  title,
  description,
  children,
  ...props
}: {
  title: string;
  description: string;
  children: ReactNode;
} & ComponentProps<typeof SheetContent>) {
  return (
    <SheetContent
      side="bottom"
      showCloseButton={false}
      className="bg-surface elev-3 gap-0 rounded-t-dialog border-0 px-5 pt-2 pb-[calc(var(--space-8)+env(safe-area-inset-bottom))]"
      {...props}
    >
      <div aria-hidden="true" className="bg-line mx-auto mb-4 h-1 w-9 shrink-0 rounded-pill" />
      <SheetTitle className="text-title-2 mb-1">{title}</SheetTitle>
      <SheetDescription className="sr-only">{description}</SheetDescription>
      {children}
    </SheetContent>
  );
}

function TabBar({
  items,
  label,
  active,
  createActions,
  createLabel,
  moreLabel,
  moreFooter,
  navDescription,
}: {
  items: NavItem[];
  label: string;
  active: string | undefined;
  createActions: CreateAction[];
  createLabel: string;
  moreLabel: string;
  moreFooter: ReactNode;
  navDescription: string;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const tabs = TAB_IDS.flatMap((id) => items.filter((item) => item.id === id));
  const behindMore = items.filter((item) => !TAB_IDS.includes(item.id));
  const middle = Math.min(2, tabs.length);
  const before = tabs.slice(0, middle);
  const after = tabs.slice(middle);

  const tab = (item: NavItem) => {
    const Icon = NAV_ICONS[item.id];
    const isActive = item.href === active;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          'relative flex h-14.5 flex-col items-center justify-center gap-0.5 rounded-pill focus-visible:outline-offset-1',
          isActive ? 'text-accent-ink font-extrabold' : 'text-muted-foreground',
        )}
      >
        <Icon aria-hidden="true" strokeWidth={isActive ? 2.4 : 2} className="size-6" />
        <span className="text-micro">{item.shortLabel}</span>
        <Counter item={item} className="absolute top-1.5 left-1/2 ml-2" />
      </Link>
    );
  };

  return (
    <div className="fixed inset-x-4 bottom-[calc(var(--tabbar-gap)+env(safe-area-inset-bottom))] z-30 sm:hidden">
      <nav
        aria-label={label}
        className="bg-surface elev-2 grid h-(--tabbar-height) auto-cols-fr grid-flow-col items-center rounded-pill px-2"
      >
        {before.map(tab)}

        {createActions.length > 0 && (
          <Sheet open={createOpen} onOpenChange={setCreateOpen}>
            <SheetTrigger
              aria-label={createLabel}
              className="bg-accent-fill text-accent-on accent-edge mx-auto flex size-13.5 items-center justify-center rounded-pill active:bg-accent-fill-pressed focus-visible:outline-offset-3"
            >
              <Plus aria-hidden="true" className="size-7" />
            </SheetTrigger>
            <BottomSheet title={createLabel} description={navDescription}>
              <div className="mt-2 flex flex-col">
                {createActions.map((action) => (
                  <SheetRow
                    key={action.href}
                    href={action.href}
                    icon={CalendarDays}
                    onNavigate={() => setCreateOpen(false)}
                  >
                    {action.label}
                  </SheetRow>
                ))}
              </div>
            </BottomSheet>
          </Sheet>
        )}

        {after.map(tab)}

        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger
            className={cn(
              'text-muted-foreground flex h-14.5 flex-col items-center justify-center gap-0.5 rounded-pill focus-visible:outline-offset-1',
            )}
          >
            <Ellipsis aria-hidden="true" className="size-6" />
            <span className="text-micro">{moreLabel}</span>
          </SheetTrigger>
          <BottomSheet title={moreLabel} description={navDescription}>
            <div className="mt-2 flex flex-col">
              {behindMore.map((item) => (
                <SheetRow
                  key={item.href}
                  href={item.href}
                  icon={NAV_ICONS[item.id]}
                  onNavigate={() => setMoreOpen(false)}
                >
                  {item.label}
                  <Counter item={item} />
                </SheetRow>
              ))}
            </div>
            {moreFooter}
          </BottomSheet>
        </Sheet>
      </nav>
    </div>
  );
}

export function AppShell({
  bdeName,
  logoPath,
  defaultLogo,
  navItems,
  createActions,
  userMenu,
  userMenuMobile,
  moreFooter,
  footer,
  navLabel,
  navDescription,
  moreLabel,
  createLabel,
  skipLabel,
  children,
}: AppShellProps) {
  const active = useActiveHref(navItems);

  return (
    <ShellContext.Provider value={{ userMenu: userMenuMobile }}>
      <div className="bg-bg min-h-screen">
        <a
          href="#main-content"
          className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-3 focus-visible:left-3 focus-visible:z-50 focus-visible:rounded-pill focus-visible:bg-accent-fill focus-visible:px-4.5 focus-visible:py-2.5 focus-visible:text-body-strong focus-visible:text-accent-on"
        >
          {skipLabel}
        </a>

        <aside className="bg-bg fixed inset-y-0 left-0 z-20 hidden w-(--rail-width) flex-col items-center py-5.5 sm:flex">
          <Logo bdeName={bdeName} logoPath={logoPath} defaultLogo={defaultLogo} />
          <div className="mt-6 flex min-h-0 flex-1 flex-col overflow-y-auto px-1">
            <Rail items={navItems} label={navLabel} active={active} />
          </div>
          <div className="mt-4">{userMenu}</div>
        </aside>

        <div className="flex min-h-screen flex-col sm:pl-(--rail-width)">
          <main
            id="main-content"
            className="mx-auto w-full max-w-wide flex-1 px-4 pt-1.5 pb-[calc(var(--tabbar-height)+var(--tabbar-gap)+var(--space-9))] sm:px-7 sm:pt-7 sm:pb-8"
          >
            {children}
          </main>
          {footer}
        </div>

        <TabBar
          items={navItems}
          label={navLabel}
          active={active}
          createActions={createActions}
          createLabel={createLabel}
          moreLabel={moreLabel}
          moreFooter={moreFooter}
          navDescription={navDescription}
        />
      </div>
    </ShellContext.Provider>
  );
}
