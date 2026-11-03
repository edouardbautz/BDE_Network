import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { MentionPlatform } from '@/lib/mention-ids/required';
import { cn } from '@/lib/utils';

/**
 * "How do I find my id?": three steps with a small diagram of each, for Discord and for Slack, on a computer and on a phone (docs/design.md, "Asking
 * for the ids"). The diagrams are drawn here, in the platform's own tokens, and are **schematic on purpose**: the interface of Discord and Slack changes
 * often and is theirs, so a picture of it would be wrong soon and is not ours to copy; the words say exactly what to press, the diagram shows where
 * to look. Decorative to a screen reader (`aria-hidden`): the steps carry everything.
 */

function Panel({ children }: { children: ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className="bg-surface text-small ring-line mt-2.5 flex max-w-sm flex-col gap-1.5 rounded-lg p-2.5 ring-1"
    >
      {children}
    </div>
  );
}

function Row({
  children,
  highlighted = false,
  aside,
}: {
  children: ReactNode;
  highlighted?: boolean;
  aside?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'text-muted-foreground flex items-center justify-between gap-3 rounded-sm px-2.5 py-1.5',
        highlighted && 'bg-accent-soft text-accent-ink ring-accent-ink font-extrabold ring-2',
      )}
    >
      <span>{children}</span>
      {aside}
    </div>
  );
}

function Switch({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        'relative inline-block h-5 w-8.5 shrink-0 rounded-pill',
        on ? 'bg-accent-ink' : 'bg-surface-3',
      )}
    >
      <span
        className={cn('absolute top-0.5 size-4 rounded-pill bg-white', on ? 'left-4' : 'left-0.5')}
      />
    </span>
  );
}

function Who({ name, aside }: { name: string; aside?: ReactNode }) {
  return (
    <div className="text-ink flex items-center gap-2 px-2.5 py-1.5 font-extrabold">
      <span className="bg-surface-3 text-micro flex size-6.5 items-center justify-center rounded-pill">
        CM
      </span>
      {name}
      {aside}
    </div>
  );
}

function Step({
  n,
  title,
  body,
  children,
}: {
  n: number;
  title: string;
  body: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[1.75rem_1fr] gap-3">
      <span className="bg-accent-ink text-accent-on text-small flex size-7 items-center justify-center rounded-pill font-extrabold">
        {n}
      </span>
      <div className="min-w-0">
        <p className="text-body-strong">{title}</p>
        <p className="text-muted-foreground text-small mt-0.5">{body}</p>
        {children}
      </div>
    </li>
  );
}

export function IdGuide({
  platform,
  defaultOpen = false,
}: {
  platform: MentionPlatform;
  defaultOpen?: boolean;
}) {
  const t = useTranslations(`mentionIds.guide.${platform}`);
  return (
    <details
      open={defaultOpen}
      className="group/guide bg-surface-2 rounded-lg"
      data-testid={`guide-${platform}`}
    >
      <summary className="text-accent-ink text-body-strong flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-2.5 [&::-webkit-details-marker]:hidden">
        {t('title')}
        <ChevronDown
          aria-hidden="true"
          className="size-4.5 shrink-0 transition-transform duration-(--dur-base) group-open/guide:rotate-180"
        />
      </summary>
      <ol className="flex flex-col gap-4 px-4 pb-4">
        {platform === 'discord' ? (
          <>
            <Step n={1} title={t('step1Title')} body={t('step1Body')}>
              <Panel>
                <Row>{t('shotAccount')}</Row>
                <Row>{t('shotPrivacy')}</Row>
                <Row highlighted>{t('shotAdvanced')}</Row>
                <Row aside={<Switch on />}>{t('shotDeveloper')}</Row>
              </Panel>
            </Step>
            <Step
              n={2}
              title={t('step2Title')}
              body={
                <>
                  <span className="max-sm:hidden">{t('step2BodyDesktop')}</span>
                  <span className="sm:hidden">{t('step2BodyPhone')}</span>
                </>
              }
            >
              <Panel>
                <Who name="Camille Martin" />
                <div className="bg-surface ring-line ms-8.5 flex flex-col rounded-md p-1 shadow-md ring-1">
                  <Row>{t('shotProfile')}</Row>
                  <Row>{t('shotMention')}</Row>
                  <Row highlighted>{t('shotCopy')}</Row>
                </div>
              </Panel>
            </Step>
          </>
        ) : (
          <>
            <Step n={1} title={t('step1Title')} body={t('step1Body')}>
              <Panel>
                <Who
                  name={t('shotName')}
                  aside={
                    <span className="bg-accent-soft text-accent-ink ring-accent-ink ms-auto flex size-6.5 items-center justify-center rounded-sm font-extrabold ring-2">
                      ⋮
                    </span>
                  }
                />
              </Panel>
            </Step>
            <Step n={2} title={t('step2Title')} body={t('step2Body')}>
              <Panel>
                <div className="bg-surface ring-line flex flex-col rounded-md p-1 shadow-md ring-1">
                  <Row>{t('shotCopyName')}</Row>
                  <Row highlighted>{t('shotCopy')}</Row>
                  <Row>{t('shotCopyLink')}</Row>
                </div>
              </Panel>
            </Step>
          </>
        )}
        <Step n={3} title={t('step3Title')} body={t('step3Body')} />
      </ol>
    </details>
  );
}
