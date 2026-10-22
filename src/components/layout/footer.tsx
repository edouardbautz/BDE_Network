import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export async function Footer() {
  const t = await getTranslations('nav');

  return (
    <footer className="pb-[calc(var(--tabbar-height)+var(--tabbar-gap)+var(--space-9))] sm:pb-6">
      <div className="text-small text-muted-foreground mx-auto w-full max-w-wide px-4 sm:px-7">
        <Link
          href="/privacy"
          className="hover:text-ink rounded-xs underline underline-offset-4 focus-visible:outline-offset-2"
        >
          {t('privacy')}
        </Link>
      </div>
    </footer>
  );
}
