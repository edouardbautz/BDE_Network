import { describe, expect, it, vi } from 'vitest';

vi.mock('@/config', () => ({ getConfig: vi.fn(() => ({ bde: { name: 'BDE Test' } })) }));
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async ({ locale, namespace }: { locale: string; namespace: string }) => {
    return (key: string) => `${locale}:${namespace}.${key}`;
  }),
}));

const { pageTitle } = await import('./page-title');

describe('pageTitle', () => {
  it('titles the page with one message of the catalog, in the locale of the route', async () => {
    const generate = pageTitle('members', 'title');

    await expect(generate({ params: Promise.resolve({ locale: 'en' }) })).resolves.toEqual({
      title: 'en:members.title',
    });
  });

  it('adds the BDE name itself for the page the layout template does not reach', async () => {
    const generate = pageTitle('auth', 'loginTitle', { framed: true });

    await expect(generate({ params: Promise.resolve({ locale: 'fr' }) })).resolves.toEqual({
      title: 'fr:auth.loginTitle · BDE Test',
    });
  });
});
