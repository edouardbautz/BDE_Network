'use client';

import { useState, type ComponentProps } from 'react';
import { useTranslations } from 'next-intl';
import { Markdown } from '@/components/markdown';
import { cn } from '@/lib/utils';
import { Textarea } from './field-styles';

/**
 * The description of an event: Markdown, like the form of the intra it is copied into. The text is kept as it is typed;
 * the preview beside it (below it on a phone, behind a tab) is only for the eyes and is drawn by the same reader as the
 * pages (`components/markdown.tsx`: elements, never HTML).
 */
export function DescriptionField({
  defaultValue,
  maxLength,
  ...aria
}: { defaultValue: string; maxLength: number } & Pick<
  ComponentProps<'textarea'>,
  'required' | 'aria-required' | 'aria-invalid' | 'aria-describedby'
>) {
  const t = useTranslations('events.form.markdown');
  const [text, setText] = useState(defaultValue);
  // Below `sm` there is room for one of the two at a time.
  const [tab, setTab] = useState<'write' | 'preview'>('write');

  const tabClass = (active: boolean) =>
    cn(
      'rounded-pill px-3.5 py-1.5 text-small',
      active ? 'bg-surface-3 text-foreground' : 'text-muted-foreground',
    );

  return (
    <div className="flex flex-col gap-2">
      <div role="tablist" aria-label={t('mode')} className="flex gap-1 sm:hidden">
        <button
          type="button"
          role="tab"
          id="description-tab-write"
          aria-selected={tab === 'write'}
          aria-controls="description"
          className={tabClass(tab === 'write')}
          onClick={() => setTab('write')}
        >
          {t('write')}
        </button>
        <button
          type="button"
          role="tab"
          id="description-tab-preview"
          aria-selected={tab === 'preview'}
          aria-controls="description-preview"
          className={tabClass(tab === 'preview')}
          onClick={() => setTab('preview')}
        >
          {t('preview')}
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Textarea
          id="description"
          name="description"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={maxLength}
          className={cn('min-h-40 font-mono text-small', tab === 'preview' && 'max-sm:hidden')}
          {...aria}
        />
        <div
          id="description-preview"
          role="region"
          aria-label={t('preview')}
          className={cn(
            'border-line text-body min-h-40 rounded-md border border-dashed p-3.5',
            tab === 'write' && 'max-sm:hidden',
          )}
        >
          {text.trim() === '' ? (
            <p className="text-muted-foreground">{t('empty')}</p>
          ) : (
            <Markdown source={text} />
          )}
        </div>
      </div>
      <p className="text-muted-foreground text-small">{t('help')}</p>
    </div>
  );
}
