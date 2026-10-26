// What a page still waits for from the network, counted for the document on screen.
//
// Why not `page.waitForNetworkIdle`: Puppeteer counts a request until the browser reports it ended, and the browser never reports
// one that a navigation cut short before its answer (the prefetches Next.js makes of the links it sees, a request of the page
// being left). Each of them stays counted for as long as the page lives, so once a single prefetch was still waiting for the
// server when a script moved on, every later wait of that page times out. Measured on its own: four requests cut by a navigation
// are counted four times for good, then eight, then twelve. It made e2e/actions.mjs fail by whole runs (the intra scenarios, three
// rounds out of three, in about one CI run in five and every time in the stress workflow, where a script navigates hundreds of
// times) and made the waits of e2e/events.mjs, which ignored their timeout, last their whole 15 seconds.
//
// Here a request counts for the document that made it: a new document forgets the requests of the one it replaces.
import { setTimeout as sleep } from 'node:timers/promises';

const watched = new WeakMap();

/**
 * Starts counting the requests of `page` (once: asking again gives the same watcher). Do it when the page is made, a request that
 * started before is not known. Returns `{ rests, describe }`.
 */
export async function watchNetwork(page) {
  const existing = watched.get(page);
  if (existing) return existing;

  const session = await page.createCDPSession();
  await session.send('Network.enable');

  /** The requests the browser started and has not reported ended, by its own identifier. */
  const inFlight = new Map();
  let documentId;

  session.on('Network.requestWillBeSent', ({ requestId, loaderId, type, request }) => {
    if (type === 'Document') {
      // A new document: what the one before had on its way no longer counts (and is never reported ended).
      documentId = loaderId;
    }
    inFlight.set(requestId, {
      method: request.method,
      url: request.url,
      type,
      loaderId,
      since: Date.now(),
    });
  });
  const ended = ({ requestId }) => inFlight.delete(requestId);
  session.on('Network.loadingFinished', ended);
  session.on('Network.loadingFailed', ended);

  const current = () => [...inFlight.values()].filter((request) => request.loaderId === documentId);

  /** The requests of the document on screen that have not ended, oldest first, without their query (it may hold a token). */
  const describe = () => {
    const open = current();
    if (open.length === 0) return 'nothing in flight';
    const told = open.slice(0, 8).map(({ method, url, type, since }) => {
      const { pathname } = new URL(url);
      return `${method} ${pathname} (${type}, ${Date.now() - since} ms)`;
    });
    return told.join('; ') + (open.length > 8 ? `; and ${open.length - 8} more` : '');
  };

  /** Resolves once nothing of the document on screen has been on its way for `idleTime` ms; rejects after `timeout` ms. */
  const rests = async ({ idleTime = 500, timeout = 15000 } = {}) => {
    const deadline = Date.now() + timeout;
    let quietSince = null;
    for (;;) {
      const now = Date.now();
      if (current().length > 0) quietSince = null;
      else quietSince ??= now;
      if (quietSince !== null && now - quietSince >= idleTime) return;
      if (now >= deadline) {
        throw new Error(
          `Timed out after waiting ${timeout}ms for the network to rest [${describe()}]`,
        );
      }
      await sleep(50);
    }
  };

  const watcher = { rests, describe };
  watched.set(page, watcher);
  return watcher;
}

/** `watchNetwork(page)` then `rests(options)`: for a script that waits in a few places. */
export async function networkRests(page, options) {
  return (await watchNetwork(page)).rests(options);
}
