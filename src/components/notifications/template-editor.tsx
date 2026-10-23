'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { AlertTriangle, History, MoreHorizontal, Send } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  acknowledgeRevision,
  customizeChannel,
  previewTemplate,
  resetNotification,
  resetTemplate,
  saveTemplate,
  sendTemplateTestMessage,
} from '@/app/[locale]/(app)/notifications/actions';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTab } from '@/components/ui/tabs';
import { isActionTarget } from '@/lib/action-target';
import {
  buttonShown,
  isBlank,
  itemRows,
  orderOf,
  textOf,
  tidy,
  withButton,
  withColor,
  withEmoji,
  withItems,
  withText,
  type ItemRow,
} from '@/lib/notifications/templates/draft';
import type { EditorData, MentionView } from '@/lib/notifications/templates/editor-data';
import { TEMPLATE_LIMITS } from '@/lib/notifications/templates/limits';
import type { Notice } from '@/lib/notifications/templates/notice';
import type { Preview } from '@/lib/notifications/templates/preview';
import type { TemplateIssue, TemplateScope } from '@/lib/notifications/templates/schema';
import type { ItemId, TemplateChannel, TemplateContent } from '@/lib/notifications/templates/types';
import { HistoryDialog } from './history-dialog';
import { ItemsEditor } from './items-editor';
import { MentionTools } from './mention-tools';
import { PreviewPane } from './preview-pane';
import { VariableField, type VariableChoice } from './variable-field';

type Scope = TemplateScope;

interface TemplateEditorProps {
  data: EditorData;
  initialScope: Scope;
  notice: Notice | null;
  /** Which channels the platform can send a test on. */
  testable: Record<TemplateChannel, boolean>;
}

type PreviewState =
  | { status: 'loading'; preview: Preview | null }
  | { status: 'ok'; preview: Preview }
  | { status: 'invalid'; preview: Preview | null }
  | { status: 'failed'; preview: Preview | null };

const SCOPES: Scope[] = ['all', 'discord', 'slack', 'email'];

function emptyRecord<T>(make: (scope: Scope) => T): Record<Scope, T> {
  return Object.fromEntries(SCOPES.map((scope) => [scope, make(scope)])) as Record<Scope, T>;
}

/** The first segment of a path of an issue (`items.list.2.label` → `items`, `button.url` → `button.url`). */
const rootOf = (path: string) => (path.startsWith('button.') ? path : path.split('.')[0]!);

/**
 * The editor of one notification: a tab for all the channels and one for each channel, the fields of the tab, the notification
 * drawn from them as it is typed (by the server, with the code that draws the real one), and the ways back (history, the platform's
 * own). A channel follows the template of all of them until someone customises it. Nothing is saved until Save, and nothing that is
 * typed here can reach a chat or a mailbox except the test message the person asks for.
 */
