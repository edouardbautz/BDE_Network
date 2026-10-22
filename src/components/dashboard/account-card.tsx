import { getTranslations } from 'next-intl/server';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Link } from '@/i18n/navigation';
import { cardLink, cardSurface } from '@/components/galets/styles';
import { cn } from '@/lib/utils';

/** Who is signed in and with which role, with the way to the profile (spec 5.3: avatar of 44, neutral badge for the role). */
export async function AccountCard({
  name,
  initials,
  image,
  detail,
  roleLabel,
  className,
}: {
  name: string;
  initials: string;
  image: string | null;
  /** "login · campus" */
  detail: string;
  roleLabel: string;
  className?: string;
}) {
  const t = await getTranslations('dashboard.account');
  return (
    <section aria-label={name} className={cn(cardSurface, 'flex flex-col gap-3.5', className)}>
      <div className="flex items-center gap-3">
        <Avatar className="size-11 after:hidden">
          {image ? <AvatarImage src={image} alt="" /> : null}
          <AvatarFallback className="bg-surface-2 text-body text-ink font-extrabold">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col">
          <p className="text-card-title text-ink truncate">{name}</p>
          <p className="text-small text-muted-foreground truncate">{detail}</p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="bg-surface-2 text-caption text-ink inline-flex h-5.5 items-center rounded-pill px-2.5">
          {roleLabel}
        </span>
        <Link href="/profile" className={cardLink}>
          {t('profile')}
        </Link>
      </div>
    </section>
  );
}
