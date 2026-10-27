'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { Spinner } from '@/components/galets/spinner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { passphraseProblem } from '@/lib/backups/passphrase';

type ErrorKey = 'tooShort' | 'tooLong' | 'mismatch' | 'missing' | 'generic';

/**
 * Takes one backup away from the server, encrypted with a passphrase the owner chooses here. The passphrase is asked twice (a typo would make
 * the file unopenable), it travels in the body of one request to the platform's own route and is kept nowhere; the dialog says, before the
 * file is made, that a lost passphrase cannot be recovered by anybody.
 */
export function BackupDownload({ name, dateLabel }: { name: string; dateLabel: string }) {
  const t = useTranslations('settings.backups.download');
  const tDialog = useTranslations('confirmDialog');
  const [open, setOpen] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<ErrorKey | null>(null);
  const [busy, setBusy] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);
  const id = useId();

  const change = (next: boolean) => {
    if (busy) return;
    setOpen(next);
    if (!next) {
      setPassphrase('');
      setAgain('');
      setError(null);
    }
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const problem = passphraseProblem(passphrase);
    if (problem) return setError(problem);
    if (passphrase !== again) return setError('mismatch');
    setError(null);
    setBusy(true);
    try {
      const response = await fetch('/api/backups/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, passphrase }),
        credentials: 'same-origin',
      });
      if (!response.ok) {
        const answer = (await response.json().catch(() => ({}))) as { error?: string };
        return setError(
          answer.error === 'tooShort' || answer.error === 'tooLong' || answer.error === 'missing'
            ? answer.error
            : 'generic',
        );
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `${name}.enc`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success(t('done'));
      setOpen(false);
      setPassphrase('');
      setAgain('');
    } catch {
      setError('generic');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger
        render={
          <Button
            variant="secondary"
            size="sm"
            aria-label={t('buttonLabel', { date: dateLabel })}
          />
        }
      >
        <Download aria-hidden="true" />
        {t('button')}
      </DialogTrigger>
      <DialogContent initialFocus={firstField} closeLabel={tDialog('close')}>
        <form className="grid gap-5" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-passphrase`}>{t('passphrase')}</Label>
            <p id={`${id}-hint`} className="text-small text-muted-foreground">
              {t('passphraseHint')}
            </p>
            <Input
              id={`${id}-passphrase`}
              ref={firstField}
              type="password"
              autoComplete="new-password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              aria-describedby={`${id}-hint`}
              aria-invalid={error === 'tooShort' || error === 'tooLong' || undefined}
              disabled={busy}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-again`}>{t('confirm')}</Label>
            <Input
              id={`${id}-again`}
              type="password"
              autoComplete="new-password"
              value={again}
              onChange={(event) => setAgain(event.target.value)}
              aria-invalid={error === 'mismatch' || undefined}
              disabled={busy}
            />
          </div>

          <p className="bg-surface-2 text-body rounded-lg p-3.5">{t('warning')}</p>
          <p className="text-small text-muted-foreground">
            {t('restore', { file: `${name}.enc` })}
          </p>

          {error && (
            <p role="alert" className="text-destructive text-body">
              {t(`errors.${error}`)}
            </p>
          )}

          <DialogFooter>
            <DialogClose render={<Button variant="secondary" disabled={busy} type="button" />}>
              {tDialog('cancel')}
            </DialogClose>
            <Button
              type="submit"
              disabled={busy}
              focusableWhenDisabled
              aria-busy={busy || undefined}
            >
              {busy && <Spinner />}
              {busy ? t('working') : t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
