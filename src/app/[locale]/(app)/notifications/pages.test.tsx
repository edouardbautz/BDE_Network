import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToHtml } from '@/test/render-server';

/**
 * The page of the notifications: whoever does not hold the permission is sent back to the dashboard before anything is read; the
 * list offers the notifications of the modules that are on; an address that asks for something that does not exist (a
 * notification, a tab, a notice) gets the default, never an error.
 */

const { RedirectSignal } = vi.hoisted(() => ({
  RedirectSignal: class RedirectSignal extends Error {
    constructor(public href: string) {
      super(`REDIRECT:${href}`);
    }
  },
}));

const mocks = vi.hoisted(() => ({
  getEditor: vi.fn(),
  loadEditorData: vi.fn(),
  customised: vi.fn(),
  modules: ['events'] as string[],
  configured: vi.fn(),
  editorProps: vi.fn(),
}));

vi.mock('@/i18n/navigation', () => ({
  redirect: vi.fn((options: { href: string }) => {
    throw new RedirectSignal(options.href);
  }),
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: { pathname: string; query: { type: string } };
    children?: ReactNode;
  }) => (
    <a href={`${href.pathname}?type=${href.query.type}`} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () =>
    Object.assign(
      (key: string, values?: Record<string, unknown>) =>
        values ? `${key}${JSON.stringify(values)}` : key,
      { has: () => false },
    ),
  ),
}));
vi.mock('@/config', () => ({
  getConfig: () => ({
    modules: { enabled: mocks.modules },
    notifications: {
      eventConfirmed: ['discord'],
      eventReminder: [],
      eventProposed: [],
      eventApproved: [],
      eventRefused: [],
      memberPending: [],
      memberApproved: [],
      memberRemoved: [],
    },
  }),
}));
vi.mock('@/lib/notifications/templates/access', () => ({ getTemplateEditor: mocks.getEditor }));
vi.mock('@/lib/notifications/templates/editor-data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/notifications/templates/editor-data')>()),
  loadEditorData: mocks.loadEditorData,
  customisedScopes: mocks.customised,
}));
vi.mock('@/lib/notifications/templates/test-send', () => ({
  isChannelConfigured: mocks.configured,
}));
vi.mock('@/components/layout/page-header', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock('@/components/notifications/template-editor', () => ({
  TemplateEditor: (props: Record<string, unknown>) => {
    mocks.editorProps(props);
    return <div data-testid="editor" />;
  },
}));

const { default: Page } = await import('./page');

const params = Promise.resolve({ locale: 'fr' });
const render = (query: Record<string, string | string[]> = {}) =>
  renderToHtml(
    <>{Page({ params, searchParams: Promise.resolve(query) }) as unknown as ReactNode}</>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.modules = ['events'];
  mocks.getEditor.mockResolvedValue({ user: { email: 'paula@exemple.fr' } });
  mocks.loadEditorData.mockImplementation(async (type: string) => ({ type }));
  mocks.customised.mockResolvedValue({});
  mocks.configured.mockImplementation((channel: string) => channel !== 'slack');
});

describe('who gets the page', () => {
  it('sends anybody without the permission back to the dashboard, reading nothing', async () => {
    mocks.getEditor.mockResolvedValue(null);
    await expect(Page({ params, searchParams: Promise.resolve({}) })).rejects.toThrow(
      'REDIRECT:/dashboard',
    );
    expect(mocks.loadEditorData).not.toHaveBeenCalled();
    expect(mocks.customised).not.toHaveBeenCalled();
  });
});

describe('the list', () => {
  it('offers every notification while the events module is on, with the channels it goes to', async () => {
    const html = await render();
    for (const type of [
      'eventConfirmed',
      'eventReminder',
      'eventProposed',
      'eventApproved',
      'eventRefused',
      'memberPending',
      'memberApproved',
      'memberRemoved',
    ]) {
      expect(html).toContain(`types.${type}.name`);
    }
    expect(html).toContain('channels.discord');
    expect(html).toContain('page.notSent');
  });

  it('leaves out the notifications of a module that is off', async () => {
    mocks.modules = [];
    const html = await render();
    expect(html).not.toContain('types.eventConfirmed.name');
    expect(html).toContain('types.memberPending.name');
    expect(mocks.loadEditorData).toHaveBeenCalledWith('memberPending');
  });

  it('marks what the BDE customised', async () => {
    mocks.customised.mockResolvedValue({ eventReminder: ['all'] });
    const html = await render();
    expect(html.match(/page\.customised/g)).toHaveLength(1);
  });

  it('marks the one on screen as the current page', async () => {
    const html = await render({ type: 'eventReminder' });
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*>[^]*?types\.eventReminder\.name/);
  });
});

describe('what the address asks for', () => {
  it('shows the first notification when none is asked for, or an unknown one', async () => {
    await render();
    expect(mocks.loadEditorData).toHaveBeenLastCalledWith('eventConfirmed');
    await render({ type: 'nothing' });
    expect(mocks.loadEditorData).toHaveBeenLastCalledWith('eventConfirmed');
    await render({ type: ['memberRemoved', 'x'] });
    expect(mocks.loadEditorData).toHaveBeenLastCalledWith('memberRemoved');
  });

  it('does not show an events notification while the module is off', async () => {
    mocks.modules = [];
    await render({ type: 'eventConfirmed' });
    expect(mocks.loadEditorData).toHaveBeenLastCalledWith('memberPending');
  });

  it('reads the tab and the notice defensively', async () => {
    await render({ scope: 'slack', notice: 'reset' });
    expect(mocks.editorProps.mock.calls.at(-1)![0]).toMatchObject({
      initialScope: 'slack',
      notice: 'reset',
    });
    await render({ scope: 'x', notice: '<script>' });
    expect(mocks.editorProps.mock.calls.at(-1)![0]).toMatchObject({
      initialScope: 'all',
      notice: null,
    });
  });

  it('tells the editor which channels a test can go through (the e-mail needs the address of the person)', async () => {
    await render();
    expect(mocks.editorProps.mock.calls.at(-1)![0]).toMatchObject({
      testable: { discord: true, slack: false, email: true },
    });
    mocks.getEditor.mockResolvedValue({ user: { email: null } });
    await render();
    expect(mocks.editorProps.mock.calls.at(-1)![0]).toMatchObject({
      testable: { discord: true, slack: false, email: false },
    });
  });
});
