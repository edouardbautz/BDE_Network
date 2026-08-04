import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export async function Footer() {
  const t = await getTranslations('nav');

  return (
    <footer className="border-t py-4">
      <div className="text-muted-foreground mx-auto max-w-5xl px-4 text-sm sm:px-6">
        <Link href="/privacy" className="hover:text-foreground underline underline-offset-4">
          {t('privacy')}
        </Link>
      </div>
    </footer>
  );
}
