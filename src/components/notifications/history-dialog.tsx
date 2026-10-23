'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  loadHistory,
  restoreVersion,
  type HistoryEntry,
} from '@/app/[locale]/(app)/notifications/actions';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { TemplateScope } from '@/lib/notifications/templates/schema';
import type { TemplateType } from '@/lib/notifications/templates/types';
import { isActionTarget } from '@/lib/action-target';
import { toast } from 'sonner';

interface HistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: TemplateType;
  scope: TemplateScope;
  scopeName: string;
  /** The version the editor is on. */
  currentVersion: number;
  /** What is typed has not been saved: restoring would lose it. */
  dirty: boolean;
}

/**
 * The versions the BDE kept for one tab, newest first, each restorable. A restore is a new version (nothing is lost, the audit log
 * says who did it) and the template restored is checked again like any other before it is accepted.
 */
export function HistoryDialog({
  open,
  onOpenChange,
  type,
  scope,
  scopeName,
  currentVersion,
  dirty,
}: HistoryDialogProps) {
  const t = useTranslations('templates.history');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{t('title', { scope: scopeName })}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <HistoryList type={type} scope={scope} currentVersion={currentVersion} dirty={dirty} />

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The versions, loaded when the dialog opens (the dialog's content only exists while it is open). */
function HistoryList({
  type,
  scope,
  currentVersion,
  dirty,
}: Pick<HistoryDialogProps, 'type' | 'scope' | 'currentVersion' | 'dirty'>) {
  const t = useTranslations('templates.history');
  const tCodes = useTranslations('templates.codes');
  const format = useFormatter();
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    loadHistory({ type, scope })
      .then((result) => current && setEntries(result.entries))
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [type, scope]);

  return (
    <>
      {failed && (
        <p role="alert" className="text-destructive text-body">
          {t('failed')}
        </p>
      )}
      {!failed && entries === null && (
        <p role="status" className="text-muted-foreground text-body">
          {t('loading')}
        </p>
      )}
      {entries && entries.length === 0 && (
        <p className="text-muted-foreground text-body">{t('empty')}</p>
      )}
      {entries && entries.length > 0 && (
        <ul
          className="flex max-h-[50dvh] flex-col gap-2 overflow-y-auto"
          aria-label={t('listLabel')}
        >
          {entries.map((entry) => (
            <li
              key={entry.version}
              className="bg-surface-2 flex flex-wrap items-center justify-between gap-3 rounded-lg p-3"
            >
              <div className="min-w-0">
                <div className="text-body-strong flex flex-wrap items-center gap-2">
                  {t('version', { version: entry.version })}
                  {entry.version === currentVersion && <Badge>{t('current')}</Badge>}
                </div>
                <div className="text-muted-foreground text-small">
                  {t(`actions.${entry.action}`)}
                  {entry.restoredFrom ? ` ${entry.restoredFrom}` : ''} · {entry.authorLogin} ·{' '}
                  {format.dateTime(new Date(entry.createdAt), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </div>
                {entry.reset && (
                  <div className="text-muted-foreground text-small">{t('resetEntry')}</div>
                )}
              </div>
              {entry.version !== currentVersion && !entry.reset && (
                <ConfirmDialog
                  tone="default"
                  triggerVariant="outline"
                  triggerSize="sm"
                  triggerLabel={t('restoreLabel', { version: entry.version })}
                  title={t('restoreTitle', { version: entry.version })}
                  description={dirty ? t('restoreDirty') : t('restoreDescription')}
                  confirmLabel={t('restore')}
                  onConfirm={async () => {
                    const result = await restoreVersion({
                      type,
                      scope,
                      version: entry.version,
                    });
                    if (isActionTarget(result)) return result;
                    if (!result.ok)
                      toast.error(
                        tCodes.has(result.code) ? tCodes(result.code) : tCodes('unknown'),
                      );
                  }}
                >
                  {t('restore')}
                </ConfirmDialog>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