export function TemplateEditor({ data, initialScope, notice, testable }: TemplateEditorProps) {
  const t = useTranslations('templates');
  const tVariables = useTranslations('templates.variables');
  const tCodes = useTranslations('templates.codes');
  const format = useFormatter();

  const { type } = data;
  const tabs: Scope[] = [...(data.shared.length > 0 ? (['all'] as const) : []), ...data.channels];
  const [scope, setScope] = useState<Scope>(tabs.includes(initialScope) ? initialScope : tabs[0]!);
  const [drafts, setDrafts] = useState<Record<Scope, TemplateContent | null>>(
    emptyRecord((s) => data.scopes[s].content),
  );
  const [saved, setSaved] = useState<Record<Scope, TemplateContent | null>>(
    emptyRecord((s) => data.scopes[s].content),
  );
  const [versions, setVersions] = useState<Record<Scope, number>>(
    emptyRecord((s) => data.scopes[s].version),
  );
  const [mentions, setMentions] = useState<MentionView[]>(data.mentions);
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const [previewChannel, setPreviewChannel] = useState<TemplateChannel>(
    data.shared[0] ?? data.channels[0]!,
  );
  const [state, setState] = useState<PreviewState>({ status: 'loading', preview: null });
  const [issues, setIssues] = useState<Array<TemplateIssue & { scope?: string }>>([]);
  const [conflict, setConflict] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirm, setConfirm] = useState<'reset' | 'resetAll' | null>(null);
  const [liveMentions, setLiveMentions] = useState(false);
  const [liveAsk, setLiveAsk] = useState(false);
  const [saving, startSaving] = useTransition();
  const [testing, startTesting] = useTransition();
  const [testMessage, setTestMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const moreRef = useRef<HTMLButtonElement>(null);

  // ---- what the tab is -----------------------------------------------------------------------------------------------
  const isChannel = scope !== 'all';
  const sharedHere = isChannel && data.shared.includes(scope as TemplateChannel);
  const hasOwn = versions[scope] > 0;
  /** A channel that follows the template for all of them has nothing of its own to edit. */
  const following = sharedHere && !hasOwn;
  const draft = drafts[scope] ?? {};
  const defaults = data.defaults[scope];
  if (!defaults) throw new Error(`no defaults for ${scope}`);
  const channelOfPreview: TemplateChannel = isChannel ? (scope as TemplateChannel) : previewChannel;
  const scopeName = t(`editor.tabs.${scope}`);

  const dirty = (s: Scope) =>
    JSON.stringify(tidy(drafts[s] ?? {})) !== JSON.stringify(tidy(saved[s] ?? {}));
  const anyDirty = SCOPES.some(dirty);
  const canSave = dirty(scope) && !following && !(isBlank(draft) && versions[scope] === 0);

  // ---- the names of the variables ------------------------------------------------------------------------------------
  const names = useMemo(
    () => Object.fromEntries(data.variables.map((v) => [v.id, tVariables(`${v.id}.name`)])),
    [data.variables, tVariables],
  );
  const choices: VariableChoice[] = useMemo(
    () =>
      data.variables.map((v) => ({
        id: v.id,
        name: names[v.id]!,
        label: tVariables(`${v.id}.label`),
        sample: v.sample,
      })),
    [data.variables, names, tVariables],
  );

  // ---- editing --------------------------------------------------------------------------------------------------------
  const edit = (change: (content: TemplateContent) => TemplateContent) =>
    setDrafts((current) => ({ ...current, [scope]: change(current[scope] ?? {}) }));

  const orderForRows: readonly ItemId[] =
    scope === 'all' ? data.items : (data.nativeOrder[scope as TemplateChannel] ?? data.items);
  const rows = itemRows(type, draft, defaults, orderForRows);

  const setRows = (next: ItemRow[], moved: boolean) =>
    edit((content) =>
      withItems(
        content,
        type,
        next,
        { order: moved ? 'custom' : orderOf(content), base: orderForRows },
        defaults,
      ),
    );

  // ---- the preview ----------------------------------------------------------------------------------------------------
  const requestId = useRef(0);
  const draftsKey = JSON.stringify([
    drafts.all,
    drafts[channelOfPreview],
    hasOwn,
    channelOfPreview,
  ]);
  const lastPreview = useRef<Preview | null>(null);
  useEffect(() => {
    const id = ++requestId.current;
    setState((current) => ({ status: 'loading', preview: current.preview ?? lastPreview.current }));
    const timer = setTimeout(async () => {
      const own = data.shared.includes(channelOfPreview)
        ? versions[channelOfPreview] > 0
          ? drafts[channelOfPreview]
          : null
        : drafts[channelOfPreview];
      try {
        const result = await previewTemplate({
          type,
          channel: channelOfPreview,
          drafts: {
            all: data.shared.includes(channelOfPreview) ? drafts.all : null,
            own,
          },
        });
        if (id !== requestId.current) return;
        if (result.ok) {
          lastPreview.current = result.preview;
          setIssues([]);
          setState({ status: 'ok', preview: result.preview });
        } else {
          setIssues(result.issues ?? []);
          setState({ status: 'invalid', preview: lastPreview.current });
        }
      } catch {
        if (id === requestId.current) setState({ status: 'failed', preview: lastPreview.current });
      }
    }, 350);
    return () => clearTimeout(timer);
    // the key stands for the drafts; the rest does not change the picture
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftsKey, type]);

  // ---- leaving with something typed -----------------------------------------------------------------------------------
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [anyDirty]);

  // ---- problems, in words ---------------------------------------------------------------------------------------------
  const issueText = useCallback(
    (issue: TemplateIssue) => {
      const root = rootOf(issue.path) as keyof typeof TEMPLATE_LIMITS;
      const max =
        TEMPLATE_LIMITS[root] ??
        TEMPLATE_LIMITS[issue.path.split('.').at(-1) as keyof typeof TEMPLATE_LIMITS] ??
        0;
      const params = { max, ...issue.params } as Record<string, string | number>;
      if (typeof params.variable === 'string')
        params.variable = names[params.variable] ?? params.variable;
      return tCodes.has(issue.code) ? tCodes(issue.code, params) : tCodes('invalid');
    },
    [names, tCodes],
  );
  const problemsFor = (root: string) =>
    issues.filter((issue) => rootOf(issue.path) === root).map(issueText);
  const errorFor = (root: string) => problemsFor(root)[0] ?? null;
  const itemProblems = issues.filter((issue) => rootOf(issue.path) === 'items').map(issueText);
  const aboveProblems = problemsFor('above');

  // ---- actions --------------------------------------------------------------------------------------------------------
  const save = () =>
    startSaving(async () => {
      setConflict(false);
      const content = tidy(draft);
      const result = await saveTemplate({
        type,
        scope,
        content,
        expectedVersion: versions[scope],
      });
      if (result.ok) {
        setVersions((v) => ({ ...v, [scope]: result.version }));
        setSaved((s) => ({ ...s, [scope]: content }));
        setDrafts((d) => ({ ...d, [scope]: content }));
        toast.success(result.changed ? t('editor.saved') : t('editor.nothingChanged'));
        return;
      }
      if (result.code === 'conflict') setConflict(true);
      else if (result.issues) setIssues(result.issues);
      else toast.error(tCodes.has(result.code) ? tCodes(result.code) : tCodes('unknown'));
    });

  const goTo = async (action: Promise<unknown>) => {
    const result = (await action) as { href?: string; ok?: boolean; code?: string };
    if (isActionTarget(result)) return result;
    if (result.ok === false) {
      toast.error(result.code && tCodes.has(result.code) ? tCodes(result.code) : tCodes('unknown'));
    }
    return undefined;
  };

  const sendTest = () =>
    startTesting(async () => {
      setTestMessage(null);
      const own = data.shared.includes(channelOfPreview)
        ? versions[channelOfPreview] > 0
          ? drafts[channelOfPreview]
          : null
        : drafts[channelOfPreview];
      const result = await sendTemplateTestMessage({
        type,
        channel: channelOfPreview,
        drafts: { all: data.shared.includes(channelOfPreview) ? drafts.all : null, own },
        withMentions: liveMentions,
      });
      if (result.ok) {
        setTestMessage({
          ok: true,
          text: t('test.sent', { channel: t(`channels.${channelOfPreview}`) }),
        });
        return;
      }
      const text =
        result.code === 'rateLimited'
          ? t('test.rateLimited', { seconds: result.retryAfterSeconds ?? 10 })
          : result.code === 'failed'
            ? t('test.failed', { detail: result.detail ?? '' })
            : result.code === 'invalid'
              ? t('test.invalid')
              : t('test.notConfigured', { channel: t(`channels.${channelOfPreview}`) });
      setTestMessage({ ok: false, text });
    });

  const hasMentions =
    (drafts.all?.above ?? '').includes('{@') ||
    (drafts[channelOfPreview]?.above ?? '').includes('{@');
  const testDisabled = !testable[channelOfPreview] || testing || state.status === 'invalid';

  // ---- the banners ----------------------------------------------------------------------------------------------------
  const scopeState = data.scopes[scope];
  const channelNotTicked = isChannel && !data.ticked.includes(scope as TemplateChannel);

  const colour = draft.color;

  const insertField = (id: string, token: string) => {
    const element = document.getElementById(id) as HTMLTextAreaElement | null;
    if (!element) return;
    const start = element.selectionStart ?? element.value.length;
    const end = element.selectionEnd ?? element.value.length;
    const next = element.value.slice(0, start) + token + element.value.slice(end);
    edit((content) => withText(content, 'above', next, defaults));
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const hasLabel = (id: ItemRow['id']) => {
    const fact = defaults.items[id as ItemId];
    return fact?.label !== undefined && fact.label !== '';
  };

  const prefix = `${type}-${scope}`;
  const shownDefaults = defaults;
  const isEmailScope = scope === 'email';
  const canHaveAbove = scope !== 'email';

  return (
    <div className="flex flex-col gap-4">
      {notice && (
        <Alert variant="success">
          <AlertDescription>{t(`notices.${notice}`)}</AlertDescription>
        </Alert>
      )}

      <Tabs value={scope} onValueChange={(value) => setScope(value as Scope)}>
        <TabsList aria-label={t('editor.tabsLabel')}>
          {tabs.map((tab) => (
            <TabsTab key={tab} value={tab}>
              {t(`editor.tabs.${tab}`)}
              {dirty(tab) && (
                <span
                  aria-label={t('editor.unsavedTab')}
                  className="bg-accent-fill size-2 rounded-pill"
                />
              )}
            </TabsTab>
          ))}
        </TabsList>
      </Tabs>

      {scopeState.fallback && (
        <Alert variant="warning">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>{t('banners.fallbackTitle')}</AlertTitle>
          <AlertDescription>
            {t('banners.fallback', {
              date: format.dateTime(new Date(scopeState.fallback.at), {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
              reason: t.has(`fallbackReasons.${scopeState.fallback.reason}`)
                ? t(`fallbackReasons.${scopeState.fallback.reason}`)
                : t('fallbackReasons.unknown'),
            })}
          </AlertDescription>
        </Alert>
      )}

      {scopeState.outdated.length > 0 && (
        <Alert>
          <AlertTitle>{t('banners.outdatedTitle')}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc ps-5">
              {scopeState.outdated.map((note) => (
                <li key={note}>{t.has(`revisions.${note}`) ? t(`revisions.${note}`) : note}</li>
              ))}
            </ul>
            <div className="mt-3">
              <ConfirmDialog
                tone="default"
                triggerVariant="outline"
                triggerSize="sm"
                title={t('banners.acknowledgeTitle')}
                description={t('banners.acknowledgeDescription')}
                confirmLabel={t('banners.acknowledge')}
                onConfirm={() => goTo(acknowledgeRevision({ type, scope }))}
              >
                {t('banners.acknowledge')}
              </ConfirmDialog>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {conflict && (
        <Alert variant="destructive">
          <AlertTitle>{t('banners.conflictTitle')}</AlertTitle>
          <AlertDescription>
            {t('banners.conflict')}
            <div className="mt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => window.location.reload()}
              >
                {t('banners.reload')}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {channelNotTicked && (
        <Alert>
          <AlertDescription>
            {t('banners.notTicked', { channel: t(`channels.${scope}`) })}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex gap-2 xl:hidden" role="group" aria-label={t('editor.viewLabel')}>
        <Button
          type="button"
          size="sm"
          variant={view === 'edit' ? 'default' : 'outline'}
          aria-pressed={view === 'edit'}
          onClick={() => setView('edit')}
        >
          {t('editor.viewEdit')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={view === 'preview' ? 'default' : 'outline'}
          aria-pressed={view === 'preview'}
          onClick={() => setView('preview')}
        >
          {t('editor.viewPreview')}
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* ---- the fields --------------------------------------------------------------------------------------- */}
        <div className={view === 'preview' ? 'max-xl:hidden' : ''}>
          {following ? (
            <div className="bg-surface-2 flex flex-col gap-3 rounded-lg p-4">
              <p className="text-body-strong">
                {t('editor.following', { channel: t(`channels.${scope}`) })}
              </p>
              <p className="text-muted-foreground text-body">{t('editor.followingHelp')}</p>
              <div>
                <ConfirmDialog
                  tone="default"
                  triggerVariant="default"
                  triggerSize="default"
                  title={t('editor.customiseTitle', { channel: t(`channels.${scope}`) })}
                  description={
                    anyDirty
                      ? t('editor.customiseDescriptionDirty')
                      : t('editor.customiseDescription')
                  }
                  confirmLabel={t('editor.customise')}
                  onConfirm={() => goTo(customizeChannel({ type, channel: scope }))}
                >
                  {t('editor.customise')}
                </ConfirmDialog>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {sharedHere && (
                <div className="bg-surface-2 flex flex-col gap-2 rounded-lg p-4">
                  <p className="text-body">
                    {t('editor.customised', { channel: t(`channels.${scope}`) })}
                  </p>
                  <div>
                    <ConfirmDialog
                      triggerVariant="outline"
                      triggerSize="sm"
                      title={t('editor.backToCommonTitle')}
                      description={t('editor.backToCommonDescription', {
                        channel: t(`channels.${scope}`),
                      })}
                      confirmLabel={t('editor.backToCommon')}
                      onConfirm={() => goTo(resetTemplate({ type, scope }))}
                    >
                      {t('editor.backToCommon')}
                    </ConfirmDialog>
                  </div>
                </div>
              )}
              {!sharedHere &&
                isChannel &&
                !data.shared.includes(scope as TemplateChannel) &&
                data.shared.length > 0 && (
                  <p className="text-muted-foreground text-body">{t('editor.ownMessage')}</p>
                )}

              <section aria-labelledby={`${prefix}-h-header`} className="flex flex-col gap-4">
                <h3 id={`${prefix}-h-header`} className="text-title-3">
                  {t('sections.header')}
                </h3>
                {scope === 'discord' && (
                  <div className="flex flex-col gap-1.5 sm:w-40">
                    <Label htmlFor={`${prefix}-emoji`}>{t('fields.emoji')}</Label>
                    <Input
                      id={`${prefix}-emoji`}
                      value={draft.emoji ?? shownDefaults.emoji}
                      aria-invalid={errorFor('emoji') ? true : undefined}
                      autoComplete="off"
                      onChange={(event) =>
                        edit((content) => withEmoji(content, event.target.value.trim(), defaults))
                      }
                    />
                    {errorFor('emoji') && (
                      <p role="alert" className="text-destructive text-body">
                        {errorFor('emoji')}
                      </p>
                    )}
                  </div>
                )}
                <VariableField
                  id={`${prefix}-eyebrow`}
                  label={t('fields.eyebrow')}
                  value={textOf(draft, 'eyebrow', defaults)}
                  onChange={(value) =>
                    edit((content) => withText(content, 'eyebrow', value, defaults))
                  }
                  names={names}
                  choices={choices}
                  hint={t('fields.eyebrowHint')}
                  error={errorFor('eyebrow')}
                />
                <VariableField
                  id={`${prefix}-title`}
                  label={t('fields.title')}
                  value={textOf(draft, 'title', defaults)}
                  onChange={(value) =>
                    edit((content) => withText(content, 'title', value, defaults))
                  }
                  names={names}
                  choices={choices}
                  error={errorFor('title')}
                />
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`${prefix}-color-auto`}>{t('fields.color')}</Label>
                  <div className="flex flex-wrap items-center gap-3">
                    <Switch
                      id={`${prefix}-color-auto`}
                      checked={colour === undefined}
                      onCheckedChange={(automatic) =>
                        edit((content) => withColor(content, automatic ? null : data.bde.accent))
                      }
                      aria-label={t('fields.colorAutomatic')}
                    />
                    <span className="text-body">{t('fields.colorAutomatic')}</span>
                    {colour !== undefined && (
                      <input
                        type="color"
                        value={colour}
                        aria-label={t('fields.colorPick')}
                        className="h-11 w-16 cursor-pointer rounded-md"
                        onChange={(event) =>
                          edit((content) => withColor(content, event.target.value))
                        }
                      />
                    )}
                  </div>
                  {errorFor('color') && (
                    <p role="alert" className="text-destructive text-body">
                      {errorFor('color')}
                    </p>
                  )}
                </div>
              </section>

              {canHaveAbove && (
                <section aria-labelledby={`${prefix}-h-above`} className="flex flex-col gap-4">
                  <h3 id={`${prefix}-h-above`} className="text-title-3">
                    {t('sections.above')}
                  </h3>
                  <VariableField
                    id={`${prefix}-above`}
                    label={t('fields.above')}
                    value={textOf(draft, 'above', defaults)}
                    onChange={(value) =>
                      edit((content) => withText(content, 'above', value, defaults))
                    }
                    names={names}
                    choices={choices}
                    multiline
                    hint={t('fields.aboveHint')}
                    error={aboveProblems[0] ?? null}
                    extra={
                      <MentionTools
                        scope={scope}
                        mentions={mentions}
                        onMentionsChange={setMentions}
                        onInsert={(token) => insertField(`${prefix}-above`, token)}
                      />
                    }
                  />
                  {aboveProblems.slice(1).map((problem) => (
                    <p key={problem} role="alert" className="text-destructive text-body">
                      {problem}
                    </p>
                  ))}
                </section>
              )}

              <section aria-labelledby={`${prefix}-h-items`} className="flex flex-col gap-4">
                <h3 id={`${prefix}-h-items`} className="text-title-3">
                  {t('sections.items')}
                </h3>
                <p className="text-muted-foreground text-body">{t('items.help')}</p>
                <ItemsEditor
                  idPrefix={prefix}
                  rows={rows}
                  onRowsChange={setRows}
                  scope={scope}
                  names={names}
                  choices={choices}
                  hasLabel={hasLabel}
                  problems={itemProblems}
                />
              </section>

              <section aria-labelledby={`${prefix}-h-button`} className="flex flex-col gap-4">
                <h3 id={`${prefix}-h-button`} className="text-title-3">
                  {t('sections.button')}
                </h3>
                <div className="flex items-center gap-3">
                  <Switch
                    id={`${prefix}-button-on`}
                    checked={buttonShown(draft, defaults)}
                    onCheckedChange={(enabled) =>
                      edit((content) => withButton(content, { enabled }, defaults))
                    }
                  />
                  <Label htmlFor={`${prefix}-button-on`}>{t('fields.buttonShow')}</Label>
                </div>
                {buttonShown(draft, defaults) && (
                  <>
                    <VariableField
                      id={`${prefix}-button-label`}
                      label={t('fields.buttonLabel')}
                      value={draft.button?.label ?? defaults.button.label}
                      onChange={(label) =>
                        edit((content) => withButton(content, { label }, defaults))
                      }
                      names={names}
                      choices={[]}
                      error={errorFor('button.label')}
                    />
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`${prefix}-button-url`}>{t('fields.buttonUrl')}</Label>
                      <Input
                        id={`${prefix}-button-url`}
                        type="url"
                        inputMode="url"
                        value={draft.button?.url ?? ''}
                        placeholder="https://"
                        aria-invalid={errorFor('button.url') ? true : undefined}
                        aria-describedby={`${prefix}-button-url-hint`}
                        autoComplete="off"
                        onChange={(event) =>
                          edit((content) =>
                            withButton(content, { url: event.target.value }, defaults),
                          )
                        }
                      />
                      <p
                        id={`${prefix}-button-url-hint`}
                        className="text-muted-foreground text-small"
                      >
                        {t('fields.buttonUrlHint')}
                      </p>
                      {errorFor('button.url') && (
                        <p role="alert" className="text-destructive text-body">
                          {errorFor('button.url')}
                        </p>
                      )}
                    </div>
                  </>
                )}
              </section>

              <section aria-labelledby={`${prefix}-h-footer`} className="flex flex-col gap-4">
                <h3 id={`${prefix}-h-footer`} className="text-title-3">
                  {t('sections.footer')}
                </h3>
                <VariableField
                  id={`${prefix}-footer`}
                  label={t('fields.footer')}
                  value={textOf(draft, 'footer', defaults)}
                  onChange={(value) =>
                    edit((content) => withText(content, 'footer', value, defaults))
                  }
                  names={names}
                  choices={choices}
                  error={errorFor('footer')}
                />
              </section>

              {isEmailScope && (
                <section aria-labelledby={`${prefix}-h-mail`} className="flex flex-col gap-4">
                  <h3 id={`${prefix}-h-mail`} className="text-title-3">
                    {t('sections.email')}
                  </h3>
                  <VariableField
                    id={`${prefix}-subject`}
                    label={t('fields.subject')}
                    value={textOf(draft, 'subject', defaults)}
                    onChange={(value) =>
                      edit((content) => withText(content, 'subject', value, defaults))
                    }
                    names={names}
                    choices={choices}
                    error={errorFor('subject')}
                  />
                  <VariableField
                    id={`${prefix}-preheader`}
                    label={t('fields.preheader')}
                    value={textOf(draft, 'preheader', defaults)}
                    onChange={(value) =>
                      edit((content) => withText(content, 'preheader', value, defaults))
                    }
                    names={names}
                    choices={choices}
                    hint={t('fields.preheaderHint')}
                    error={errorFor('preheader')}
                  />
                  <VariableField
                    id={`${prefix}-note`}
                    label={t('fields.note')}
                    value={textOf(draft, 'note', defaults)}
                    onChange={(value) =>
                      edit((content) => withText(content, 'note', value, defaults))
                    }
                    names={names}
                    choices={choices}
                    multiline
                    error={errorFor('note')}
                  />
                </section>
              )}
            </div>
          )}
        </div>

        {/* ---- the picture ------------------------------------------------------------------------------------ */}
        <div
          className={`flex flex-col gap-3 xl:sticky xl:top-4 xl:self-start ${view === 'edit' ? 'max-xl:hidden' : ''}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-title-3">{t('preview.title')}</h3>
            {!isChannel && data.shared.length > 1 && (
              <div role="group" aria-label={t('preview.on')} className="flex gap-1">
                {data.shared.map((channel) => (
                  <Button
                    key={channel}
                    type="button"
                    size="sm"
                    variant={previewChannel === channel ? 'default' : 'outline'}
                    aria-pressed={previewChannel === channel}
                    onClick={() => setPreviewChannel(channel)}
                  >
                    {t(`channels.${channel}`)}
                  </Button>
                ))}
              </div>
            )}
          </div>
          <div aria-live="polite" className="sr-only">
            {state.status === 'loading' ? t('preview.updating') : t('preview.updated')}
          </div>
          {state.status === 'invalid' && (
            <Alert variant="destructive">
              <AlertDescription>{t('preview.invalid')}</AlertDescription>
            </Alert>
          )}
          {state.status === 'failed' && (
            <Alert variant="destructive">
              <AlertDescription>{t('preview.failed')}</AlertDescription>
            </Alert>
          )}
          {state.preview ? (
            <div className={state.status === 'loading' ? 'opacity-70 transition-opacity' : ''}>
              <PreviewPane
                preview={state.preview}
                locale={data.locale}
                bdeName={data.bde.name}
                labels={Object.fromEntries(mentions.map((m) => [m.externalId, m.label]))}
              />
            </div>
          ) : (
            <p className="text-muted-foreground text-body" role="status">
              {t('preview.loading')}
            </p>
          )}
          <p className="text-muted-foreground text-small">{t('preview.disclaimer')}</p>

          <div className="flex flex-col gap-2">
            {hasMentions && channelOfPreview !== 'email' && (
              <div className="flex items-center gap-3">
                <Switch
                  id={`${prefix}-live`}
                  checked={liveMentions}
                  onCheckedChange={(checked) =>
                    checked ? setLiveAsk(true) : setLiveMentions(false)
                  }
                />
                <Label htmlFor={`${prefix}-live`}>{t('test.liveMentions')}</Label>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" disabled={testDisabled} onClick={sendTest}>
                <Send aria-hidden="true" />
                {testing
                  ? t('test.sending')
                  : t('test.send', { channel: t(`channels.${channelOfPreview}`) })}
              </Button>
              {!testable[channelOfPreview] && (
                <span className="text-muted-foreground text-small">
                  {t('test.notConfigured', { channel: t(`channels.${channelOfPreview}`) })}
                </span>
              )}
            </div>
            {testMessage && (
              <p
                role={testMessage.ok ? 'status' : 'alert'}
                className={testMessage.ok ? 'text-body' : 'text-destructive text-body'}
              >
                {testMessage.text}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ---- the bar of actions --------------------------------------------------------------------------------- */}
      <div className="bg-surface elev-2 sticky bottom-3 max-sm:bottom-24 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3">
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              ref={moreRef}
              render={<Button type="button" variant="outline" aria-label={t('editor.more')} />}
            >
              <MoreHorizontal aria-hidden="true" />
              <span className="max-sm:sr-only">{t('editor.more')}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuItem onClick={() => setHistoryOpen(true)}>
                <History aria-hidden="true" />
                {t('editor.history')}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={versions[scope] === 0}
                onClick={() => setConfirm('reset')}
              >
                {t('editor.resetTab', { scope: scopeName })}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={SCOPES.every((s) => versions[s] === 0)}
                onClick={() => setConfirm('resetAll')}
              >
                {t('editor.resetAll')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {dirty(scope) && !following && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDrafts((d) => ({ ...d, [scope]: saved[scope] }))}
            >
              {t('editor.discard')}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {dirty(scope) && !following && (
            <span className="text-muted-foreground text-small">{t('editor.unsaved')}</span>
          )}
          <Button type="button" disabled={!canSave || saving} onClick={save}>
            {saving ? t('editor.saving') : t('editor.save')}
          </Button>
        </div>
      </div>

      <HistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        type={type}
        scope={scope}
        scopeName={scopeName}
        currentVersion={versions[scope]}
        dirty={dirty(scope)}
      />
      <ConfirmDialog
        open={confirm === 'reset'}
        onOpenChange={(open) => !open && setConfirm(null)}
        returnFocusRef={moreRef}
        title={t('editor.resetTabTitle', { scope: scopeName })}
        description={t('editor.resetTabDescription')}
        confirmLabel={t('editor.reset')}
        onConfirm={() => goTo(resetTemplate({ type, scope }))}
      />
      <ConfirmDialog
        open={confirm === 'resetAll'}
        onOpenChange={(open) => !open && setConfirm(null)}
        returnFocusRef={moreRef}
        title={t('editor.resetAllTitle')}
        description={t('editor.resetAllDescription')}
        confirmLabel={t('editor.reset')}
        onConfirm={() => goTo(resetNotification({ type }))}
      />
      <ConfirmDialog
        tone="default"
        open={liveAsk}
        onOpenChange={setLiveAsk}
        title={t('test.liveTitle')}
        description={t('test.liveDescription')}
        confirmLabel={t('test.liveConfirm')}
        onConfirm={() => setLiveMentions(true)}
      />
    </div>
  );
}
