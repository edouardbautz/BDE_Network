'use client';

import { useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Undo2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { SecretField } from '@/components/secret-field';
import { fieldError, useFailureText } from '@/components/setup/fields';
import { saveStaffChannel, testStaffChannel } from '@/app/[locale]/(app)/settings/actions';
import type { ActionFailure } from '@/app/[locale]/setup/actions';
import type { EventsSettingsView } from '@/lib/settings/view';

type Channel = 'discord' | 'slack';

/**
 * The room of the school's staff, for what the platform posts about publishing the events on the intra: a Discord and/or a Slack
 * webhook of its own (the staff is not necessarily on the BDE's server). Left empty, those messages go to the BDE's own room. The
 * addresses are secrets: never shown again, a blank field keeps the saved one, and removing one is staged until Save.
 */
export function StaffChannelSection({
  settings,
}: {
  settings: EventsSettingsView['staffChannel'];
}) {
  const t = useTranslations('settings.staffChannel');
  const tSaved = useTranslations('settings');
  const tNav = useTranslations('setup.nav');
  const locale = useLocale();
  const text = useFailureText();
  const [typed, setTyped] = useState<Record<Channel, string>>({ discord: '', slack: '' });
  const [removing, setRemoving] = useState<Record<Channel, boolean>>({
    discord: false,
    slack: false,
  });
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [tested, setTested] = useState<{ channel: Channel; ok: boolean; message: string } | null>(
    null,
  );
  const [pending, start] = useTransition();
  const tails: Record<Channel, string | null | undefined> = {
    discord: settings.discordWebhookTail,
    slack: settings.slackWebhookTail,
  };
  const saved: Record<Channel, boolean> = {
    discord: settings.hasDiscordWebhook,
    slack: settings.hasSlackWebhook,
  };

  function save() {
    start(async () => {
      const result = await saveStaffChannel({
        discordWebhook: typed.discord,
        slackWebhook: typed.slack,
        removeDiscord: removing.discord,
        removeSlack: removing.slack,
      });
      if (!result.ok) return setFailure(result);
      setFailure(null);
      setTyped({ discord: '', slack: '' });
      setRemoving({ discord: false, slack: false });
      toast.success(tSaved('saved'));
    });
  }

  function test(channel: Channel) {
    start(async () => {
      const result = await testStaffChannel({ channel, locale, webhook: typed[channel] });
      if (result.ok) setTested({ channel, ok: true, message: t('testSent') });
      else setTested({ channel, ok: false, message: text(result) });
    });
  }

  const labels: Record<Channel, string> = { discord: t('discord'), slack: t('slack') };

  return (
    <section aria-labelledby="settings-staff-channel" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 id="settings-staff-channel" className="text-title-3">
          {t('title')}
        </h2>
        <p className="text-muted-foreground text-body">{t('description')}</p>
      </div>

      <form
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending) save();
        }}
        noValidate
      >
        {(['discord', 'slack'] as const).map((channel) => {
          const field = channel === 'discord' ? 'discordWebhook' : 'slackWebhook';
          const id = `settings-staff-${channel}`;
          const isRemoving = removing[channel];
          return (
            <div key={channel} className="flex flex-col gap-2">
              <SecretField
                id={id}
                label={labels[channel]}
                saved={saved[channel] && !isRemoving}
                tail={tails[channel]}
                value={typed[channel]}
                onChange={(value) => setTyped((current) => ({ ...current, [channel]: value }))}
                hint={isRemoving ? t('willRemove') : saved[channel] ? undefined : t('emptyHint')}
                error={fieldError(failure, field, text)}
                invalid={failure?.field === field}
                disabled={isRemoving}
                placeholder="https://…"
                onRemove={() => {
                  setRemoving((current) => ({ ...current, [channel]: true }));
                  setTyped((current) => ({ ...current, [channel]: '' }));
                }}
                removeLabel={t('remove', { channel: labels[channel] })}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending || isRemoving || (!saved[channel] && typed[channel] === '')}
                  onClick={() => test(channel)}
                >
                  <Send data-icon="inline-start" aria-hidden="true" />
                  {t('test', { channel: labels[channel] })}
                </Button>
                {saved[channel] && isRemoving && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setRemoving((current) => ({ ...current, [channel]: false }))}
                  >
                    <Undo2 data-icon="inline-start" aria-hidden="true" />
                    {t('keep', { channel: labels[channel] })}
                  </Button>
                )}
                {tested?.channel === channel && (
                  <p
                    role="status"
                    className={
                      tested.ok ? 'text-muted-foreground text-body' : 'text-destructive text-body'
                    }
                  >
                    {tested.message}
                  </p>
                )}
              </div>
            </div>
          );
        })}

        {failure && !failure.field && (
          <p role="alert" className="text-destructive text-body">
            {text(failure)}
          </p>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? tNav('saving') : tNav('save')}
          </Button>
        </div>
      </form>
    </section>
  );
}
