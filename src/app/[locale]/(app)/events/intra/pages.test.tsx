import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToHtml } from '@/test/render-server';

/**
 * The two pages about the requests to publish on the intra: who is turned away before any data is read, and what the staff, the
 * people who only follow, and the people who ask receive in the HTML — the fields in the order of the intra's form, each with its Copy
 * button, the dates in the format the intra takes, and only the buttons the person may press.
 */

const { NotFoundSignal } = vi.hoisted(() => ({
  NotFoundSignal: class NotFoundSignal extends Error {},
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new NotFoundSignal();
  }),
}));
vi.mock('next-intl/server', () => ({
  getLocale: vi.fn(async () => 'fr'),
  getTranslations: vi.fn(
    async () => (key: string, values?: Record<string, unknown>) =>
      values ? `${key}${JSON.stringify(values)}` : key,
  ),
}));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'fr',
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string | { pathname: string };
    children?: ReactNode;
  }) => (
    <a href={typeof href === 'string' ? href : href.pathname} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/config', () => ({
  getConfig: vi.fn(() => ({
    bde: { timezone: 'Europe/Paris', name: 'BDE Test' },
    modules: { enabled: ['events'] },
    events: { categories: [], intraPublication: true },
  })),
}));
vi.mock('@/lib/events/access', () => ({ getIntraAccess: vi.fn() }));
vi.mock('@/lib/events/intra-queries', () => ({
  listIntraRequests: vi.fn(async () => []),
  getIntraRequest: vi.fn(),
}));
vi.mock('./actions', () => ({
  publishOnIntra: vi.fn(),
  refuseOnIntra: vi.fn(),
  markIntraUpdated: vi.fn(),
  requestOnIntra: vi.fn(),
}));

const { getIntraAccess } = await import('@/lib/events/access');
const { getIntraRequest, listIntraRequests } = await import('@/lib/events/intra-queries');
const { default: ListPage } = await import('./page');
const { default: DetailPage } = await import('./[id]/page');
const { hashContent, intraReadiness } = await import('@/lib/events/intra-request');

type Access = Awaited<ReturnType<typeof getIntraAccess>>;
const access = (canPublish: boolean, canRequest: boolean): Access =>
  ({ canPublish, canRequest, session: { user: { login: 'sophie' } } }) as unknown as Access;

const asStaff = access(true, false);
const asFollower = access(false, false);
const asRequester = access(false, true);

const OCT5 = new Date('2026-10-05T16:00:00Z');

const event = (overrides: Record<string, unknown> = {}) => ({
  id: 'evt1',
  title: 'Soirée jeux',
  description: 'Venez avec **vos** jeux',
  location: 'Salle B',
  categoryKey: 'soiree',
  status: 'CONFIRMED' as const,
  startsAt: OCT5,
  endsAt: new Date(OCT5.getTime() + 2 * 3_600_000),
  repeat: null,
  recurrenceUntil: null,
  schoolYear: '2026-2027',
  authorLogin: 'alice',
  updatedAt: new Date('2026-09-01T00:00:00Z'),
  assignees: [],
  cancellations: [],
  occurrences: [],
  author: { fullName: 'Alice A' },
  intraOrganizerLogin: 'alice',
  intraAudience: 'BOTH' as const,
  intraMaxPeople: 60,
  intraWaitingList: true,
  intraKind: 'Meet/meet_up',
  intraUnsubscribeHours: 24,
  intraKeywords: ['bde', 'jeux'],
  ...overrides,
});

const request = (
  status: 'PENDING' | 'PUBLISHED' | 'OUTDATED' | 'REFUSED',
  overrides: Record<string, unknown> = {},
  eventOverrides: Record<string, unknown> = {},
) => {
  const row = event(eventOverrides);
  const readiness = intraReadiness(row as never, 'Europe/Paris');
  if (!readiness.ok) throw new Error('not ready');
  const onIntra = status === 'PUBLISHED' || status === 'OUTDATED';
  return {
    id: `req-${status}`,
    eventId: row.id,
    event: row,
    status,
    contentHash: hashContent(readiness.content),
    publishedContent: onIntra
      ? status === 'OUTDATED'
        ? { ...readiness.content, title: 'Ancien titre' }
        : readiness.content
      : null,
    publishedAt: onIntra ? new Date('2026-09-20T10:00:00Z') : null,
    intraUrl: null,
    refusalComment: status === 'REFUSED' ? 'La salle est prise.' : null,
    requestedAt: new Date('2026-09-10T10:00:00Z'),
    requestedByLogin: 'alice',
    answeredAt: status === 'PENDING' ? null : new Date('2026-09-20T10:00:00Z'),
    answeredByLogin: status === 'PENDING' ? null : 'sophie',
    updatedAt: new Date('2026-09-20T10:00:00Z'),
    ...overrides,
  };
};

