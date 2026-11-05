import { signOut } from '@/lib/auth';
import type { EffectiveSession } from '@/lib/auth/session';
import { PageHeaderSkeleton } from '@/components/layout/page-header-skeleton';
import { Skeleton } from '@/components/ui/skeleton';
import { MentionIdsWindow } from './mention-ids-window';

/**
 * What an approved account sees while an id the BDE needs is missing: blocks of skeleton, and the window that asks for the id. The server draws **only
 * this** (the layout does not render the page), and the session holds nothing, so nothing of the platform is in the page to be revealed by taking the
 * window out of the browser. Seen by everybody, owners and staff included.
 */
export function MentionIdsGate({ session }: { session: EffectiveSession }) {
  return (
    <div
      className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-4 p-4 sm:p-8"
      data-mention-ids-gate
    >
      <PageHeaderSkeleton />
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
      <MentionIdsWindow
        missing={session.missingIds}
        required={session.requiredIds}
        initial={{
          discordUserId: session.user.discordUserId ?? '',
          slackUserId: session.user.slackUserId ?? '',
        }}
        settingsLink={session.ownerEscape}
        signOutAction={async () => {
          'use server';
          await signOut({ redirectTo: '/' });
        }}
      />
    </div>
  );
}
