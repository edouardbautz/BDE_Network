import { getTranslations } from 'next-intl/server';
import { signOut } from '@/lib/auth';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LogOut, UserRound } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { initialsOf } from '@/lib/initials';
import { cn } from '@/lib/utils';
import { AccountPreferenceGroups, PreferenceControls } from './account-preferences';

interface UserMenuProps {
  name: string;
  login: string;
  image: string | null;
  /** The owner/pending label, or the name of the member's role. */
  roleLabel: string;
  /** At the foot of the rail (the menu opens beside it) or in the header of a page on a phone (it opens under it). */
  placement: 'rail' | 'header';
}

async function signOutAction() {
  'use server';
  await signOut({ redirectTo: '/' });
}

/** The account menu (spec 5.4): the avatar of the signed-in person, which opens profile, theme, language and sign-out. */
export async function UserMenu({ name, login, image, roleLabel, placement }: UserMenuProps) {
  const t = await getTranslations();
  const initials = initialsOf(name);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={name}
        className={cn(
          'bg-surface elev-1 shrink-0 rounded-pill focus-visible:outline-offset-2',
          placement === 'rail' ? 'size-10.5' : 'size-11',
        )}
      >
        <Avatar className="size-full after:hidden">
          {image ? <AvatarImage src={image} alt="" /> : null}
          <AvatarFallback className="bg-surface-2 text-small text-ink font-extrabold">
            {initials}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side={placement === 'rail' ? 'right' : 'bottom'}
        className="w-60 rounded-lg p-1.5"
      >
        {/* A menu label belongs to a group: Base UI throws when the menu opens if it does not (it did, for everybody). */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-1 font-normal">
            <span className="text-body-strong text-ink">{name}</span>
            <span className="text-small text-muted-foreground">{login}</span>
            <Badge variant="secondary" className="w-fit">
              {roleLabel}
            </Badge>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/profile" />}>
          <UserRound className="size-4" />
          {t('nav.profile')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <AccountPreferenceGroups />
        <DropdownMenuSeparator />
        <form action={signOutAction}>
          <DropdownMenuItem render={<button type="submit" className="w-full" />}>
            <LogOut className="size-4" />
            {t('auth.logout')}
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The account part of the "More" sheet of a phone: the same choices as the menu, laid out as rows. */
export async function AccountSheetContent() {
  const t = await getTranslations();
  return (
    <div className="border-line mt-3 flex flex-col gap-1 border-t pt-3">
      <Link
        href="/profile"
        className="text-body-strong hover:bg-surface-2 flex min-h-12 items-center gap-3 rounded-lg px-2 focus-visible:outline-offset-1"
      >
        <span className="bg-accent-soft text-accent-ink flex size-9 shrink-0 items-center justify-center rounded-sm">
          <UserRound aria-hidden="true" className="size-5" />
        </span>
        {t('nav.profile')}
      </Link>
      <PreferenceControls />
      <form action={signOutAction}>
        <button
          type="submit"
          className="text-body-strong hover:bg-surface-2 flex min-h-12 w-full items-center gap-3 rounded-lg px-2 focus-visible:outline-offset-1"
        >
          <span className="bg-surface-2 text-ink flex size-9 shrink-0 items-center justify-center rounded-sm">
            <LogOut aria-hidden="true" className="size-5" />
          </span>
          {t('auth.logout')}
        </button>
      </form>
    </div>
  );
}
