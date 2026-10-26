// @vitest-environment node
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { watchNetwork } from './network.mjs';

/** A page whose browser connection is an emitter: the test plays the events the browser would send. */
function fakePage() {
  const session = Object.assign(new EventEmitter(), { send: async () => undefined });
  const page = { createCDPSession: async () => session };
  let sequence = 0;
  const browser = {
    navigate: () => {
      const id = `doc-${++sequence}`;
      session.emit('Network.requestWillBeSent', {
        requestId: id,
        loaderId: id,
        type: 'Document',
        request: { method: 'GET', url: 'http://platform/fr/settings' },
      });
      session.emit('Network.loadingFinished', { requestId: id });
      return id;
    },
    start: (loaderId: string, url = 'http://platform/fr/members?_rsc=abc') => {
      const id = `req-${++sequence}`;
      session.emit('Network.requestWillBeSent', {
        requestId: id,
        loaderId,
        type: 'Fetch',
        request: { method: 'GET', url },
      });
      return id;
    },
    finish: (requestId: string) => session.emit('Network.loadingFinished', { requestId }),
    fail: (requestId: string) => session.emit('Network.loadingFailed', { requestId }),
  };
  return { page, browser };
}

describe('watchNetwork', () => {
  it('rests when nothing is on its way', async () => {
    const { page, browser } = fakePage();
    const network = await watchNetwork(page);
    browser.navigate();
    await expect(network.rests({ idleTime: 60, timeout: 1000 })).resolves.toBeUndefined();
  });

  it('waits for a request of the document, and rests once it ended', async () => {
    const { page, browser } = fakePage();
    const network = await watchNetwork(page);
    const document = browser.navigate();
    const request = browser.start(document);
    await expect(network.rests({ idleTime: 60, timeout: 300 })).rejects.toThrow(/members/);
    browser.finish(request);
    await expect(network.rests({ idleTime: 60, timeout: 1000 })).resolves.toBeUndefined();
  });

  // The defect: the browser never says that a request cut short by a navigation ended, and Puppeteer's own wait counted it for good.
  it('forgets the requests of the document that was left', async () => {
    const { page, browser } = fakePage();
    const network = await watchNetwork(page);
    const first = browser.navigate();
    browser.start(first);
    browser.start(first, 'http://platform/fr/roles?_rsc=abc');
    browser.navigate();
    await expect(network.rests({ idleTime: 60, timeout: 1000 })).resolves.toBeUndefined();
    expect(network.describe()).toBe('nothing in flight');
  });

  it('still counts what the new document asks for', async () => {
    const { page, browser } = fakePage();
    const network = await watchNetwork(page);
    browser.start(browser.navigate());
    const second = browser.navigate();
    browser.start(second, 'http://platform/fr/audit-log?_rsc=abc');
    await expect(network.rests({ idleTime: 60, timeout: 300 })).rejects.toThrow(/audit-log/);
  });

  it('rests once a request failed too', async () => {
    const { page, browser } = fakePage();
    const network = await watchNetwork(page);
    const request = browser.start(browser.navigate());
    await expect(network.rests({ idleTime: 60, timeout: 200 })).rejects.toThrow(/members/);
    browser.fail(request);
    await expect(network.rests({ idleTime: 60, timeout: 1000 })).resolves.toBeUndefined();
  });

  it('waits for the quiet time after the last request ended', async () => {
    const { page, browser } = fakePage();
    const network = await watchNetwork(page);
    const request = browser.start(browser.navigate());
    setTimeout(() => browser.finish(request), 60);
    const since = Date.now();
    await network.rests({ idleTime: 200, timeout: 2000 });
    expect(Date.now() - since).toBeGreaterThanOrEqual(240);
  });

  it('does not tell a query, which may hold a token', async () => {
    const { page, browser } = fakePage();
    const network = await watchNetwork(page);
    browser.start(browser.navigate(), 'http://platform/api/calendar?token=secret-value');
    expect(network.describe()).toContain('/api/calendar');
    expect(network.describe()).not.toContain('secret-value');
  });

  it('is one watcher for one page', async () => {
    const { page } = fakePage();
    expect(await watchNetwork(page)).toBe(await watchNetwork(page));
  });
});
