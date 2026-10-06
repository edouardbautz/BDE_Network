import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config', () => ({ getConfig: vi.fn() }));

const { getConfig } = await import('@/config');
const { DEFAULT_AVATAR_PATH, discordSender, forgetCheckedLogos, isPublicHost, resolveLogoUrl } =
  await import('./sender');

const fetchMock = vi.fn();

function useBde(bde: { name: string; logoPath: string }) {
  vi.mocked(getConfig).mockReturnValue({ bde } as unknown as ReturnType<typeof getConfig>);
}

/** The server answers HEAD for these addresses with the given content type; 404 for the others. */
function serve(images: Record<string, string>) {
  fetchMock.mockImplementation(async (url: string) => {
    const type = images[url];
    return {
      ok: type !== undefined,
      status: type === undefined ? 404 : 200,
      headers: new Headers(type ? { 'content-type': type } : {}),
    };
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  forgetCheckedLogos();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('APP_URL', 'https://bde.example.fr');
  useBde({ name: 'BDE Nice', logoPath: '/logo.svg' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('isPublicHost', () => {
  it.each([
    'bde.example.fr',
    'www.bde-nice.org',
    '8.8.8.8',
    '172.15.0.1',
    '172.32.0.1',
    '169.253.1.1',
    '2606:4700::1111',
  ])('%s can be reached from the Internet', (host) => {
    expect(isPublicHost(host)).toBe(true);
  });

  it.each([
    'localhost',
    'app.localhost',
    'LOCALHOST',
    'bde.local',
    'nas.lan',
    'app.internal',
    'intranet',
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.20',
    '169.254.1.1',
    '0.0.0.0',
    '::1',
    '[::1]',
    'fd12:3456::1',
    'fc00::1',
    'fe80::1',
  ])('%s cannot', (host) => {
    expect(isPublicHost(host)).toBe(false);
  });
});

describe('resolveLogoUrl', () => {
  const png = 'https://bde.example.fr/logo.png';

  it('gives the default logo.png when the BDE logo is an SVG, once the server shows it as an image', async () => {
    serve({ [png]: 'image/png' });
    await expect(resolveLogoUrl('https://bde.example.fr', '/logo.svg')).resolves.toBe(png);
    expect(DEFAULT_AVATAR_PATH).toBe('/logo.png');
  });

  it("gives the BDE's own raster logo when it has one", async () => {
    serve({ 'https://bde.example.fr/brand/mon-logo.webp': 'image/webp' });
    await expect(resolveLogoUrl('https://bde.example.fr', '/brand/mon-logo.webp')).resolves.toBe(
      'https://bde.example.fr/brand/mon-logo.webp',
    );
  });

  it.each(['/a.png', '/a.PNG', '/a.jpg', '/a.jpeg', '/a.gif', '/a.webp'])(
    'accepts %s as an avatar',
    async (path) => {
      serve({ [`https://bde.example.fr${path}`]: 'image/png' });
      await expect(resolveLogoUrl('https://bde.example.fr', path)).resolves.toBe(
        `https://bde.example.fr${path}`,
      );
    },
  );

  it('ignores a logo that is not a raster picture and uses the default instead', async () => {
    serve({ [png]: 'image/png' });
    await expect(resolveLogoUrl('https://bde.example.fr', '/logo.avif')).resolves.toBe(png);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([png]);
  });

  it('never points to another site, whatever the path says', async () => {
    serve({ [png]: 'image/png' });
    await expect(resolveLogoUrl('https://bde.example.fr', '//evil.example/x.png')).resolves.toBe(
      png,
    );
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([png]);
  });

  it('builds the address from the site only, not from a path or query in APP_URL', async () => {
    serve({ [png]: 'image/png' });
    await expect(resolveLogoUrl('https://bde.example.fr/app?x=1', '/logo.svg')).resolves.toBe(png);
  });

  it('gives nothing when APP_URL is missing, blank or not an http address', async () => {
    serve({ [png]: 'image/png' });
    for (const appUrl of [undefined, '', '   ', 'bde.example.fr', 'ftp://bde.example.fr']) {
      await expect(resolveLogoUrl(appUrl, '/logo.svg')).resolves.toBeUndefined();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives nothing, without even asking, when the site is not on the Internet', async () => {
    for (const appUrl of ['http://localhost:3000', 'http://192.168.1.20', 'http://nas.local']) {
      await expect(resolveLogoUrl(appUrl, '/logo.svg')).resolves.toBeUndefined();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a private address when the reader fetches the logo from its own machine (e-mail)', async () => {
    const url = 'http://192.168.1.20/logo.png';
    serve({ [url]: 'image/png' });
    for (const appUrl of ['http://localhost:3000', 'http://192.168.1.20', 'http://nas.local']) {
      forgetCheckedLogos();
      serve({ [`${new URL(appUrl).origin}/logo.png`]: 'image/png' });
      await expect(resolveLogoUrl(appUrl, '/logo.svg', { requirePublic: false })).resolves.toBe(
        `${new URL(appUrl).origin}/logo.png`,
      );
    }
  });

  it('still checks that a private address answers as an image', async () => {
    serve({});
    await expect(
      resolveLogoUrl('http://localhost:3000', '/logo.svg', { requirePublic: false }),
    ).resolves.toBeUndefined();
  });

  it('gives nothing when the picture is missing, is not an image or the server is down', async () => {
    serve({});
    await expect(resolveLogoUrl('https://bde.example.fr', '/logo.svg')).resolves.toBeUndefined();

    forgetCheckedLogos();
    serve({ [png]: 'image/svg+xml' });
    await expect(resolveLogoUrl('https://bde.example.fr', '/logo.svg')).resolves.toBeUndefined();

    forgetCheckedLogos();
    serve({ [png]: 'text/html' });
    await expect(resolveLogoUrl('https://bde.example.fr', '/logo.svg')).resolves.toBeUndefined();

    forgetCheckedLogos();
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(resolveLogoUrl('https://bde.example.fr', '/logo.svg')).resolves.toBeUndefined();
  });

  it('gives nothing for an error page, even one served with an image type', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers({ 'content-type': 'image/png' }),
    });
    await expect(resolveLogoUrl('https://bde.example.fr', '/logo.svg')).resolves.toBeUndefined();
  });

  it('asks the server with a short time limit, so a slow one cannot hold a notification', async () => {
    serve({ [png]: 'image/png' });
    await resolveLogoUrl('https://bde.example.fr', '/logo.svg');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('HEAD');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('remembers the answer instead of asking again for every notification, then forgets it', async () => {
    vi.useFakeTimers();
    try {
      serve({ [png]: 'image/png' });
      await resolveLogoUrl('https://bde.example.fr', '/logo.svg');
      await resolveLogoUrl('https://bde.example.fr', '/logo.svg');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(11 * 60 * 1000);
      await resolveLogoUrl('https://bde.example.fr', '/logo.svg');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('remembers a refusal too, so a missing logo is not looked for again and again', async () => {
    serve({});
    await resolveLogoUrl('https://bde.example.fr', '/logo.svg');
    await resolveLogoUrl('https://bde.example.fr', '/logo.svg');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('discordSender', () => {
  it("is the BDE's name and its logo when Discord can show it", async () => {
    serve({ 'https://bde.example.fr/logo.png': 'image/png' });
    await expect(discordSender()).resolves.toEqual({
      username: 'BDE Nice',
      avatarUrl: 'https://bde.example.fr/logo.png',
    });
  });

  it('is the name alone when the logo cannot be shown (local install)', async () => {
    vi.stubEnv('APP_URL', 'http://localhost:3000');
    await expect(discordSender()).resolves.toEqual({ username: 'BDE Nice' });
  });

  it('is the name alone when APP_URL is not set', async () => {
    vi.stubEnv('APP_URL', '');
    await expect(discordSender()).resolves.toEqual({ username: 'BDE Nice' });
  });

  it('trims the name and cuts it to the 80 characters Discord allows', async () => {
    vi.stubEnv('APP_URL', '');
    useBde({ name: `  ${'B'.repeat(120)}  `, logoPath: '/logo.svg' });
    const { username } = await discordSender();
    expect(Array.from(username ?? '')).toHaveLength(80);
    expect(username?.endsWith('…')).toBe(true);
  });

  it.each(['Discord Nice', 'Le BDE de CLYDE', 'clyde'])(
    'sends no name when Discord would refuse it (%s): the webhook keeps its own',
    async (name) => {
      vi.stubEnv('APP_URL', '');
      useBde({ name, logoPath: '/logo.svg' });
      await expect(discordSender()).resolves.toEqual({});
    },
  );

  it('sends no name for a blank one', async () => {
    vi.stubEnv('APP_URL', '');
    useBde({ name: '   ', logoPath: '/logo.svg' });
    await expect(discordSender()).resolves.toEqual({});
  });
});