const render = async (page: Promise<ReactNode>) => renderToHtml(<>{await page}</>);
const listPage = (search: Record<string, string> = {}) =>
  render(ListPage({ searchParams: Promise.resolve(search) }));
const detailPage = (id = 'evt1', search: Record<string, string> = {}) =>
  render(DetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(search) }));

const positions = (html: string, labels: readonly string[]) =>
  labels.map((label) => html.indexOf(label));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/events/intra', () => {
  it('is a 404 when the platform does not publish on the intra or the person has no right to it', async () => {
    vi.mocked(getIntraAccess).mockResolvedValue(null);
    await expect(listPage()).rejects.toBeInstanceOf(NotFoundSignal);
    expect(listIntraRequests).not.toHaveBeenCalled();
  });

  it('puts what waits for the staff first, then what was answered, each with its status', async () => {
    vi.mocked(getIntraAccess).mockResolvedValue(asStaff);
    vi.mocked(listIntraRequests).mockResolvedValue([
      request('PENDING', {}, { id: 'e1', title: 'En attente' }),
      request('OUTDATED', {}, { id: 'e2', title: 'A mettre a jour' }),
      request('PUBLISHED', {}, { id: 'e3', title: 'Deja publie' }),
      request('REFUSED', {}, { id: 'e4', title: 'Refuse' }),
    ] as never);
    const html = await listPage();

    expect(
      positions(html, ['list.waiting', 'En attente', 'A mettre a jour', 'list.answered']),
    ).toEqual(
      [...positions(html, ['list.waiting', 'En attente', 'A mettre a jour', 'list.answered'])].sort(
        (a, b) => a - b,
      ),
    );
    for (const status of ['PENDING', 'OUTDATED', 'PUBLISHED', 'REFUSED']) {
      expect(html).toContain(`status.${status}`);
    }
    expect(html).toContain('href="/events/intra/e1"');
    expect(html).toContain('list.outdatedNote');
    expect(html).toContain('La salle est prise.');
    expect(html).toContain('list.subtitle');
  });

  it('says to somebody who only follows that they cannot answer', async () => {
    vi.mocked(getIntraAccess).mockResolvedValue(asFollower);
    vi.mocked(listIntraRequests).mockResolvedValue([request('PENDING')] as never);
    expect(await listPage()).toContain('list.subtitleReadOnly');
  });

  it('has an empty state, and one for a list with nothing waiting', async () => {
    vi.mocked(getIntraAccess).mockResolvedValue(asStaff);
    vi.mocked(listIntraRequests).mockResolvedValue([]);
    expect(await listPage()).toContain('list.emptyTitle');

    vi.mocked(listIntraRequests).mockResolvedValue([request('PUBLISHED')] as never);
    const html = await listPage();
    expect(html).toContain('list.nothingWaitingTitle');
    expect(html).toContain('list.answered');
  });

  it('shows a notice that travels in the address, and ignores any other', async () => {
    vi.mocked(getIntraAccess).mockResolvedValue(asStaff);
    expect(await listPage({ notice: 'alreadyAnswered' })).toContain('alreadyAnswered');
    expect(await listPage({ notice: '<script>alert(1)</script>' })).not.toContain('<script>');
  });
});

