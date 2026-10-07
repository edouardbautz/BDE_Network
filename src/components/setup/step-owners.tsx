'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { checkOwner, saveOwners, type ActionFailure } from '@/app/[locale]/setup/actions';
import type { DraftView } from '@/lib/setup/draft';
import { Field, fieldError, useFailureText } from './fields';
import { StepFrame, type StepProps } from './step-frame';

export function StepOwners({
  view,
  onSaved,
  run,
  onNext,
  onBack,
}: StepProps & { view: DraftView; onSaved: (patch: Partial<DraftView>) => void }) {
  const t = useTranslations('setup.owners');
  const text = useFailureText();
  const [owners, setOwners] = useState<string[]>(view.owners);
  const [login, setLogin] = useState('');
  /** A login 42 could not confirm: asks before adding it. */
  const [unverified, setUnverified] = useState<string | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [checking, startChecking] = useTransition();
  const [pending, start] = useTransition();

  function addChecked(value: string) {
    setOwners((current) => (current.includes(value) ? current : [...current, value]));
    setLogin('');
    setUnverified(null);
  }

  function add() {
    if (login.trim() === '') return;
    startChecking(async () => {
      const result = await run(checkOwner({ login }));
      if (!result.ok) {
        setUnverified(null);
        return setFailure(result);
      }
      setFailure(null);
      if (result.status === 'unknown') return setUnverified(result.login);
      addChecked(result.login);
    });
  }

  function submit() {
    if (owners.length === 0) {
      return setFailure({ ok: false, code: 'noOwner', field: 'login' });
    }
    start(async () => {
      const result = await run(saveOwners({ owners }));
      if (!result.ok) return setFailure(result);
      setFailure(null);
      onSaved({ owners });
      onNext();
    });
  }

  return (
    <StepFrame
      title={t('title')}
      description={t('description')}
      onSubmit={submit}
      onBack={onBack}
      pending={pending}
      failure={failure}
    >
      <Field id="setup-login" label={t('loginLabel')} error={fieldError(failure, 'login', text)}>
        <div className="flex gap-2">
          <Input
            id="setup-login"
            value={login}
            onChange={(event) => setLogin(event.target.value)}
            onKeyDown={(event) => {
              // Enter adds the login; the step is submitted with the button.
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              }
            }}
            placeholder={t('loginPlaceholder')}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            aria-invalid={failure?.field === 'login'}
          />
          <Button
            type="button"
            variant="outline"
            onClick={add}
            disabled={checking || !login.trim()}
          >
            {checking ? t('checking') : t('add')}
          </Button>
        </div>
      </Field>

      {unverified && (
        <div role="alert" className="bg-muted flex flex-col gap-2 rounded-lg p-3 text-sm">
          <p className="font-medium">{t('unknownTitle')}</p>
          <p>{t('unknownBody')}</p>
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() => addChecked(unverified)}
          >
            {t('addAnyway')} ({unverified})
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">{t('listTitle')}</p>
        {owners.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('empty')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {owners.map((owner) => (
              <li
                key={owner}
                className="bg-muted flex items-center gap-1 rounded-full py-0.5 pr-1 pl-3 font-mono text-sm"
              >
                {owner}
                <button
                  type="button"
                  onClick={() => setOwners(owners.filter((other) => other !== owner))}
                  aria-label={t('remove', { login: owner })}
                  className="hover:bg-background focus-visible:ring-ring/50 rounded-full p-1 outline-none focus-visible:ring-3"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-muted-foreground text-xs">{t('hint')}</p>
      </div>
    </StepFrame>
  );
}
