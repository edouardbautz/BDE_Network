import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/layout/page-header';
import { TemplateEditor } from '@/components/notifications/template-editor';
import { Badge } from '@/components/ui/badge';
import { getConfig } from '@/config';
import { channelsFor } from '@/config/schema';
import { Link, redirect } from '@/i18n/navigation';
import { pageTitle } from '@/lib/page-title';
import { getTemplateEditor } from '@/lib/notifications/templates/access';
import { ITEMS } from '@/lib/notifications/templates/catalog';
import {
  customisedScopes,
  listedTypes,
  loadEditorData,
} from '@/lib/notifications/templates/editor-data';
import { readNotice } from '@/lib/notifications/templates/notice';
import { TEMPLATE_SCOPES, type TemplateScope } from '@/lib/notifications/templates/schema';
import { isChannelConfigured } from '@/lib/notifications/templates/test-send';
import type { TemplateChannel, TemplateType } from '@/lib/notifications/templates/types';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const generateMetadata = pageTitle('templates', 'page.title');

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function NotificationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    type?: string | string[];
    scope?: string | string[];
    notice?: string | string[];
  }>;
}) {
  const { locale } = await params;
  const editor = await getTemplateEditor();
  if (!editor) {
    redirect({ href: '/dashboard', locale });
    return null;
  }

  const config = getConfig();
  const query = await searchParams;
  const types = listedTypes(config.modules.enabled, config.events?.intraPublication === true);
  const requested = first(query.type);
  const selected: TemplateType =
    types.find((type) => type === requested) ?? types[0] ?? (Object.keys(ITEMS)[0] as TemplateType);
  const requestedScope = first(query.scope);
  const scope: TemplateScope = TEMPLATE_SCOPES.find((known) => known === requestedScope) ?? 'all';

  const [t, data, customised] = await Promise.all([
    getTranslations('templates'),
    loadEditorData(selected),
    customisedScopes(),
  ]);
  const testable = Object.fromEntries(
    (['discord', 'slack', 'email'] as const).map((channel) => [
      channel,
      isChannelConfigured(channel) && (channel !== 'email' || Boolean(editor.user.email)),
    ]),
  ) as Record<TemplateChannel, boolean>;

  const groups: Array<{ id: 'events' | 'intra' | 'members'; types: TemplateType[] }> = [
    { id: 'events', types: types.filter((type) => type.startsWith('event')) },
    { id: 'intra', types: types.filter((type) => type.startsWith('intra')) },
    { id: 'members', types: types.filter((type) => type.startsWith('member')) },
  ];

  return (
    <>
      <PageHeader title={t('page.title')} />
      <p className="text-muted-foreground text-body mb-6 max-w-3xl">{t('page.intro')}</p>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <nav aria-label={t('page.listLabel')} className="flex min-w-0 flex-col gap-5">
          {groups
            .filter((group) => group.types.length > 0)
            .map((group) => (
              <div key={group.id} className="flex flex-col gap-1.5">
                <h2 className="text-small text-muted-foreground px-3 uppercase">
                  {t(`page.groups.${group.id}`)}
                </h2>
                <ul className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
                  {group.types.map((type) => {
                    const active = type === selected;
                    const edited = (customised[type] ?? []).length > 0;
                    return (
                      <li key={type} className="shrink-0 lg:shrink">
                        <Link
                          href={{ pathname: '/notifications', query: { type } }}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'flex min-h-11 flex-col gap-1 rounded-lg px-3 py-2.5 transition-colors',
                            active ? 'bg-accent-soft' : 'hover:bg-surface-2',
                          )}
                        >
                          <span className="text-body-strong flex items-center gap-2">
                            {t(`types.${type}.name`)}
                            {edited && <Badge variant="outline">{t('page.customised')}</Badge>}
                          </span>
                          <span className="text-muted-foreground text-small">
                            {channelsFor(config, type).length === 0
                              ? t('page.notSent')
                              : channelsFor(config, type)
                                  .map((channel) => t(`channels.${channel}`))
                                  .join(' · ')}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
        </nav>

        <section aria-labelledby="template-heading" className="flex min-w-0 flex-col gap-4">
          <div>
            <h2 id="template-heading" className="text-title-2">
              {t(`types.${selected}.name`)}
            </h2>
            <p className="text-muted-foreground text-body">{t(`types.${selected}.when`)}</p>
          </div>
          <TemplateEditor
            key={selected}
            data={data}
            initialScope={scope}
            notice={readNotice(query.notice)}
            testable={testable}
          />
        </section>
      </div>
    </>
  );
}
