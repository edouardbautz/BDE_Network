'use client';

import { useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import type { ActionFailure } from '@/app/[locale]/setup/actions';
import { NOTIFICATION_CHANNELS, type NotificationChannel } from '@/config/schema';
import { effectiveMatrix, type Configured } from '@/lib/setup/notification-matrix';
import type { DraftView } from '@/lib/setup/draft';
import type { StepApi } from './api';
import { Field, fieldError, useFailureText } from './fields';
import {
  ChannelPanel,
  SmtpFields,
  WebhookField,
  type TestState,
  type TypedCredentials,
} from './notification-channels';
import { NotificationTable } from './notification-table';
import { StepFrame, type StepProps } from './step-frame';

/**
 * The notifications, for the installer and for the settings page: first the channels (what each needs, its test, its
 * removal), then the table of what goes where. A channel that is not configured cannot be ticked; a type with nothing ticked
 * sends nothing.
 */
export function StepNotifications({
  api,
  view,
  onSaved,
  run,
  onNext,
  onBack,
}: StepProps & { api: StepApi; view: DraftView; onSaved: (patch: Partial<DraftView>) => void }) {
  const t = useTranslations('setup.notifications');
  const locale = useLocale();
  const text = useFailureText();
  const initial = view.notifications;

  const [matrix, setMatrix] = useState(initial.matrix);
  const [typed, setTyped] = useState<TypedCredentials>({
    discord: '',
    slack: '',
    smtp: {
      host: initial.smtp.host,
      port: initial.smtp.port,
      user: initial.smtp.user,
      password: '',
      from: initial.smtp.from,
    },
    testTo: '',
  });
  const [removed, setRemoved] = useState<NotificationChannel[]>([]);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [tests, setTests] = useState<Partial<Record<NotificationChannel, TestState>>>({});
  const [testing, setTesting] = useState<NotificationChannel | null>(null);
  const [pending, start] = useTransition();

  const saved: Configured = {
    discord: initial.hasDiscordWebhook,
    slack: initial.hasSlackWebhook,
    email: initial.hasSmtp,
  };
  const isRemoved = (channel: NotificationChannel) => removed.includes(channel);
  /** What the page can say before saving: a saved channel not removed, or one whose form is filled in. The server decides. */
  const configured: Configured = {
    discord: (saved.discord && !isRemoved('discord')) || typed.discord.trim() !== '',
    slack: (saved.slack && !isRemoved('slack')) || typed.slack.trim() !== '',
    email:
      (saved.email && !isRemoved('email')) ||
      (typed.smtp.host.trim() !== '' && typed.smtp.from.trim() !== ''),
  };

  const payload = {
    matrix: effectiveMatrix(matrix, configured),
    discordWebhook: typed.discord,
    slackWebhook: typed.slack,
    smtp: typed.smtp,
    removed,
  };

  function submit() {
    start(async () => {
      const result = await run(api.saveNotifications(payload));
      if (!result.ok) return setFailure(result);
      setFailure(null);
      onSaved({
        notifications: {
          matrix: payload.matrix,
          hasDiscordWebhook: configured.discord,
          hasSlackWebhook: configured.slack,
          hasSmtp: configured.email,
          smtp: {
            host: typed.smtp.host.trim(),
            port: typed.smtp.port.trim(),
            user: typed.smtp.user.trim(),
            from: typed.smtp.from.trim(),
            hasPassword:
              configured.email && (typed.smtp.password !== '' || initial.smtp.hasPassword),
          },
        },
      });
      onNext();
    });
  }

  async function sendTest(channel: NotificationChannel) {
    setTests((all) => ({ ...all, [channel]: null }));
    setTesting(channel);
    const result = await run(api.testNotification(payload, { locale, channel, to: typed.testTo }));
    setFailure(result.ok ? null : result.field ? result : null);
    setTests((all) => ({ ...all, [channel]: result.ok ? 'ok' : result }));
    setTesting(null);
  }

  function remove(channel: NotificationChannel) {
    setRemoved((all) => [...all, channel]);
    setTyped((all) => ({
      ...all,
      ...(channel === 'discord' ? { discord: '' } : {}),
      ...(channel === 'slack' ? { slack: '' } : {}),
    }));
  }

  const stateOf = (channel: NotificationChannel) => ({
    configured: configured[channel],
    saved: saved[channel],
    removed: isRemoved(channel),
    hasPassword: channel === 'email' ? initial.smtp.hasPassword : undefined,
  });

  const panelProps = (channel: NotificationChannel) => ({
    channel,
    state: stateOf(channel),
    testing: testing === channel,
    test: tests[channel] ?? null,
    onTest: () => sendTest(channel),
    onRemove: () => remove(channel),
    onUndoRemove: () => setRemoved((all) => all.filter((c) => c !== channel)),
  });

  return (
    <StepFrame
      title={t('title')}
      description={t('description')}
      onSubmit={submit}
      onBack={onBack}
      pending={pending}
      failure={failure}
    >
      <section aria-labelledby="setup-notification-channels" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 id="setup-notification-channels" className="text-body-strong">
            {t('channelsTitle')}
          </h3>
          <p className="text-muted-foreground text-body">{t('channelsHelp')}</p>
        </div>
        {NOTIFICATION_CHANNELS.map((channel) => {
          if (channel === 'discord' || channel === 'slack') {
            return (
              <ChannelPanel key={channel} {...panelProps(channel)}>
                <WebhookField
                  channel={channel}
                  value={typed[channel]}
                  onChange={(value) => setTyped({ ...typed, [channel]: value })}
                  saved={saved[channel]}
                  failure={failure}
                />
              </ChannelPanel>
            );
          }
          return (
            <ChannelPanel
              key={channel}
              {...panelProps(channel)}
              testToField={
                configured.email && !isRemoved('email') ? (
                  <Field
                    id="setup-test-to"
                    label={t('testTo')}
                    error={fieldError(failure, 'testTo', text)}
                  >
                    <Input
                      className="bg-surface"
                      id="setup-test-to"
                      type="email"
                      value={typed.testTo}
                      onChange={(event) => setTyped({ ...typed, testTo: event.target.value })}
                      autoComplete="off"
                      aria-invalid={failure?.field === 'testTo'}
                    />
                  </Field>
                ) : undefined
              }
            >
              <SmtpFields
                value={typed.smtp}
                onChange={(smtp) => setTyped({ ...typed, smtp })}
                hasPassword={initial.smtp.hasPassword}
                failure={failure}
              />
            </ChannelPanel>
          );
        })}
      </section>

      <section aria-labelledby="setup-notification-matrix" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 id="setup-notification-matrix" className="text-body-strong">
            {t('matrixTitle')}
          </h3>
          <p id="setup-notifications-matrix-help" className="text-muted-foreground text-body">
            {t('matrixHelp')}
          </p>
        </div>
        <NotificationTable
          matrix={matrix}
          onChange={setMatrix}
          configured={configured}
          events={view.events}
          intra={view.intra}
        />
        {failure?.field === 'matrix' && (
          <p role="alert" className="text-destructive text-body">
            {text(failure)}
          </p>
        )}
      </section>
    </StepFrame>
  );
}
