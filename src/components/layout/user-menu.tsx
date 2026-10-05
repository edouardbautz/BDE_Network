import { getTranslations } from 'next-intl/server';
import { signOut } from '@/lib/auth';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LogOut, UserRound } from 'lucide-react';
import { Link } from '@/i18n/navigation';

interface UserMenuProps {
  name: string;
  login: string;
  image: string | null;
  /** The owner/pending label, or the name of the member's role. */
  roleLabel: string;
}

export async function UserMenu({ name, login, image, roleLabel }: UserMenuProps) {
  const t = await getTranslations();
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1.5 text-left outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-ring/50">
        <Avatar size="sm">
          {image ? <AvatarImage src={image} alt={name} /> : null}
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{name}</span>
          <span className="text-muted-foreground truncate text-xs">{roleLabel}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-1 font-normal">
          <span className="text-sm font-medium">{name}</span>
          <span className="text-muted-foreground text-xs">{login}</span>
          <Badge variant="secondary" className="w-fit">
            {roleLabel}
          </Badge>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/profile" />}>
          <UserRound className="size-4" />
          {t('nav.profile')}
        </DropdownMenuItem>
        <form
          action={async () => {
            'use server';
            await signOut({ redirectTo: '/' });
          }}
        >
          <DropdownMenuItem render={<button type="submit" className="w-full" />}>
            <LogOut className="size-4" />
            {t('auth.logout')}
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
