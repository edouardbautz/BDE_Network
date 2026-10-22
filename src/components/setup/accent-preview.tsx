'use client';

import { useTranslations } from 'next-intl';
import { buildAccentStyle, deriveAccent } from '@/lib/color';
import { cn } from '@/lib/utils';

/**
 * What the colour a BDE chose will look like (docs/design.md, "Accent"): a button, a link and the card of the accent, in the light
 * and in the dark theme, each in a box that forces its theme and carries the tokens the algorithm derives from that colour. When the
 * colour had to be darkened to carry white text, it says so.
 */
export function AccentPreview({ color, name }: { color: string; name: string }) {
  const t = useTranslations('setup.identity');
  const tTheme = useTranslations('theme');
  const style = buildAccentStyle(color);
  const adjusted = deriveAccent(color, 'light').adjusted || deriveAccent(color, 'dark').adjusted;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-3 sm:grid-cols-2">
        {(['light', 'dark'] as const).map((theme) => (
          <div
            key={theme}
            role="group"
            aria-label={`${t('preview')}: ${tTheme(theme)}`}
            className={cn(theme, 'bg-bg text-ink flex flex-col gap-3 rounded-lg p-3.5')}
            style={style}
          >
            <span className="text-small text-muted-foreground">{tTheme(theme)}</span>
            <div className="flex flex-wrap items-center gap-3">
              <span className="bg-accent-fill text-accent-on accent-edge text-body-strong inline-flex h-10 items-center rounded-pill px-4.5">
                {t('previewButton')}
              </span>
              <span className="text-accent-ink text-body-strong underline underline-offset-3">
                {t('previewLink')}
              </span>
            </div>
            <div className="bg-accent-fill text-accent-on accent-edge flex flex-col gap-1 rounded-xl p-3.5">
              <span className="bg-accent-on-soft text-caption w-fit rounded-pill px-2.5 py-0.5 font-extrabold">
                {t('previewCard')}
              </span>
              <span className="text-card-title font-extrabold">
                {name.trim() || t('namePlaceholder')}
              </span>
            </div>
          </div>
        ))}
      </div>
      {adjusted && (
        <p role="status" className="text-small text-muted-foreground">
          {t('adjusted')}
        </p>
      )}
    </div>
  );
}
