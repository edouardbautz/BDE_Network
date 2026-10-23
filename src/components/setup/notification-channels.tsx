'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ActionFailure } from '@/app/[locale]/setup/actions';
import type { NotificationChannel } from '@/config/schema';
import { Field, fieldError, useFailureText } from './fields';

export interface SmtpForm {
  host: string;
  port: string;
  user: string;
  password: string;
  from: string;
}

/** What the person typed for each channel (never what was saved: the page does not get a secret back). */
export interface TypedCredentials {
  discord: string;
  slack: string;
  smtp: SmtpForm;
  /** The address the test e-mail goes to. */
  testTo: string;
}

export type TestState = 'ok' | ActionFailure | null;

/** What a channel panel needs to know about its channel. */
export interface ChannelState {
  configured: boolean;
  /** Something is saved for it (the page only knows whether, not what). */
  saved: boolean;
  /** Its removal is waiting for the Save button. */
  removed: boolean;
  hasPassword?: boolean;
}

/**
 * One panel per channel: its name, whether it is configured, what it needs, its test and its removal. A test sends the real card
 * (or e-mail) of the channel with an invented event, through what is typed here, whether saved or not; the other channels are
 * not touched. Removing a channel only marks it: nothing is forgotten before the Save button.
 */
export function ChannelPanel({
  channel,
  state,
  testing,
  test,
  onTest,
  onRemove,
  onUndoRemove,
  children,
  testToField,
}: {
  channel: NotificationChannel;
  state: ChannelState;
  testing: boolean;
  test: TestState;
  onTest: () => void;
  onRemove: () => void;
  onUndoRemove: () => void;
  children: ReactNode;
  /** E-mail only: where the test is sent. */
  testToField?: ReactNode;
}) {
  const t = useTranslations('setup.notifications');
  const text = useFailureText();
  const name = t(`channelNames.${channel}`);
  const headingId = `setup-channel-${channel}`;

  return (
    <section
      aria-labelledby={headingId}
      className="bg-surface-2 flex flex-col gap-3 rounded-lg p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={headingId} className="text-body-strong">
          {name}
        </h4>
        <Badge variant={state.configured ? 'success' : 'outline'}>
          {t(state.configured ? 'configured' : 'notConfigured')}
        </Badge>
      </div>
      <p className="text-muted-foreground text-body">{t(`channelBodies.${channel}`)}</p>

      {state.removed ? (
        <p className="text-body" role="status">
          {t('removalPending', { channel: name })}
        </p>
      ) : (
        children
      )}

      {testToField}

      <div className="flex flex-wrap items-center gap-2">
        {!state.removed && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onTest}
            disabled={testing || !state.configured}
          >
            {testing ? t('testing') : t('testButton', { channel: name })}
          </Button>
        )}
        {state.removed ? (
          <Button type="button" variant="ghost" size="sm" onClick={onUndoRemove}>
            {t('undoRemoval', { channel: name })}
          </Button>
        ) : (
          state.saved && (
            <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
              {t('removeChannel', { channel: name })}
            </Button>
          )
        )}
      </div>

      {test === 'ok' && (
        <p role="status" className="text-body">
          {t('testOk', { channel: name })}
        </p>
      )}
      {test && test !== 'ok' && !test.field && (
        <p role="alert" className="text-destructive text-body">
          {test.code === 'testFailed' ? t('testFailed', { detail: test.detail ?? '' }) : text(test)}
        </p>
      )}
    </section>
  );
}

/** A webhook address: typed here, never shown back. */
export function WebhookField({
  channel,
  value,
  onChange,
  saved,
  failure,
}: {
  channel: 'discord' | 'slack';
  value: string;
  onChange: (value: string) => void;
  saved: boolean;
  failure: ActionFailure | null;
}) {
  const t = useTranslations('setup.notifications');
  const text = useFailureText();
  const field = channel === 'discord' ? 'discordWebhook' : 'slackWebhook';
  const id = `setup-${channel}`;
  return (
    <Field
      id={id}
      label={t(`${channel}Label`)}
      hint={saved ? t('webhookKept') : t(`${channel}Help`)}
      error={fieldError(failure, field, text)}
    >
      <Input
        id={id}
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        spellCheck={false}
        className="bg-surface font-mono text-small"
        aria-invalid={failure?.field === field}
      />
    </Field>
  );
}

/** The mail server: host, port, login, password, sender. */
export function SmtpFields({
  value,
  onChange,
  hasPassword,
  failure,
}: {
  value: SmtpForm;
  onChange: (value: SmtpForm) => void;
  hasPassword: boolean;
  failure: ActionFailure | null;
}) {
  const t = useTranslations('setup.notifications');
  const text = useFailureText();
  const fieldText = (name: string) => fieldError(failure, name, text);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field id="setup-smtp-host" label={t('smtpHost')} error={fieldText('smtpHost')}>
        <Input
          className="bg-surface"
          id="setup-smtp-host"
          value={value.host}
          onChange={(event) => onChange({ ...value, host: event.target.value })}
          autoComplete="off"
          aria-invalid={failure?.field === 'smtpHost'}
        />
      </Field>
      <Field id="setup-smtp-port" label={t('smtpPort')} error={fieldText('smtpPort')}>
        <Input
          className="bg-surface"
          id="setup-smtp-port"
          value={value.port}
          onChange={(event) => onChange({ ...value, port: event.target.value })}
          inputMode="numeric"
          autoComplete="off"
          aria-invalid={failure?.field === 'smtpPort'}
        />
      </Field>
      <Field id="setup-smtp-user" label={t('smtpUser')} error={fieldText('smtpUser')}>
        <Input
          className="bg-surface"
          id="setup-smtp-user"
          value={value.user}
          onChange={(event) => onChange({ ...value, user: event.target.value })}
          autoComplete="off"
          aria-invalid={failure?.field === 'smtpUser'}
        />
      </Field>
      <Field
        id="setup-smtp-password"
        label={t('smtpPassword')}
        hint={hasPassword ? t('passwordKept') : undefined}
        error={fieldText('smtpPassword')}
      >
        <Input
          className="bg-surface"
          id="setup-smtp-password"
          type="password"
          value={value.password}
          onChange={(event) => onChange({ ...value, password: event.target.value })}
          autoComplete="off"
          aria-invalid={failure?.field === 'smtpPassword'}
        />
      </Field>
      <div className="sm:col-span-2">
        <Field id="setup-smtp-from" label={t('smtpFrom')} error={fieldText('smtpFrom')}>
          <Input
            className="bg-surface"
            id="setup-smtp-from"
            type="email"
            value={value.from}
            onChange={(event) => onChange({ ...value, from: event.target.value })}
            autoComplete="off"
            aria-invalid={failure?.field === 'smtpFrom'}
          />
        </Field>
      </div>
    </div>
  );
}
