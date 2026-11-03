import { getTranslations } from 'next-intl/server';
import { getConfig } from '@/config';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { MentionIdsForm } from '@/components/mention-ids/mention-ids-form';
import { redirect } from '@/i18n/navigation';
import { signOut } from '@/lib/auth';
import { homeFor } from '@/lib/auth/home';
import { getEffectiveSession } from '@/lib/auth/session';
import { pageTitle } from '@/lib/page-title';

export const dynamic = 'force-dynamic';
export const generateMetadata = pageTitle('mentionIds', 'stepTitleShort');

/**
 * The step of the first sign-in, after 42 and before the waiting page: the Discord and Slack ids the BDE needs to mention the person in its
 * notifications (docs/design.md, "Asking for the ids"). It cannot be skipped: until the ids are given the session of the account holds nothing, so the
 * waiting page and everything else send it back here. Only an account that waits for approval comes to it (an approved account is asked in a window,
 * over the page it was on); an account with nothing to give is sent where it belongs.
 */
export default async function IdentifiersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getEffectiveSession();

  if (!session?.user) {
    redirect({ href: '/', locale });
    return null;
  }
  const home = homeFor(session);
  if (home !== '/identifiers') {
    redirect({ href: home, locale });
    return null;
  }

  const t = await getTranslations('mentionIds');
  const { bde } = getConfig();
  const name = session.user.name?.split(' ')[0] ?? session.user.login;

  return (
    <main className="flex min-h-dvh flex-col items-center gap-5 px-4 py-8 sm:py-12">
      <div className="fixed top-3 right-3 z-10">
        <LocaleSwitcher />
      </div>
      <div className="text-title-3 flex items-center gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element -- the logo is served by /api/logo or /public: next/image would only get in the way */}
        <img src={bde.logoPath} alt="" className="size-9 rounded-md object-contain" />
        {bde.name}
      </div>
      <section
        aria-labelledby="mention-ids-title"
        className="bg-surface elev-1 flex w-full max-w-150 flex-col gap-5 rounded-xl p-5 sm:rounded-3xl sm:p-7"
      >
        <span className="bg-accent-soft text-accent-ink text-caption flex h-5.5 w-fit items-center rounded-pill px-2.5 font-extrabold">
          {t('eyebrow')}
        </span>
        <h1 id="mention-ids-title" className="text-title-1">
          {t('stepTitle', { name })}
        </h1>
        <p className="text-muted-foreground text-body max-w-[56ch]">
          {t.rich('stepIntro', { b: (chunks) => <b className="text-ink">{chunks}</b> })}
        </p>
        <MentionIdsForm
          platforms={session.requiredIds}
          initial={{
            discordUserId: session.user.discordUserId ?? '',
            slackUserId: session.user.slackUserId ?? '',
          }}
          submit={t('stepSubmit')}
          mode="step"
          idPrefix="step-id"
          after={
            <form
              action={async () => {
                'use server';
                await signOut({ redirectTo: '/' });
              }}
              className="flex justify-center"
            >
              <button
                type="submit"
                className="text-muted-foreground text-body-strong min-h-11 rounded-xs px-3 underline underline-offset-3"
              >
                {t('logout')}
              </button>
            </form>
          }
        />
      </section>
    </main>
  );
}
