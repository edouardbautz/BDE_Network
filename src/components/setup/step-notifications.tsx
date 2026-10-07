'use client';

import { useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  saveNotifications,
  testNotification,
  type ActionFailure,
} from '@/app/[locale]/setup/actions';
import type { Channel, DraftView } from '@/lib/setup/draft';
import { Field, fieldError, useFailureText } from './fields';
import { StepFrame, type StepProps } from './step-frame';

const MODES: Channel[] = ['none', 'discord', 'slack', 'email'];

export function StepNotifications({
  view,
  onSaved,
  run,
  onNext,
  onBack,
}: StepProps & { view: DraftView; onSaved: (patch: Partial<DraftView>) => void }) {
  const t = useTranslations('setup.notifications');
  const locale = useLocale();
  const text = useFailureText();
  const initial = view.notifications;

  const [mode, setMode] = useState<Channel>(initial.mode);
  const [discord, setDiscord] = useState('');
  const [slack, setSlack] = useState('');
  const [smtp, setSmtp] = useState({
    host: initial.smtp.host,
    port: initial.smtp.port,
    user: initial.smtp.user,
    password: '',
    from: initial.smtp.from,
  });
  const [testTo, setTestTo] = useState('');
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [tested, setTested] = useState<'ok' | ActionFailure | null>(null);
  const [pending, start] = useTransition();
  const [testing, startTest] = useTransition();

  const payload = { mode, discordWebhook: discord, slackWebhook: slack, smtp };

  function submit() {
    start(async () => {
      const result = await run(saveNotifications(payload));
      if (!result.ok) return setFailure(result);
      setFailure(null);
      onSaved({
        notifications: {
          mode,
          hasDiscordWebhook: mode === 'discord',
          hasSlackWebhook: mode === 'slack',
          smtp: {
            host: smtp.host.trim(),
            port: smtp.port.trim(),
            user: smtp.user.trim(),
            from: smtp.from.trim(),
            hasPassword: smtp.password !== '' || initial.smtp.hasPassword,
          },
        },
      });
      onNext();
    });
  }

  function sendTest() {
    setTested(null);
    startTest(async () => {
      const result = await run(testNotification(payload, { locale, to: testTo }));
      setFailure(result.ok ? null : result.field ? result : null);
      setTested(result.ok ? 'ok' : result);
    });
  }

  const fieldText = (name: string) => fieldError(failure, name, text);
  const alreadyDiscord = initial.mode === 'discord' && initial.hasDiscordWebhook;
  const alreadySlack = initial.mode === 'slack' && initial.hasSlackWebhook;

  return (
    <StepFrame
      title={t('title')}
      description={t('description')}
      onSubmit={submit}
      onBack={onBack}
      pending={pending}
      failure={failure}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">{t('title')}</legend>
        {MODES.map((value) => (
          <label
            key={value}
            className="border-border has-checked:border-foreground has-checked:bg-muted/50 has-focus-visible:ring-ring/50 flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-focus-visible:ring-3"
          >
            <input
              type="radio"
              name="setup-notification-mode"
              value={value}
              checked={mode === value}
              onChange={() => {
                setMode(value);
                setTested(null);
              }}
              className="mt-1 size-4"
            />
            <span>
              <span className="block text-sm font-medium">{t(value)}</span>
              <span className="text-muted-foreground block text-sm">{t(`${value}Body`)}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {mode === 'discord' && (
        <Field
          id="setup-discord"
          label={t('discordLabel')}
          hint={alreadyDiscord ? t('webhookKept') : t('discordHelp')}
          error={fieldText('discordWebhook')}
        >
          <Input
            id="setup-discord"
            type="password"
            value={discord}
            onChange={(event) => setDiscord(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-xs"
            aria-invalid={failure?.field === 'discordWebhook'}
          />
        </Field>
      )}

      {mode === 'slack' && (
        <Field
          id="setup-slack"
          label={t('slackLabel')}
          hint={alreadySlack ? t('webhookKept') : t('slackHelp')}
          error={fieldText('slackWebhook')}
        >
          <Input
            id="setup-slack"
            type="password"
            value={slack}
            onChange={(event) => setSlack(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-xs"
            aria-invalid={failure?.field === 'slackWebhook'}
          />
        </Field>
      )}

      {mode === 'email' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="setup-smtp-host" label={t('smtpHost')} error={fieldText('smtpHost')}>
            <Input
              id="setup-smtp-host"
              value={smtp.host}
              onChange={(event) => setSmtp({ ...smtp, host: event.target.value })}
              autoComplete="off"
              aria-invalid={failure?.field === 'smtpHost'}
            />
          </Field>
          <Field id="setup-smtp-port" label={t('smtpPort')} error={fieldText('smtpPort')}>
            <Input
              id="setup-smtp-port"
              value={smtp.port}
              onChange={(event) => setSmtp({ ...smtp, port: event.target.value })}
              inputMode="numeric"
              autoComplete="off"
              aria-invalid={failure?.field === 'smtpPort'}
            />
          </Field>
          <Field id="setup-smtp-user" label={t('smtpUser')} error={fieldText('smtpUser')}>
            <Input
              id="setup-smtp-user"
              value={smtp.user}
              onChange={(event) => setSmtp({ ...smtp, user: event.target.value })}
              autoComplete="off"
              aria-invalid={failure?.field === 'smtpUser'}
            />
          </Field>
          <Field
            id="setup-smtp-password"
            label={t('smtpPassword')}
            hint={initial.smtp.hasPassword ? t('passwordKept') : undefined}
            error={fieldText('smtpPassword')}
          >
            <Input
              id="setup-smtp-password"
              type="password"
              value={smtp.password}
              onChange={(event) => setSmtp({ ...smtp, password: event.target.value })}
              autoComplete="off"
              aria-invalid={failure?.field === 'smtpPassword'}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field id="setup-smtp-from" label={t('smtpFrom')} error={fieldText('smtpFrom')}>
              <Input
                id="setup-smtp-from"
                type="email"
                value={smtp.from}
                onChange={(event) => setSmtp({ ...smtp, from: event.target.value })}
                autoComplete="off"
                aria-invalid={failure?.field === 'smtpFrom'}
              />
            </Field>
          </div>
        </div>
      )}

      {mode !== 'none' && (
        <div className="border-border flex flex-col gap-3 rounded-lg border p-3">
          <p className="text-sm font-medium">{t('testTitle')}</p>
          <p className="text-muted-foreground text-xs">{t('testHelp')}</p>
          {mode === 'email' && (
            <Field id="setup-test-to" label={t('testTo')} error={fieldText('testTo')}>
              <Input
                id="setup-test-to"
                type="email"
                value={testTo}
                onChange={(event) => setTestTo(event.target.value)}
                autoComplete="off"
                aria-invalid={failure?.field === 'testTo'}
              />
            </Field>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={sendTest}
            disabled={testing}
            className="w-fit"
          >
            {testing ? t('testing') : t('testButton')}
          </Button>
          {tested === 'ok' && (
            <p role="status" className="text-sm">
              {t('testOk')}
            </p>
          )}
          {tested && tested !== 'ok' && !tested.field && (
            <p role="alert" className="text-destructive text-sm">
              {tested.code === 'testFailed'
                ? t('testFailed', { detail: tested.detail ?? '' })
                : text(tested)}
            </p>
          )}
        </div>
      )}
    </StepFrame>
  );
}
