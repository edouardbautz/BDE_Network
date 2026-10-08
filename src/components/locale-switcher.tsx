'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Check, Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/config/schema';
import { usePathname, useRouter } from '@/i18n/navigation';

/** Each language is named in itself: someone who cannot read the current one must still find theirs. */
const NAMES: Record<SupportedLocale, string> = { fr: 'Français', en: 'English' };

/**
 * Switches the language of the interface, staying on the same page (the path and the query are kept). The choice
 * is also remembered by the language routing (a cookie), so the next visit starts in it.
 */
export function LocaleSwitcher() {
  const t = useTranslations('language');
  const current = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  function choose(locale: SupportedLocale) {
    if (locale === current) return;
    // Read at the moment of the click: the query is not needed to draw the menu.
    router.replace(`${pathname}${window.location.search}`, { locale });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={t('label')} />}>
        <Languages className="size-5" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {SUPPORTED_LOCALES.map((locale) => (
          <DropdownMenuItem
            key={locale}
            lang={locale}
            onClick={() => choose(locale)}
            aria-current={locale === current ? 'true' : undefined}
          >
            {NAMES[locale]}
            {locale === current && <Check className="ml-auto size-4" aria-hidden="true" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
