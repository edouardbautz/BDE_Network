'use client';

import { useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { NativeSelect } from '@/components/events/field-styles';
import { Field, fieldError, useFailureText } from '@/components/setup/fields';
import { saveEvents } from '@/app/[locale]/(app)/settings/actions';
import type { ActionFailure } from '@/app/[locale]/setup/actions';
import type { EventsSettingsView } from '@/lib/settings/view';

/** Colours offered to a new category, in turn; the picker accepts any. */
const PALETTE = ['#db2777', '#16a34a', '#ea580c', '#2563eb', '#7c3aed', '#0f766e', '#ca8a04'];
const MAX_CATEGORIES = 30;

interface Row {
  /** A local identifier, for React: a category's `key` is the server's and a new one has none. */
  id: number;
  key?: string;
  label: string;
  color: string;
  removed: boolean;
  /** Where the events of a removed category move to (the `key` of a category that stays). */
  target?: string;
}

/**
 * The categories of the events module and the hour of the reminder. A category is renamed or recoloured freely
 * (its key, which events refer to, never changes). Taking one out is staged until the owner saves, and a category
 * that events still use asks where they go: nothing is ever left without a category.
 */
export function EventsSection({ settings }: { settings: EventsSettingsView }) {
  const t = useTranslations('settings.events');
  const tSaved = useTranslations('settings');
  const tNav = useTranslations('setup.nav');
  const text = useFailureText();
  const nextId = useRef(settings.categories.length);
  const [rows, setRows] = useState<Row[]>(() =>
    settings.categories.map((category, index) => ({ ...category, id: index, removed: false })),
  );
  const [hour, setHour] = useState(String(settings.reminderHour));
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  const active = rows.filter((row) => !row.removed);
  const removed = rows.filter((row) => row.removed && row.key !== undefined);
  const keptKeys = active.filter((row) => row.key !== undefined);
  const used = (row: Row) => (row.key ? (settings.usage[row.key] ?? 0) : 0);

  const update = (id: number, patch: Partial<Row>) =>
    setRows((all) => all.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  function add() {
    const color = PALETTE[rows.length % PALETTE.length] ?? PALETTE[0] ?? '#0f766e';
    setRows((all) => [...all, { id: nextId.current++, label: '', color, removed: false }]);
  }

  function take(row: Row) {
    // A category that was never saved just disappears; a saved one waits for the owner's confirmation.
    if (row.key === undefined) setRows((all) => all.filter((r) => r.id !== row.id));
    else update(row.id, { removed: true, target: keptKeys.find((r) => r.id !== row.id)?.key });
  }

  function save() {
    start(async () => {
      const reassign: Record<string, string> = {};
      for (const row of removed) {
        const target = row.target ?? keptKeys[0]?.key;
        if (row.key && used(row) > 0 && target) reassign[row.key] = target;
      }
      const result = await saveEvents({
        categories: active.map(({ key, label, color }) => ({ key, label, color })),
        reminderHour: Number(hour),
        reassign,
      });
      if (!result.ok) return setFailure(result);
      setFailure(null);
      toast.success(tSaved('saved'));
    });
  }

  function submit() {
    if (removed.length > 0) setConfirming(true);
    else save();
  }

  const movedEvents = removed.reduce((sum, row) => sum + used(row), 0);

  return (
    <section aria-labelledby="settings-events" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 id="settings-events" className="text-lg font-semibold tracking-tight">
          {t('title')}
        </h2>
        <p className="text-muted-foreground text-sm">{t('description')}</p>
      </div>

      <form
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending) submit();
        }}
        noValidate
      >
        <div className="flex flex-col gap-2">
          <p id="settings-events-categories" className="text-sm font-medium">
            {t('categories')}
          </p>
          <ul aria-labelledby="settings-events-categories" className="flex flex-col gap-2">
            {active.map((row, index) => (
              <li key={row.id} className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label={t('colorOf', { label: row.label || t('newCategory') })}
                  value={/^#[0-9a-f]{6}$/i.test(row.color) ? row.color : '#0f766e'}
                  onChange={(event) => update(row.id, { color: event.target.value })}
                  className="border-input size-9 shrink-0 cursor-pointer rounded-lg border bg-transparent p-0.5"
                />
                <Input
                  value={row.label}
                  onChange={(event) => update(row.id, { label: event.target.value })}
                  placeholder={t('labelPlaceholder')}
                  aria-label={t('labelOf', { position: index + 1 })}
                  maxLength={40}
                  autoComplete="off"
                />
                {used(row) > 0 && (
                  <span className="text-muted-foreground shrink-0 text-xs whitespace-nowrap">
                    {t('usage', { count: used(row) })}
                  </span>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={active.length <= 1}
                  onClick={() => take(row)}
                  aria-label={t('remove', { label: row.label || t('newCategory') })}
                >
                  <X aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
          {active.length <= 1 && <p className="text-muted-foreground text-xs">{t('keepOne')}</p>}
          {failure?.field === 'categories' && (
            <p role="alert" className="text-destructive text-sm">
              {text(failure)}
            </p>
          )}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={add}
              disabled={active.length >= MAX_CATEGORIES}
            >
              <Plus data-icon="inline-start" aria-hidden="true" />
              {t('add')}
            </Button>
          </div>
        </div>

        {removed.length > 0 && (
          <div className="border-border flex flex-col gap-3 rounded-lg border border-dashed p-3">
            <p className="text-sm font-medium">{t('pendingTitle')}</p>
            <ul className="flex flex-col gap-3">
              {removed.map((row) => (
                <li key={row.id} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm line-through">{row.label}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => update(row.id, { removed: false, target: undefined })}
                    >
                      <Undo2 data-icon="inline-start" aria-hidden="true" />
                      {t('keep')}
                    </Button>
                  </div>
                  {used(row) > 0 && (
                    <Field
                      id={`settings-events-target-${row.id}`}
                      label={t('moveTo', { count: used(row) })}
                    >
                      <NativeSelect
                        id={`settings-events-target-${row.id}`}
                        value={row.target ?? ''}
                        onChange={(event) => update(row.id, { target: event.target.value })}
                      >
                        {keptKeys.map((kept) => (
                          <option key={kept.id} value={kept.key}>
                            {kept.label || t('newCategory')}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <Field
          id="settings-events-hour"
          label={t('reminderLabel')}
          hint={t('reminderHelp', { timezone: settings.timezone })}
          error={fieldError(failure, 'reminderHour', text)}
        >
          <NativeSelect
            id="settings-events-hour"
            value={hour}
            onChange={(event) => setHour(event.target.value)}
            className="w-32"
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </NativeSelect>
        </Field>

        {failure && !failure.field && (
          <p role="alert" className="text-destructive text-sm">
            {text(failure)}
          </p>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? tNav('saving') : tNav('save')}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('removeTitle', { count: removed.length })}
        description={
          movedEvents > 0
            ? t('removeBodyMoved', { count: movedEvents })
            : t('removeBodyUnused', { count: removed.length })
        }
        confirmLabel={t('removeConfirm')}
        onConfirm={save}
      />
    </section>
  );
}
