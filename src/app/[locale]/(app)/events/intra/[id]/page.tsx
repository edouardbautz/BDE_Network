import { CircleCheck, CircleX, ExternalLink, RefreshCw, Send } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { getConfig } from '@/config';
import { ActionButton } from '@/components/action-button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CopyButton } from '@/components/events/copy-button';
import { IntraNoticeAlert } from '@/components/events/intra-notice';
import { IntraStatusBadge } from '@/components/events/intra-status-badge';
import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getIntraAccess } from '@/lib/events/access';
import { formatLongDate } from '@/lib/events/format';
import { readIntraNotice } from '@/lib/events/intra-notice';
import { getIntraRequest } from '@/lib/events/intra-queries';
import {
  DATE_FIELDS,
  dateValues,
  diffContent,
  fieldValue,
  hashContent,
  intraReadiness,
  isEmptyChange,
  readContent,
  type CopyField,
  type DateField,
  type IntraContent,
} from '@/lib/events/intra-request';
import { REFUSAL_COMMENT_MAX_LENGTH } from '@/lib/events/review';
import { pageTitle } from '@/lib/page-title';
import { markIntraUpdated, publishOnIntra, refuseOnIntra, requestOnIntra } from '../actions';

export const dynamic = 'force-dynamic';
export const generateMetadata = pageTitle('events', 'intra.detail.title');

type Field = Exclude<CopyField, DateField>;

/** The fields before the dates, and after them, in the order of the intra's form. */
const BEFORE_DATES: readonly Field[] = ['organizerLogin', 'name', 'availableFor'];
const AFTER_DATES: readonly Field[] = [
  'description',
  'location',
  'maxPeople',
  'waitingList',
  'kind',
  'unsubscribeHours',
  'keywords',
];

/**
 * One request for the intra: the event as the staff copies it into the intra's form, field by field (each with its Copy button),
 * and the answers: published, refused, or, for an event that changed after it was published, what changed and "Intra updated".
 * A person who only follows the publications reads it without the buttons.
 */
