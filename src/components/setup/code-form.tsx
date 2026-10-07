'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { submitCode, type ActionFailure } from '@/app/[locale]/setup/actions';
import { Field, useFailureText } from './fields';

/** The first screen: nothing of the platform is shown until the code the server wrote to its logs is given. */
export function CodeForm() {
  const t = useTranslations('setup.code');
  const text = useFailureText();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, start] = useTransition();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || code.trim() === '') return;
    start(async () => {
      const result = await submitCode(code);
      if (!result.ok) {
        setCode('');
        return setFailure(result);
      }
      setFailure(null);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full">
          <KeyRound className="size-5" aria-hidden="true" />
        </div>
        <h2 className="text-lg font-semibold tracking-tight">{t('title')}</h2>
        <p className="text-muted-foreground text-sm">{t('description')}</p>
      </div>

      <Field id="setup-code" label={t('label')} error={failure ? text(failure) : null}>
        <Input
          id="setup-code"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder={t('placeholder')}
          autoFocus
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={20}
          className="text-center font-mono text-lg tracking-widest"
          aria-invalid={failure !== null}
          aria-describedby={failure ? 'setup-code-error' : undefined}
        />
      </Field>

      <Button type="submit" disabled={pending || code.trim() === ''}>
        {pending ? t('checking') : t('submit')}
      </Button>

      <div className="bg-muted/50 flex flex-col gap-2 rounded-lg p-3 text-sm">
        <p className="font-medium">{t('whereTitle')}</p>
        <ul className="text-muted-foreground list-disc space-y-1 pl-5">
          <li>{t('whereTerminal')}</li>
          <li>{t('whereLogs')}</li>
          <li>{t('whereChanges')}</li>
        </ul>
      </div>
    </form>
  );
}
