'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Field, fieldError, useFailureText } from '@/components/setup/fields';
import { addOwner, checkOwner, removeOwner } from '@/app/[locale]/(app)/settings/actions';
import type { ActionFailure } from '@/app/[locale]/setup/actions';

/**
 * The owners: the one part of the settings that is not a form to save. Adding an owner gives somebody every right
 * and taking one away removes them, both at once, so each goes through a confirmation, and the page never offers
 * to remove oneself (the server refuses it too).
 */
export function OwnersSection({ owners, actorLogin }: { owners: string[]; actorLogin: string }) {
  const t = useTranslations('settings.owners');
  const tSaved = useTranslations('settings');
  const text = useFailureText();
  const [login, setLogin] = useState('');
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  /** A login that passed the check and waits for the owner's confirmation. */
  const [candidate, setCandidate] = useState<{
    login: string;
    status: 'exists' | 'unknown';
  } | null>(null);
  const [checking, startChecking] = useTransition();

  function check() {
    if (login.trim() === '') return;
    startChecking(async () => {
      const result = await checkOwner({ login });
      if (!result.ok) return setFailure(result);
      setFailure(null);
      setCandidate({ login: result.login, status: result.status });
    });
  }

  async function confirmAdd() {
    if (!candidate) return;
    const result = await addOwner({
      login: candidate.login,
      acceptUnverified: candidate.status === 'unknown',
    });
    if (result.ok) {
      toast.success(tSaved('saved'));
      setLogin('');
    } else {
      toast.error(text(result));
    }
    setCandidate(null);
  }

  async function confirmRemove(who: string) {
    const result = await removeOwner({ login: who });
    if (result.ok) toast.success(tSaved('saved'));
    else toast.error(text(result));
  }

  return (
    <section aria-labelledby="settings-owners" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 id="settings-owners" className="text-lg font-semibold tracking-tight">
          {t('title')}
        </h2>
        <p className="text-muted-foreground text-sm">{t('description')}</p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">{t('listTitle')}</p>
        <ul className="border-border divide-border divide-y rounded-lg border">
          {owners.map((owner) => {
            const isYou = owner.toLowerCase() === actorLogin.toLowerCase();
            return (
              <li key={owner} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="font-mono text-sm">
                  {owner}
                  {isYou && (
                    <span className="text-muted-foreground ml-2 font-sans text-xs">
                      ({t('you')})
                    </span>
                  )}
                </span>
                {isYou ? (
                  <span className="text-muted-foreground text-xs">{t('cannotRemoveSelf')}</span>
                ) : (
                  <ConfirmDialog
                    title={t('removeTitle', { login: owner })}
                    description={t('removeBody')}
                    confirmLabel={t('removeConfirm')}
                    onConfirm={() => confirmRemove(owner)}
                    triggerVariant="ghost"
                    triggerSize="icon-sm"
                    triggerLabel={t('remove', { login: owner })}
                  >
                    <X aria-hidden="true" />
                  </ConfirmDialog>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <form
        className="flex flex-col gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          check();
        }}
        noValidate
      >
        <Field
          id="settings-owner-login"
          label={t('loginLabel')}
          error={fieldError(failure, 'login', text)}
        >
          <div className="flex gap-2">
            <Input
              id="settings-owner-login"
              value={login}
              onChange={(event) => setLogin(event.target.value)}
              placeholder={t('loginPlaceholder')}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={failure?.field === 'login'}
            />
            <Button type="submit" variant="outline" disabled={checking || login.trim() === ''}>
              {checking ? t('checking') : t('add')}
            </Button>
          </div>
        </Field>
        {failure && !failure.field && (
          <p role="alert" className="text-destructive text-sm">
            {text(failure)}
          </p>
        )}
      </form>

      <ConfirmDialog
        open={candidate !== null}
        onOpenChange={(open) => {
          if (!open) setCandidate(null);
        }}
        title={t('addTitle', { login: candidate?.login ?? '' })}
        description={candidate?.status === 'unknown' ? t('addBodyUnverified') : t('addBody')}
        confirmLabel={t('addConfirm')}
        tone="default"
        onConfirm={confirmAdd}
      />
    </section>
  );
}
