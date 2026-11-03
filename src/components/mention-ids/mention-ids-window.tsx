'use client';

import { useRef } from 'react';
import { AtSign } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { MentionPlatform } from '@/lib/mention-ids/required';
import { MentionIdsForm } from './mention-ids-form';

/**
 * The window that asks for a missing id, over a page, with a session already open (docs/design.md, "Asking for the ids"). **It cannot be closed**:
 * Escape, a click outside and the browser's own navigation leave it where it is, and the only way out other than giving the id is "Sign out". It is an
 * alert dialog (announced as one, its title and its sentence read when it opens), the focus is trapped inside it and starts on the first field, and on a
 * phone it is the sheet of the design system with its button kept in view.
 *
 * Behind it there is nothing to see: the layout draws only skeleton blocks while an id is missing (the server does not send the page), and the
 * session holds nothing (`getEffectiveSession`), so taking the window out of the browser leaves an empty page that does nothing.
 */
export function MentionIdsWindow({
  missing,
  required,
  initial,
  signOutAction,
}: {
  /** What is still to give (what the title says). */
  missing: readonly MentionPlatform[];
  /** What is asked (what the form shows: all of it, with what is already given filled in). */
  required: readonly MentionPlatform[];
  initial: { discordUserId: string; slackUserId: string };
  signOutAction: () => Promise<void>;
}) {
  const t = useTranslations('mentionIds');
  const first = useRef<HTMLInputElement>(null);
  const names = missing.map((platform) => t(`platformNames.${platform}`));
  const asked = required.filter((platform) => missing.includes(platform));
  const introKey = 'gateIntroMissing';

  return (
    <Dialog open onOpenChange={() => undefined} disablePointerDismissal>
      <DialogContent
        role="alertdialog"
        initialFocus={first}
        aria-describedby="mention-ids-intro"
        className="max-sm:max-h-[92dvh] sm:max-w-135"
      >
        <DialogHeader className="pe-0">
          <span
            aria-hidden="true"
            className="bg-accent-soft text-accent-ink flex size-11 items-center justify-center rounded-md"
          >
            <AtSign className="size-5" />
          </span>
          <DialogTitle>
            {missing.length === 1
              ? t('gateTitle.one', { platform: names[0] ?? '' })
              : t('gateTitle.many')}
          </DialogTitle>
          <DialogDescription id="mention-ids-intro" className="max-w-[60ch]">
            {t.rich(introKey, {
              platforms: names.join(' / '),
              b: (chunks) => <b className="text-ink">{chunks}</b>,
            })}
          </DialogDescription>
        </DialogHeader>
        <MentionIdsForm
          platforms={asked}
          initial={initial}
          submit={t('gateSubmit')}
          mode="window"
          firstFieldRef={first}
          idPrefix="window-id"
          after={
            <form action={signOutAction} className="flex justify-center">
              <button
                type="submit"
                className="text-muted-foreground text-body-strong min-h-11 rounded-xs px-3 underline underline-offset-3"
              >
                {t('logout')}
              </button>
            </form>
          }
        />
      </DialogContent>
    </Dialog>
  );
}
