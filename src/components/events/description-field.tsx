'use client';

import {
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Bold, Heading2, Italic, Link as LinkIcon, List, ListOrdered } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Markdown } from '@/components/markdown';
import { Button } from '@/components/ui/button';
import { applyFormat, difference, shortcutFormat, type Format } from '@/lib/markdown-edit';
import { cn } from '@/lib/utils';
import { Textarea } from './field-styles';

/**
 * The description of an event. The text is Markdown and stays Markdown (it is copied as it is), but nobody has to know that: a bar of
 * buttons above the field (bold, italic, a bulleted list, a numbered list, a link, a heading) puts the marks in, and Ctrl/Cmd + B and I
 * do the same from the keyboard. The preview beside it (a tab on a phone, where there is room for one of the two) is only for the eyes
 * and is drawn by the same reader as the pages (`components/markdown.tsx`: elements, never HTML).
 *
 * What a button does is `lib/markdown-edit.ts` (pure, tested). It is typed into the field with `insertText`, which a browser keeps in the
 * undo history of the field: Ctrl+Z takes a button's work back. Where a browser has no such command the text is set instead.
 */

const TOOLS: readonly { format: Format; icon: typeof Bold; label: string; shortcut?: string }[] = [
  { format: 'bold', icon: Bold, label: 'bold', shortcut: 'B' },
  { format: 'italic', icon: Italic, label: 'italic', shortcut: 'I' },
  { format: 'heading', icon: Heading2, label: 'heading' },
  { format: 'bullets', icon: List, label: 'bullets' },
  { format: 'numbers', icon: ListOrdered, label: 'numbers' },
  { format: 'link', icon: LinkIcon, label: 'link' },
];

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
  const field = useRef<HTMLTextAreaElement>(null);
  // The selection to give back after a change that went through the state (no `insertText` there).
  const selection = useRef<[number, number] | null>(null);
  // The one button of the bar that Tab reaches; the arrows move it (a bar is one stop of the keyboard, not six).
  const [current, setCurrent] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  useLayoutEffect(() => {
    const range = selection.current;
    if (range && field.current) {
      field.current.setSelectionRange(range[0], range[1]);
      selection.current = null;
    }
  });

  const apply = (format: Format) => {
    const area = field.current;
    if (!area) return;
    const placeholders = {
      bold: t('placeholder.bold'),
      italic: t('placeholder.italic'),
      item: t('placeholder.item'),
      heading: t('placeholder.heading'),
      link: t('placeholder.link'),
    };
    const edit = applyFormat(
      format,
      area.value,
      area.selectionStart,
      area.selectionEnd,
      placeholders,
      maxLength,
    );
    if (!edit) return;
    area.focus();
    const change = difference(area.value, edit.text);
    area.setSelectionRange(change.from, change.to);
    const typed =
      typeof document.execCommand === 'function' &&
      (change.insert === ''
        ? document.execCommand('delete')
        : document.execCommand('insertText', false, change.insert));
    if (typed && area.value === edit.text) {
      area.setSelectionRange(edit.start, edit.end);
    } else {
      selection.current = [edit.start, edit.end];
      setText(edit.text);
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const format = shortcutFormat(event);
    if (!format) return;
    event.preventDefault();
    apply(format);
  };

  const onBarKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const last = TOOLS.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? (current + 1) % TOOLS.length
        : event.key === 'ArrowLeft'
          ? (current + last) % TOOLS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    setCurrent(next);
    buttons.current[next]?.focus();
  };

  const tabClass = (active: boolean) =>
    cn(
      'rounded-pill px-3.5 py-1.5 text-small max-sm:min-h-11',
      active ? 'bg-surface-3 text-foreground' : 'text-muted-foreground',
    );
  const describedBy = [aria['aria-describedby'], 'description-help'].filter(Boolean).join(' ');

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
        <div className={cn('flex min-w-0 flex-col gap-2', tab === 'preview' && 'max-sm:hidden')}>
          <div
            role="toolbar"
            aria-label={t('toolbar.label')}
            aria-controls="description"
            className="flex flex-wrap gap-1"
            onKeyDown={onBarKeyDown}
          >
            {TOOLS.map((tool, index) => {
              const Icon = tool.icon;
              const name = t(`toolbar.${tool.label}`);
              return (
                <Button
                  key={tool.format}
                  ref={(node: HTMLButtonElement | null) => {
                    buttons.current[index] = node;
                  }}
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={name}
                  title={
                    tool.shortcut
                      ? `${name} (${t('toolbar.shortcut', { key: tool.shortcut })})`
                      : name
                  }
                  aria-keyshortcuts={
                    tool.shortcut ? `Control+${tool.shortcut} Meta+${tool.shortcut}` : undefined
                  }
                  tabIndex={index === current ? 0 : -1}
                  onFocus={() => setCurrent(index)}
                  onClick={() => apply(tool.format)}
                >
                  <Icon aria-hidden="true" />
                </Button>
              );
            })}
          </div>
          <Textarea
            ref={field}
            id="description"
            name="description"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            maxLength={maxLength}
            className="min-h-40 font-mono text-small"
            {...aria}
            aria-describedby={describedBy}
          />
        </div>
        <div className={cn('flex min-w-0 flex-col gap-2', tab === 'write' && 'max-sm:hidden')}>
          <p
            className="text-muted-foreground hidden min-h-9.5 items-center text-small sm:flex"
            aria-hidden="true"
          >
            {t('preview')}
          </p>
          <div
            id="description-preview"
            role="region"
            aria-label={t('preview')}
            className="border-line text-body min-h-40 rounded-md border border-dashed p-3.5"
          >
            {text.trim() === '' ? (
              <p className="text-muted-foreground">{t('empty')}</p>
            ) : (
              <Markdown source={text} />
            )}
          </div>
        </div>
      </div>
      <p id="description-help" className="text-muted-foreground text-small">
        {t('help')}
      </p>
    </div>
  );
}
