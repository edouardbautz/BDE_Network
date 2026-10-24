'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { saveMentionIds, type MentionIdsState } from '@/app/[locale]/(app)/profile/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** The Discord user id and the Slack member id of the signed-in person, to be mentioned in the messages for the staff. */
export function ProfileMentionIds({
  discordUserId,
  slackUserId,
}: {
  discordUserId: string;
  slackUserId: string;
}) {
  const t = useTranslations('profile.mentions');
  const [state, action, pending] = useActionState<MentionIdsState, FormData>(saveMentionIds, {
    values: { discordUserId, slackUserId },
  });
  const values = state.values ?? { discordUserId, slackUserId };

  const field = (name: 'discordUserId' | 'slackUserId', label: string, help: string) => {
    const invalid = state.errors?.[name] === 'invalid';
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={name}>{label}</Label>
        <Input
          id={name}
          name={name}
          defaultValue={values[name]}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className="font-mono"
          aria-invalid={invalid ? true : undefined}
          aria-describedby={invalid ? `${name}-error` : `${name}-help`}
        />
        {invalid ? (
          <p id={`${name}-error`} className="text-destructive text-small">
            {t('invalid')}
          </p>
        ) : (
          <p id={`${name}-help`} className="text-muted-foreground text-small">
            {help}
          </p>
        )}
      </div>
    );
  };

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {field('discordUserId', t('discord'), t('discordHelp'))}
      {field('slackUserId', t('slack'), t('slackHelp'))}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? t('saving') : t('save')}
        </Button>
        {state.saved && !pending && (
          <p role="status" className="text-muted-foreground text-body">
            {t('saved')}
          </p>
        )}
      </div>
    </form>
  );
}
