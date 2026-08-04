import { Link } from '@/i18n/navigation';
import { NavLinks } from './nav-links';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from './user-menu';

interface NavbarProps {
  bdeName: string;
  logoPath: string;
  navItems: { href: string; label: string }[];
  user: { name: string; login: string; image: string | null; role: string };
}

export function Navbar({ bdeName, logoPath, navItems, user }: NavbarProps) {
  return (
    <header className="bg-background/95 sticky top-0 z-10 border-b backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
            {/* eslint-disable-next-line @next/next/no-img-element -- local SVG logo, next/image blocks SVG optimization by default */}
            <img src={logoPath} alt="" width={28} height={28} />
            <span className="truncate">{bdeName}</span>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <UserMenu {...user} />
          </div>
        </div>
        <NavLinks items={navItems} />
      </div>
    </header>
  );
}
