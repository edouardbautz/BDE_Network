'use client';

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { moveRow, newTextId, type ItemRow } from '@/lib/notifications/templates/draft';
import { TEMPLATE_LIMITS } from '@/lib/notifications/templates/limits';
import type { TemplateChannel } from '@/lib/notifications/templates/types';
import type { VariableNames } from '@/lib/notifications/templates/variable-names';
import { VariableField, type VariableChoice } from './variable-field';

interface ItemsEditorProps {
  /** A prefix for the ids of the fields, unique on the page. */
  idPrefix: string;
  rows: ItemRow[];
  onRowsChange: (rows: ItemRow[], moved: boolean) => void;
  /** The tab: Discord is the only one with an emoji in front of each fact. */
  scope: 'all' | TemplateChannel;
  names: VariableNames;
  choices: VariableChoice[];
  /** What the platform calls each fact when it names it (a fact with no name has none to write). */
  hasLabel: (id: ItemRow['id']) => boolean;
  disabled?: boolean;
  /** The problems found in the facts, in words. */
  problems: string[];
}

/**
 * The facts a notification lists: which ones, in which order, under which name. Moving a fact is a pair of buttons, not a drag: it
 * works with a keyboard, a screen reader and a thumb. On a phone each row stacks (the name of the fact and its switch, then its
 * fields, then the buttons) so that nothing is squeezed.
 */
export function ItemsEditor({
  idPrefix,
  rows,
  onRowsChange,
  scope,
  names,
  choices,
  hasLabel,
  disabled,
  problems,
}: ItemsEditorProps) {
  const t = useTranslations('templates.items');
  const customCount = rows.filter((row) => row.custom).length;

  const change = (index: number, patch: Partial<ItemRow>) =>
    onRowsChange(
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
      false,
    );

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3" aria-label={t('listLabel')}>
        {rows.map((row, index) => {
          const name = row.custom ? t('freeText') : t(`names.${row.id}`);
          const base = `${idPrefix}-${row.id.replace(':', '-')}`;
          const showsLabel = !row.custom && hasLabel(row.id);
          return (
            <li
              key={row.id}
              className="bg-surface-2 flex flex-col gap-3 rounded-lg p-3 sm:p-4"
              data-testid={`item-${row.id}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Switch
                    id={`${base}-on`}
                    checked={row.enabled}
                    disabled={disabled}
                    onCheckedChange={(checked) => change(index, { enabled: checked })}
                  />
                  <Label htmlFor={`${base}-on`} className="text-body-strong">
                    {name}
                  </Label>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled || index === 0}
                    aria-label={t('moveUp', { name })}
                    onClick={() => onRowsChange(moveRow(rows, index, -1), true)}
                  >
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled || index === rows.length - 1}
                    aria-label={t('moveDown', { name })}
                    onClick={() => onRowsChange(moveRow(rows, index, 1), true)}
                  >
                    <ArrowDown aria-hidden="true" />
                  </Button>
                  {row.custom && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={disabled}
                      aria-label={t('remove', { name })}
                      onClick={() =>
                        onRowsChange(
                          rows.filter((_, i) => i !== index),
                          false,
                        )
                      }
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </div>

              {row.enabled && (
                <div className="flex flex-col gap-3">
                  {(row.custom || row.id === 'summary') && (
                    <VariableField
                      id={`${base}-text`}
                      label={row.custom ? t('textLabel') : t('summaryLabel')}
                      value={row.text ?? ''}
                      onChange={(text) => change(index, { text, ownText: true })}
                      names={names}
                      choices={choices}
                      multiline
                      formatting={row.custom}
                      disabled={disabled}
                    />
                  )}
                  {(showsLabel || (scope === 'discord' && !row.custom)) && (
                    <div className="flex flex-col gap-3 sm:flex-row">
                      {scope === 'discord' && !row.custom && (
                        <div className="flex flex-col gap-1.5 sm:w-28">
                          <Label htmlFor={`${base}-emoji`}>{t('emojiLabel')}</Label>
                          <Input
                            id={`${base}-emoji`}
                            value={row.emoji}
                            disabled={disabled}
                            autoComplete="off"
                            onChange={(event) =>
                              change(index, { emoji: event.target.value.trim(), ownEmoji: true })
                            }
                          />
                        </div>
                      )}
                      {showsLabel && (
                        <div className="flex flex-1 flex-col gap-1.5">
                          <Label htmlFor={`${base}-label`}>{t('nameLabel')}</Label>
                          <Input
                            id={`${base}-label`}
                            value={row.label}
                            disabled={disabled}
                            autoComplete="off"
                            onChange={(event) =>
                              change(index, { label: event.target.value, ownLabel: true })
                            }
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {problems.length > 0 && (
        <ul role="alert" className="text-destructive text-body flex list-disc flex-col gap-1 ps-5">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || customCount >= TEMPLATE_LIMITS.freeTexts}
          onClick={() =>
            onRowsChange(
              [
                ...rows,
                {
                  id: newTextId(rows),
                  enabled: true,
                  custom: true,
                  label: '',
                  ownLabel: false,
                  emoji: '',
                  ownEmoji: false,
                  text: '',
                  ownText: true,
                },
              ],
              true,
            )
          }
        >
          <Plus aria-hidden="true" />
          {t('addText')}
        </Button>
      </div>
    </div>
  );
}
