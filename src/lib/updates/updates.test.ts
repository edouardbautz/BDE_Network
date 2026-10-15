// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RELEASES_REPOSITORY,
  latestRelease,
  readRelease,
  resetLatestReleaseCache,
} from './latest-release';
import { summarizeNotes } from './notes';
import { isNewerVersion, parseVersion, runningVersion } from './version';

describe('versions', () => {
  it('reads major.minor.patch, with an optional preview suffix', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, preview: false });
    expect(parseVersion('1.2.3-rc.1')).toMatchObject({ preview: true });
    for (const bad of ['1.2', 'v1.2.3', '1.2.3.4', 'unknown', '', '1.2.3-', ' 1.2.3']) {
      expect(parseVersion(bad)).toBeNull();
    }
  });

  it('orders by number, not by text', () => {
    expect(isNewerVersion('1.10.0', '1.9.9')).toBe(true);
    expect(isNewerVersion('2.0.0', '1.99.99')).toBe(true);
    expect(isNewerVersion('1.1.1', '1.1.0')).toBe(true);
    expect(isNewerVersion('1.1.0', '1.1.0')).toBe(false);
    expect(isNewerVersion('1.0.9', '1.1.0')).toBe(false);
  });

  it('puts a preview before the version it announces', () => {
    expect(isNewerVersion('1.2.0', '1.2.0-rc.1')).toBe(true);
    expect(isNewerVersion('1.2.0-rc.1', '1.2.0')).toBe(false);
  });

  it('never compares what is not a version', () => {
    expect(isNewerVersion('latest', '1.0.0')).toBe(false);
    expect(isNewerVersion('2.0.0', 'unknown')).toBe(false);
  });

  it('knows the version of the image, and nothing odd', () => {
    expect(runningVersion({ BDE_VERSION: '1.1.0' })).toBe('1.1.0');
    expect(runningVersion({ BDE_VERSION: ' 1.1.0 ' })).toBe('1.1.0');
    expect(runningVersion({ BDE_VERSION: 'unknown' })).toBeNull();
    expect(runningVersion({ BDE_VERSION: '1.1.0; rm -rf /' })).toBeNull();
    expect(runningVersion({})).toBeNull();
  });
});

describe('summarizeNotes', () => {
  it('keeps the first paragraph that is not a heading or a list, as plain text', () => {
    const body =
      '## Title\n\n**Install from the browser** and [update](https://x.test) in `two` steps.\n\n- a list\n';
    expect(summarizeNotes(body)).toBe('Install from the browser and update in two steps.');
  });

  it('skips headings, lists, quotes and rules to find the sentence', () => {
    expect(summarizeNotes('# H\n\n- a\n- b\n\n> quote\n\n---\n\nThe sentence.')).toBe(
      'The sentence.',
    );
    expect(summarizeNotes('- only\n- a list')).toBe('');
    expect(summarizeNotes('')).toBe('');
  });

  it('never keeps markup: the page shows text', () => {
    const text = summarizeNotes('<script>alert(1)</script>Safe <b>text</b> ![img](http://x/y.png)');
    expect(text).not.toContain('<');
    expect(text).toContain('Safe text');
  });

  it('cuts a long paragraph at a word, with an ellipsis', () => {
    const text = summarizeNotes('word '.repeat(200));
    expect(text.length).toBeLessThanOrEqual(321);
    expect(text.endsWith('…')).toBe(true);
    expect(text).not.toMatch(/\s…$/);
  });

  it('reads Windows line endings', () => {
    expect(summarizeNotes('## T\r\n\r\nFirst.\r\n\r\nSecond.')).toBe('First.');
  });
});

const GOOD = {
  tag_name: 'v1.2.0',
  html_url: `https://github.com/${RELEASES_REPOSITORY}/releases/tag/v1.2.0`,
  body: 'What is new.\n\n- a',
  draft: false,
  prerelease: false,
};