export default async function IntraRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const access = await getIntraAccess();
  if (!access) {
    notFound();
  }

  const [{ id }, raw, t, tEvents, locale] = await Promise.all([
    params,
    searchParams,
    getTranslations('events.intra'),
    getTranslations('events'),
    getLocale(),
  ]);
  const request = await getIntraRequest(id);
  if (!request) {
    notFound();
  }

  const timeZone = getConfig().bde.timezone;
  const readiness = intraReadiness(request.event, timeZone);
  if (!readiness.ok) {
    // The request outlived what it was made of (never meant to happen: the sync removes it): nothing to copy.
    notFound();
  }
  const { content } = readiness;
  const hash = hashContent(content);
  const published = request.status === 'OUTDATED' ? readContent(request.publishedContent) : null;

  const words = {
    audience: (audience: IntraContent['fields']['audience']) =>
      tEvents(`form.intra.audiences.${audience}`),
    waitingList: (value: boolean) => tEvents(value ? 'form.intra.yes' : 'form.intra.no'),
  };
  const change = published ? diffContent(published, content, words) : null;
  const fieldLabel = (field: CopyField) => t(`fields.${field}`);
  const dateText = (date: IntraContent['dates'][number]) => {
    const v = dateValues(date, timeZone);
    return `${v.startDate} ${v.startTime} → ${v.endDate} ${v.endTime}`;
  };

  const copy = (value: string, field: CopyField) => (
    <CopyButton
      value={value}
      fieldName={fieldLabel(field)}
      copyLabel={t('copy')}
      copiedLabel={t('copied')}
      failedLabel={t('copyFailed')}
    />
  );

  const row = (field: Field) => {
    const value = fieldValue(content, field, words);
    const long = field === 'description';
    return (
      <div key={field} className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-4">
        <dt className="text-muted-foreground text-small sm:w-56 sm:shrink-0 sm:pt-2">
          {fieldLabel(field)}
        </dt>
        <dd className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <span
            className={
              long
                ? 'text-body max-h-72 min-w-0 overflow-auto break-words whitespace-pre-wrap'
                : 'text-body min-w-0 break-words'
            }
          >
            {value === '' ? <span className="text-muted-foreground">—</span> : value}
          </span>
          {value !== '' && <span className="shrink-0">{copy(value, field)}</span>}
        </dd>
      </div>
    );
  };

  const customTexts = (date: IntraContent['dates'][number]) =>
    [
      date.title !== undefined && `${fieldLabel('name')} : ${date.title}`,
      date.location !== undefined && `${fieldLabel('location')} : ${date.location}`,
      date.description !== undefined && `${fieldLabel('description')} : ${date.description}`,
    ].filter(Boolean) as string[];

  const showAnswers = access.canPublish;

  return (
    <>
      <PageHeader
        title={request.event.title}
        back={{ href: '/events/intra', label: t('detail.back') }}
      />
      <div className="flex flex-col gap-3 sm:gap-4">
        <IntraNoticeAlert notice={readIntraNotice(raw.notice)} />

        <Card>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <IntraStatusBadge status={request.status} label={t(`status.${request.status}`)} />
              <span className="text-muted-foreground text-small">
                {t('list.sentBy', {
                  login: request.requestedByLogin,
                  date: formatLongDate(request.requestedAt, locale, timeZone),
                })}
              </span>
            </div>
            {request.status === 'REFUSED' && request.refusalComment && (
              <Alert variant="destructive">
                <CircleX />
                <AlertDescription>
                  <span className="font-semibold">
                    {t('detail.refusedBy', { login: request.answeredByLogin ?? '' })}
                  </span>
                  <span className="block break-words whitespace-pre-wrap">
                    {request.refusalComment}
                  </span>
                </AlertDescription>
              </Alert>
            )}
            {(request.status === 'PUBLISHED' || request.status === 'OUTDATED') &&
              request.answeredAt && (
                <p className="text-body">
                  {t('detail.publishedBy', {
                    login: request.answeredByLogin ?? '',
                    date: formatLongDate(request.answeredAt, locale, timeZone),
                  })}
                  {request.intraUrl && (
                    <>
                      {' '}
                      <a
                        href={request.intraUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent-ink inline-flex items-center gap-1 underline underline-offset-3"
                      >
                        {t('detail.openOnIntra')}
                        <ExternalLink className="size-3.5" aria-hidden />
                      </a>
                    </>
                  )}
                </p>
              )}

            {showAnswers && request.status === 'PENDING' && (
              <div className="flex flex-wrap items-center gap-2">
                <ConfirmDialog
                  tone="default"
                  triggerVariant="default"
                  title={t('detail.publishDialog.title')}
                  description={t('detail.publishDialog.body')}
                  confirmLabel={t('detail.publishDialog.confirm')}
                  field={{
                    label: t('detail.publishDialog.address'),
                    hint: t('detail.publishDialog.addressHint'),
                    maxLength: 300,
                  }}
                  onConfirm={async (_choice, url) => {
                    'use server';
                    return publishOnIntra(request.eventId, hash, url);
                  }}
                >
                  <CircleCheck data-icon="inline-start" />
                  {t('detail.publish')}
                </ConfirmDialog>
                <ConfirmDialog
                  tone="destructive"
                  triggerVariant="destructive"
                  title={t('detail.refuseDialog.title')}
                  description={t('detail.refuseDialog.body')}
                  confirmLabel={t('detail.refuseDialog.confirm')}
                  field={{
                    label: t('detail.refuseDialog.comment'),
                    hint: t('detail.refuseDialog.commentHint'),
                    maxLength: REFUSAL_COMMENT_MAX_LENGTH,
                    required: true,
                  }}
                  onConfirm={async (_choice, comment) => {
                    'use server';
                    return refuseOnIntra(request.eventId, comment);
                  }}
                >
                  <CircleX data-icon="inline-start" />
                  {t('detail.refuse')}
                </ConfirmDialog>
              </div>
            )}
            {showAnswers && request.status === 'OUTDATED' && (
              <div>
                <ConfirmDialog
                  tone="default"
                  triggerVariant="default"
                  title={t('detail.updatedDialog.title')}
                  description={t('detail.updatedDialog.body')}
                  confirmLabel={t('detail.updatedDialog.confirm')}
                  onConfirm={async () => {
                    'use server';
                    return markIntraUpdated(request.eventId, hash);
                  }}
                >
                  <RefreshCw data-icon="inline-start" />
                  {t('detail.updated')}
                </ConfirmDialog>
              </div>
            )}
            {access.canRequest && request.status === 'REFUSED' && (
              <div>
                <ActionButton
                  variant="default"
                  action={async () => {
                    'use server';
                    return requestOnIntra(request.eventId, 'intra');
                  }}
                >
                  <Send data-icon="inline-start" />
                  {t('detail.sendAgain')}
                </ActionButton>
              </div>
            )}
            {!showAnswers && (
              <p className="text-muted-foreground text-small">{t('detail.readOnly')}</p>
            )}
          </CardContent>
        </Card>

        {change && !isEmptyChange(change) && (
          <Card>
            <CardHeader>
              <CardTitle>{t('detail.changes.title')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="text-muted-foreground text-body">{t('detail.changes.intro')}</p>
              {change.fields.length > 0 && (
                <dl className="flex flex-col gap-3">
                  {change.fields.map(({ field, before, after }) => (
                    <div key={field} className="flex flex-col gap-1">
                      <dt className="text-small font-semibold">{fieldLabel(field)}</dt>
                      <dd className="grid gap-1 text-body sm:grid-cols-2 sm:gap-4">
                        <span className="min-w-0 break-words whitespace-pre-wrap">
                          <span className="text-muted-foreground text-small block">
                            {t('detail.changes.before')}
                          </span>
                          {before === '' ? '—' : before}
                        </span>
                        <span className="min-w-0 break-words whitespace-pre-wrap">
                          <span className="text-muted-foreground text-small block">
                            {t('detail.changes.after')}
                          </span>
                          {after === '' ? '—' : after}
                        </span>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {change.removed.length > 0 && (
                <div>
                  <p className="text-small font-semibold">{t('detail.changes.removed')}</p>
                  <ul className="text-body list-disc pl-5">
                    {change.removed.map((date) => (
                      <li key={`${date.start}|${date.end}`}>{dateText(date)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {change.added.length > 0 && (
                <div>
                  <p className="text-small font-semibold">{t('detail.changes.added')}</p>
                  <ul className="text-body list-disc pl-5">
                    {change.added.map((date) => (
                      <li key={`${date.start}|${date.end}`}>{dateText(date)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {change.edited.length > 0 && (
                <div>
                  <p className="text-small font-semibold">{t('detail.changes.edited')}</p>
                  <ul className="text-body list-disc pl-5">
                    {change.edited.map(({ after }) => (
                      <li key={`${after.start}|${after.end}`} className="break-words">
                        {dateText(after)}
                        {customTexts(after).map((text) => (
                          <span key={text} className="block">
                            {text}
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{t('detail.copyTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-muted-foreground text-body">{t('detail.copyIntro')}</p>
            <dl className="flex flex-col gap-4">
              {BEFORE_DATES.map(row)}

              {content.dates.length === 1 ? (
                DATE_FIELDS.map((field) => {
                  const value = dateValues(content.dates[0]!, timeZone)[field];
                  return (
                    <div
                      key={field}
                      className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-4"
                    >
                      <dt className="text-muted-foreground text-small sm:w-56 sm:shrink-0 sm:pt-2">
                        {fieldLabel(field)}
                      </dt>
                      <dd className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <span className="text-body tabular">{value}</span>
                        <span className="shrink-0">{copy(value, field)}</span>
                      </dd>
                    </div>
                  );
                })
              ) : (
                <div className="flex flex-col gap-2">
                  <dt className="text-muted-foreground text-small">
                    {t('detail.dates', { count: content.dates.length })}
                  </dt>
                  <dd>
                    <ol className="flex flex-col">
                      {content.dates.map((date, index) => {
                        const values = dateValues(date, timeZone);
                        const extra = customTexts(date);
                        return (
                          <li
                            key={`${date.start}|${date.end}`}
                            className="border-line flex flex-col gap-2 border-t py-3 first:border-t-0 first:pt-0"
                          >
                            <p className="text-small font-semibold">
                              {t('detail.dateNumber', { number: index + 1 })}
                            </p>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                              {DATE_FIELDS.map((field) => (
                                <div
                                  key={field}
                                  className="flex items-center justify-between gap-2"
                                >
                                  <span className="min-w-0">
                                    <span className="text-muted-foreground text-small block">
                                      {fieldLabel(field)}
                                    </span>
                                    <span className="text-body tabular">{values[field]}</span>
                                  </span>
                                  {copy(values[field], field)}
                                </div>
                              ))}
                            </div>
                            {extra.length > 0 && (
                              <p className="text-muted-foreground text-small break-words">
                                {t('detail.ownValues')} {extra.join(' · ')}
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  </dd>
                </div>
              )}

              {AFTER_DATES.map(row)}
            </dl>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
