'use client';

import { useActionState, useEffect, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { saveMentionIds, type MentionIdsState } from '@/app/[locale]/(app)/profile/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parseDiscordUserId, parseSlackUserId } from '@/lib/members/mention-ids';
import type { MentionPlatform } from '@/lib/mention-ids/required';
import { cn } from '@/lib/utils';
import { IdGuide } from './id-guide';

/**
 * The form of the ids (docs/design.md, "Asking for the ids"): one block per platform the BDE posts on (the label, the field, what an id looks like,
 * the guide to find it), shared by the three places that ask for them: the step of the first sign-in, the window that cannot be closed, and the profile.
 *
 * The platforms are the ones the SERVER asked for (`requiredIds` of the session): each is required, a blank is refused, and the server checks every id
 * again whatever this form said. What is checked here is a courtesy: the tick when the id is good and the sentence when it is not, at once.
 */

type Field = 'discordUserId' | 'slackUserId';
const FIELD: Record<MentionPlatform, Field> = { discord: 'discordUserId', slack: 'slackUserId' };
const PARSE = { discord: parseDiscordUserId, slack: parseSlackUserId };

export interface MentionIdsFormProps {
  platforms: readonly MentionPlatform[];
  initial: { discordUserId: string; slackUserId: string };
  /** The words of the button; `saving` is shown while the answer is awaited. */
  submit: string;
  /** What the form is for: after a save the step and the window load the page again (what they hid is then there), the profile says "Saved". */
  mode: 'step' | 'window' | 'profile';
  /** Something after the button (the link that signs out). */
  after?: ReactNode;
  /** The guides start open on the platforms still missing (a first sign-in) or closed (the profile). */
  guidesOpen?: boolean;
  firstFieldRef?: React.RefObject<HTMLInputElement | null>;
  idPrefix?: string;
}

export function MentionIdsForm({
  platforms,
  initial,
  submit,
  mode,
  after,
  guidesOpen = true,
  firstFieldRef,
  idPrefix = 'mention-id',
}: MentionIdsFormProps) {
  const t = useTranslations('mentionIds');
  const [state, action, pending] = useActionState<MentionIdsState, FormData>(saveMentionIds, {
    values: initial,
  });
  const [typed, setTyped] = useState(initial);
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  // Only the guide of the first id still to give starts open (once, when the form appears: it does not close under the fingers while typing): with
  // two platforms, two open guides would push the button far down a phone.
  const [openGuide] = useState(() =>
    guidesOpen
      ? platforms.find((platform) => {
          const parsed = PARSE[platform](initial[FIELD[platform]]);
          return !parsed.ok || parsed.value === null;
        })
      : undefined,
  );

  // Saved: the page is loaded again (it is what the step and the window were hiding), not patched in place.
  useEffect(() => {
    if (state.saved && mode !== 'profile') window.location.reload();
  }, [state.saved, mode]);

  return (
    <div className="flex flex-col gap-1">
      <form action={action} className="flex flex-col gap-6" noValidate>
        {platforms.map((platform, index) => {
          const field = FIELD[platform];
          const name = t(`platformNames.${platform}`);
          const value = typed[field];
          const live = PARSE[platform](value);
          const serverError = state.errors?.[field];
          const showInvalid =
            serverError === 'invalid' || (touched[field] && value.trim() !== '' && !live.ok);
          const showRequired = serverError === 'required' && value.trim() === '';
          const valid = value.trim() !== '' && live.ok && !showInvalid;
          const id = `${idPrefix}-${platform}`;
          const describedBy = showInvalid || showRequired ? `${id}-error` : `${id}-hint`;

          return (
            <div key={platform} className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="bg-surface-3 text-ink text-small flex size-7 items-center justify-center rounded-sm font-extrabold"
                >
                  {name.charAt(0)}
                </span>
                <label htmlFor={id} className="text-body-strong">
                  {t('label', { platform: name })}
                </label>
              </div>
              <Input
                id={id}
                ref={index === 0 ? firstFieldRef : undefined}
                name={field}
                value={value}
                onChange={(event) => setTyped({ ...typed, [field]: event.target.value })}
                onBlur={() => setTouched({ ...touched, [field]: true })}
                placeholder={t(`placeholder.${platform}`)}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                inputMode={platform === 'discord' ? 'numeric' : 'text'}
                required
                aria-required="true"
                aria-invalid={showInvalid || showRequired ? true : undefined}
                aria-describedby={describedBy}
                className="font-mono"
              />
              {showInvalid || showRequired ? (
                <p
                  id={`${id}-error`}
                  role="alert"
                  className="text-destructive text-small flex gap-2 font-bold"
                >
                  <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <span>{showRequired ? t('errors.required') : t(`errors.${platform}`)}</span>
                </p>
              ) : valid ? (
                <p id={`${id}-hint`} className="text-success text-small flex gap-2 font-bold">
                  <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <span>{t('valid')}</span>
                </p>
              ) : (
                <p id={`${id}-hint`} className="text-muted-foreground text-small">
                  {t(`hint.${platform}`)}
                </p>
              )}
              <IdGuide platform={platform} defaultOpen={platform === openGuide} />
            </div>
          );
        })}
        <div className="flex flex-col gap-1">
          <Button type="submit" size="lg" disabled={pending} className="w-full">
            {pending ? t('saving') : submit}
          </Button>
          {mode === 'profile' && state.saved && !pending && (
            <p role="status" className="text-muted-foreground text-body text-center">
              {t('savedNotice')}
            </p>
          )}
        </div>
      </form>
      {after}
    </div>
  );
}