describe('readRelease: only a published release of the project is believed', () => {
  it('reads the version, the page and a summary', () => {
    expect(readRelease(GOOD)).toEqual({
      version: '1.2.0',
      url: GOOD.html_url,
      summary: 'What is new.',
    });
  });

  it('refuses a draft, a preview, a tag that is not a version', () => {
    expect(readRelease({ ...GOOD, draft: true })).toBeNull();
    expect(readRelease({ ...GOOD, prerelease: true })).toBeNull();
    expect(readRelease({ ...GOOD, tag_name: 'v1.2.0-rc.1' })).toBeNull();
    expect(readRelease({ ...GOOD, tag_name: 'latest' })).toBeNull();
    expect(readRelease({ ...GOOD, tag_name: '1.2.0' })).toBeNull();
  });

  it('refuses a page that is not the project’s releases (a link the owner is invited to open)', () => {
    expect(
      readRelease({ ...GOOD, html_url: 'https://evil.example/releases/tag/v1.2.0' }),
    ).toBeNull();
    expect(
      readRelease({ ...GOOD, html_url: 'https://github.com/someone/else/releases/tag/v1.2.0' }),
    ).toBeNull();
    expect(readRelease({ ...GOOD, html_url: 'javascript:alert(1)' })).toBeNull();
  });

  it('refuses anything that is not an object', () => {
    for (const bad of [null, undefined, 'x', 3, []]) expect(readRelease(bad)).toBeNull();
  });

  it('tolerates missing notes', () => {
    expect(readRelease({ ...GOOD, body: undefined })).toMatchObject({ summary: '' });
  });
});

describe('latestRelease: asked to GitHub, rarely, and never a problem', () => {
  const ok = () => new Response(JSON.stringify(GOOD), { status: 200 });

  beforeEach(() => {
    resetLatestReleaseCache();
    delete process.env.RELEASES_API_URL;
  });
  afterEach(() => {
    resetLatestReleaseCache();
    delete process.env.RELEASES_API_URL;
  });

  it('asks the project’s latest release, saying which version asks and nothing else', async () => {
    const fetchImpl = vi.fn(async () => ok());
    const release = await latestRelease('1.1.0', fetchImpl as unknown as typeof fetch);
    expect(release?.version).toBe('1.2.0');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.github.com/repos/${RELEASES_REPOSITORY}/releases/latest`);
    expect(init.headers).toEqual({
      Accept: 'application/vnd.github+json',
      'User-Agent': 'BDE_Network/1.1.0',
    });
    expect(init.body).toBeUndefined();
    expect(init.method).toBeUndefined(); // a GET: nothing is sent
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('can be pointed at a stand-in for the tests', async () => {
    process.env.RELEASES_API_URL = 'http://127.0.0.1:4242/';
    const fetchImpl = vi.fn(async () => ok());
    await latestRelease('1.1.0', fetchImpl as unknown as typeof fetch);
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe(
      `http://127.0.0.1:4242/repos/${RELEASES_REPOSITORY}/releases/latest`,
    );
  });

  it('keeps a success 6 hours, then asks again', async () => {
    let clock = 1_000_000;
    const fetchImpl = vi.fn(async () => ok());
    const ask = () => latestRelease('1.1.0', fetchImpl as unknown as typeof fetch, () => clock);
    await ask();
    clock += 5 * 3_600_000;
    await ask();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    clock += 2 * 3_600_000;
    await ask();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps a failure 30 minutes, not 6 hours', async () => {
    let clock = 1_000_000;
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 503 }));
    const ask = () => latestRelease('1.1.0', fetchImpl as unknown as typeof fetch, () => clock);
    expect(await ask()).toBeNull();
    clock += 10 * 60_000;
    await ask();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    clock += 25 * 60_000;
    await ask();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('answers null, never throws, when the network fails or the answer is not JSON', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await latestRelease('1.1.0', down as unknown as typeof fetch)).toBeNull();
    resetLatestReleaseCache();
    const garbage = vi.fn(async () => new Response('<html>', { status: 200 }));
    expect(await latestRelease('1.1.0', garbage as unknown as typeof fetch)).toBeNull();
  });

  it('asks once for simultaneous pages', async () => {
    const fetchImpl = vi.fn(async () => ok());
    const [a, b, c] = await Promise.all([
      latestRelease('1.1.0', fetchImpl as unknown as typeof fetch),
      latestRelease('1.1.0', fetchImpl as unknown as typeof fetch),
      latestRelease('1.1.0', fetchImpl as unknown as typeof fetch),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });
});