describe('/events/intra/[id]', () => {
  it('is a 404 without the right, and for a request that does not exist', async () => {
    vi.mocked(getIntraAccess).mockResolvedValue(null);
    await expect(detailPage()).rejects.toBeInstanceOf(NotFoundSignal);
    expect(getIntraRequest).not.toHaveBeenCalled();

    vi.mocked(getIntraAccess).mockResolvedValue(asStaff);
    vi.mocked(getIntraRequest).mockResolvedValue(null);
    await expect(detailPage('nope')).rejects.toBeInstanceOf(NotFoundSignal);
  });

  it('lists the fields in the order of the intra’s form, with a Copy button for each', async () => {
    vi.mocked(getIntraAccess).mockResolvedValue(asStaff);
    vi.mocked(getIntraRequest).mockResolvedValue(request('PENDING') as never);
    const html = await detailPage();

    const order = [
      'fields.organizerLogin',
      'fields.name',
      'fields.availableFor',
      'fields.startDate',
      'fields.startTime',
      'fields.endDate',
      'fields.endTime',
      'fields.description',
      'fields.location',
      'fields.maxPeople',
      'fields.waitingList',
      'fields.kind',
      'fields.unsubscribeHours',
      'fields.keywords',
    ];
    const at = positions(html, order);
    expect(at.every((position) => position >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    // one Copy button for each of the 14 fields
    expect(html.match(/copy<\/span>/g) ?? []).toHaveLength(14);
  });

  it('writes the dates as DD/MM/YYYY and the times as HH:mm in the BDE’s zone, and the description as it was typed', async () => {
    vi.mocked(getIntraAccess).mockResolvedValue(asStaff);
    vi.mocked(getIntraRequest).mockResolvedValue(request('PENDING') as never);
    const html = await detailPage();

    expect(html).toContain('>05/10/2026<');
    expect(html).toContain('>18:00<');
    expect(html).toContain('>20:00<');
    // the Markdown is shown as text, not drawn: it is copied as it is
    expect(html).toContain('Venez avec **vos** jeux');
    expect(html).toContain('bde, jeux');
    expect(html).toContain('Meet/meet_up');
  });

  it('numbers the dates of a series, each with its four values to copy', async () => {
    vi.mocked(getIntraAccess).mockResolvedValue(asStaff);
    vi.mocked(getIntraRequest).mockResolvedValue(
      request(
        'PENDING',
        {},
        {
          repeat: { freq: 'WEEKLY', interval: 1 },
          recurrenceUntil: new Date('2026-10-19T16:00:00Z'),
        },
      ) as never,
    );
    const html = await detailPage();

    expect(html).toContain('detail.dates{&quot;count&quot;:3}');
    expect(html).toContain('detail.dateNumber{&quot;number&quot;:3}');
    expect(html).toContain('>05/10/2026<');
    expect(html).toContain('>12/10/2026<');
    expect(html).toContain('>19/10/2026<');
    // 3 dates × 4 + the 10 other fields
    expect(html.match(/copy<\/span>/g) ?? []).toHaveLength(3 * 4 + 10);
  });

  it('gives the staff the two answers of a request that waits, and nothing else', async () => {
    vi.mocked(getIntraAccess).mockResolvedValue(asStaff);
    vi.mocked(getIntraRequest).mockResolvedValue(request('PENDING') as never);
    const html = await detailPage();

    expect(html).toContain('detail.publish');
    expect(html).toContain('detail.refuse');
    expect(html).not.toContain('detail.updated');
    expect(html).not.toContain('detail.sendAgain');
    expect(html).not.toContain('detail.readOnly');
  });

  it('shows somebody who only follows the request without any answer', async () => {
    vi.mocked(getIntraAccess).mockResolvedValue(asFollower);
    vi.mocked(getIntraRequest).mockResolvedValue(request('PENDING') as never);
    const html = await detailPage();

    expect(html).toContain('detail.readOnly');
    expect(html).not.toContain('detail.publish');
    expect(html).not.toContain('detail.refuse');
  });

  it('shows an event that changed what the intra holds and what it is now, and offers "Intra updated"', async () => {
    vi.mocked(getIntraAccess).mockResolvedValue(asStaff);
    vi.mocked(getIntraRequest).mockResolvedValue(request('OUTDATED') as never);
    const html = await detailPage();

    expect(html).toContain('detail.changes.title');
    expect(html).toContain('Ancien titre');
    expect(html).toContain('Soirée jeux');
    expect(html).toContain('detail.updated');
    expect(html).not.toContain('detail.refuse');
  });

  it('shows a refusal with its reason, and lets whoever asks send the request again', async () => {
    vi.mocked(getIntraAccess).mockResolvedValue(asRequester);
    vi.mocked(getIntraRequest).mockResolvedValue(request('REFUSED') as never);
    const html = await detailPage();

    expect(html).toContain('La salle est prise.');
    expect(html).toContain('detail.sendAgain');
    expect(html).not.toContain('detail.publish');
  });

  it('does not offer to send it again to the staff, who answers but does not ask', async () => {
    vi.mocked(getIntraAccess).mockResolvedValue(asStaff);
    vi.mocked(getIntraRequest).mockResolvedValue(request('REFUSED') as never);
    expect(await detailPage()).not.toContain('detail.sendAgain');
  });

  it('links to the event on the intra in a new tab, without letting the page behind it be reached', async () => {
    vi.mocked(getIntraAccess).mockResolvedValue(asStaff);
    vi.mocked(getIntraRequest).mockResolvedValue(
      request('PUBLISHED', { intraUrl: 'https://profile.intra.42.fr/events/42' }) as never,
    );
    const html = await detailPage();

    expect(html).toContain('href="https://profile.intra.42.fr/events/42"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });
});
