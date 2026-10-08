'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { ImageUp } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Field, fieldError, useFailureText } from '@/components/setup/fields';
import { removeLogo, saveLogo } from '@/app/[locale]/(app)/settings/actions';
import type { ActionFailure } from '@/app/[locale]/setup/actions';
import { LOGO_MAX_BYTES } from '@/lib/branding/image';

/** What the file input offers; the server checks the bytes again, whatever the browser says. */
const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';

/**
 * The BDE's logo: the one that comes with the platform, or an image the owner sends. It is checked on the server
 * (format read from the bytes, size, dimensions), stored in the `uploads` volume, and used at once in the menu, on
 * the login page and in the messages (Discord, Slack, e-mail).
 */
export function LogoSection({ logoPath, custom }: { logoPath: string; custom: boolean }) {
  const t = useTranslations('settings.logo');
  const tSaved = useTranslations('settings');
  const text = useFailureText();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function choose(chosen: File | null) {
    setFile(chosen);
    // The same refusals as the server's, said before sending anything.
    if (chosen && chosen.size > LOGO_MAX_BYTES) {
      setFailure({ ok: false, code: 'logoTooBig', field: 'logo' });
    } else {
      setFailure(null);
    }
  }

  function send() {
    if (!file || failure) return;
    const body = new FormData();
    body.set('logo', file);
    start(async () => {
      const result = await saveLogo(body);
      if (!result.ok) return setFailure(result);
      setFailure(null);
      setFile(null);
      if (input.current) input.current.value = '';
      toast.success(tSaved('saved'));
    });
  }

  async function reset() {
    const result = await removeLogo();
    if (result.ok) toast.success(tSaved('saved'));
    else toast.error(text(result));
  }

  return (
    <section aria-labelledby="settings-logo" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 id="settings-logo" className="text-lg font-semibold tracking-tight">
          {t('title')}
        </h2>
        <p className="text-muted-foreground text-sm">{t('description')}</p>
      </div>

      <div className="flex items-center gap-4">
        <div className="bg-muted/50 border-border flex size-20 shrink-0 items-center justify-center rounded-lg border p-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- the logo is served by /api/logo or /public: next/image would only get in the way */}
          <img
            src={preview ?? logoPath}
            alt={t('currentAlt')}
            className="size-full object-contain"
            id="settings-logo-preview"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium">
            {preview ? t('newLogo') : custom ? t('custom') : t('default')}
          </p>
          <p className="text-muted-foreground text-xs">{t('requirements')}</p>
        </div>
      </div>

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
        noValidate
      >
        <Field
          id="settings-logo-file"
          label={t('fileLabel')}
          hint={t('fileHint')}
          error={fieldError(failure, 'logo', text)}
        >
          <input
            ref={input}
            id="settings-logo-file"
            type="file"
            accept={ACCEPT}
            onChange={(event) => choose(event.target.files?.[0] ?? null)}
            aria-invalid={failure?.field === 'logo'}
            aria-describedby="settings-logo-file-hint"
            className="border-input bg-background file:bg-secondary file:text-secondary-foreground block w-full cursor-pointer rounded-lg border text-sm file:mr-3 file:cursor-pointer file:border-0 file:px-3 file:py-2 file:text-sm file:font-medium focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          />
        </Field>
        {failure && !failure.field && (
          <p role="alert" className="text-destructive text-sm">
            {text(failure)}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {custom ? (
            <ConfirmDialog
              title={t('resetTitle')}
              description={t('resetBody')}
              confirmLabel={t('resetConfirm')}
              onConfirm={reset}
              triggerVariant="outline"
            >
              {t('reset')}
            </ConfirmDialog>
          ) : (
            <span />
          )}
          <Button type="submit" disabled={pending || !file || Boolean(failure)}>
            <ImageUp data-icon="inline-start" aria-hidden="true" />
            {pending ? t('sending') : t('send')}
          </Button>
        </div>
      </form>
    </section>
  );
}
