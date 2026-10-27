'use client';

import { useTheme } from 'next-themes';
import { useLocale, useTranslations } from 'next-intl';
import {
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/config/locales';
import { usePathname, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/** Each language is named in itself: someone who cannot read the current one must still find theirs. */
const LANGUAGE_NAMES: Record<SupportedLocale, string> = { fr: 'Français', en: 'English' };
const THEMES = ['light', 'dark', 'system'] as const;
type ThemeChoice = (typeof THEMES)[number];

/** The theme and the language, as the pieces both places that offer them need (the account menu, the "More" sheet). */
function usePreferences() {
  const { theme, setTheme } = useTheme();
  const locale = useLocale() as SupportedLocale;
  const pathname = usePathname();
  const router = useRouter();
  return {
    theme: (theme ?? 'system') as ThemeChoice,
    setTheme,
    locale,
    // Read at the moment of the click: the query is not needed to draw the menu. The path and the query are kept.
    setLocale: (next: SupportedLocale) => {
      if (next !== locale) router.replace(`${pathname}${window.location.search}`, { locale: next });
    },
  };
}

/** Theme and language as two groups of choices at the foot of the account menu (spec 5.4). */
export function AccountPreferenceGroups() {
  const t = useTranslations();
  const preferences = usePreferences();
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuLabel className="text-small text-muted-foreground">
          {t('theme.label')}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={preferences.theme} onValueChange={preferences.setTheme}>
          {THEMES.map((theme) => (
            <DropdownMenuRadioItem key={theme} value={theme} closeOnClick>
              {t(`theme.${theme}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
      <DropdownMenuGroup>
        <DropdownMenuLabel className="text-small text-muted-foreground">
          {t('language.label')}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={preferences.locale}
          onValueChange={(value) => preferences.setLocale(value as SupportedLocale)}
        >
          {SUPPORTED_LOCALES.map((locale) => (
            <DropdownMenuRadioItem key={locale} value={locale} lang={locale} closeOnClick>
              {LANGUAGE_NAMES[locale]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
    </>
  );
}

function Segmented<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: T;
  options: { value: T; label: string; lang?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span id={id} className="text-body-strong">
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={id} className="bg-surface-2 flex rounded-pill p-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            lang={option.lang}
            onClick={() => onChange(option.value)}
            className={cn(
              'text-small h-11 min-w-11 rounded-pill px-3.5 focus-visible:outline-offset-1',
              'transition-[background-color,box-shadow] duration-(--dur-base) ease-(--ease-standard)',
              option.value === value
                ? 'bg-surface elev-1 text-ink font-bold'
                : 'text-muted-foreground',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Theme and language as segmented controls, for the "More" sheet of a phone. */
export function PreferenceControls() {
  const t = useTranslations();
  const preferences = usePreferences();
  return (
    <div className="flex flex-col gap-3 py-2">
      <Segmented
        id="preference-theme"
        label={t('theme.label')}
        value={preferences.theme}
        options={THEMES.map((theme) => ({ value: theme, label: t(`theme.${theme}`) }))}
        onChange={preferences.setTheme}
      />
      <Segmented
        id="preference-language"
        label={t('language.label')}
        value={preferences.locale}
        options={SUPPORTED_LOCALES.map((locale) => ({
          value: locale,
          label: locale.toUpperCase(),
          lang: locale,
        }))}
        onChange={preferences.setLocale}
      />
    </div>
  );
}
