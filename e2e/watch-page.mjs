// What the end-to-end scripts need to know about a page that raised an error: in which document it was raised (the
// page being left or the one being opened), how long after that document began, from which script, and (when SHOTS is
// set) what the browser had drawn against what the server sent. A React "hydration" error (#418) is the case this was
// written for: it says only that the two differ, never how, and it left us guessing between a page drawn differently
// by the server and by the browser (a real bug) and a click that came before the page was ready (the test's own doing).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The page as the browser holds it, and as the server sends it for the same address (same cookies, same headers). */
async function snapshot(page) {
  return page.evaluate(async () => {
    const server = await fetch(location.href, { headers: { Accept: 'text/html' } })
      .then((response) => response.text())
      .catch((error) => `fetch failed: ${error.message}`);
    return {
      readyState: document.readyState,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      dom: document.documentElement.outerHTML,
      server,
    };
  });
}

/**
 * Starts watching `page`. `errors` holds what it raised; `describe()` says it in lines (for a failure message) and
 * writes the evidence to `shots` when there is one.
 */
export async function watchPage(page, { label, shots }) {
  const started = Date.now();
  const documents = []; // one per document the main frame has shown, in order
  const errors = [];

  const session = await page.createCDPSession();
  await session.send('Runtime.enable');
  const contexts = new Map(); // execution context id → index in `documents`
  session.on('Runtime.executionContextCreated', ({ context }) => {
    if (context.auxData?.isDefault !== true || context.auxData?.type !== 'default') return;
    documents.push({ createdAt: Date.now(), destroyedAt: null, url: null });
    contexts.set(context.id, documents.length - 1);
  });
  session.on('Runtime.executionContextDestroyed', ({ executionContextId }) => {
    const index = contexts.get(executionContextId);
    if (index !== undefined) documents[index].destroyedAt = Date.now();
  });
  page.on('framenavigated', (frame) => {
    // The document that has just been committed is the last one created.
    if (frame === page.mainFrame() && documents.at(-1) && documents.at(-1).url === null) {
      documents.at(-1).url = frame.url();
    }
  });
  session.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    const at = Date.now();
    const index = contexts.get(exceptionDetails.executionContextId);
    const document = index === undefined ? null : documents[index];
    errors.push({
      at,
      message:
        exceptionDetails.exception?.description?.split('\n')[0] ?? exceptionDetails.text ?? 'error',
      document: index ?? null,
      documentUrl: document?.url ?? null,
      sinceDocumentBegan: document ? at - document.createdAt : null,
      documentLeft: document?.destroyedAt ? true : false,
      script: exceptionDetails.url ? exceptionDetails.url.split('/').pop() : null,
      stack: (exceptionDetails.stackTrace?.callFrames ?? [])
        .slice(0, 4)
        .map((f) => `${f.functionName || '(anonymous)'} ${f.url.split('/').pop()}:${f.lineNumber}`),
      current: page.url(),
      snapshot: shots ? snapshot(page).catch(() => null) : Promise.resolve(null),
    });
  });

  return {
    errors,
    /** One line per error; and, with `shots`, the HTML the browser drew and the HTML the server sent, side by side. */
    async describe() {
      const lines = [];
      let index = 0;
      for (const error of errors) {
        const where = error.documentUrl ? new URL(error.documentUrl) : null;
        const doc = where
          ? `document ${error.document} ${where.pathname}${where.search}, ${error.sinceDocumentBegan} ms after it began`
          : 'a document that is not known';
        lines.push(`${error.message} (${doc}; the page was on ${new URL(error.current).pathname})`);
        const seen = await error.snapshot;
        if (shots) {
          mkdirSync(shots, { recursive: true });
          const base = join(shots, `${label.replace(/\W+/g, '-')}-error-${++index}`);
          if (seen) {
            writeFileSync(`${base}-browser.html`, seen.dom);
            writeFileSync(`${base}-server.html`, seen.server);
          }
          writeFileSync(
            `${base}.json`,
            JSON.stringify(
              {
                message: error.message,
                script: error.script,
                stack: error.stack,
                document: error.document,
                documentUrl: error.documentUrl,
                sinceDocumentBegan: error.sinceDocumentBegan,
                currentUrl: error.current,
                readyState: seen?.readyState,
                browserTimeZone: seen?.timezone,
                sinceStart: error.at - started,
                documents: documents.map((d, i) => ({
                  i,
                  url: d.url,
                  beganMsBeforeError: error.at - d.createdAt,
                  leftMsBeforeError: d.destroyedAt ? error.at - d.destroyedAt : null,
                })),
              },
              null,
              2,
            ),
          );
        }
      }
      return lines;
    },
  };
}

/**
 * Waits until the page is at rest: loaded, hydrated, nothing still streaming in, and nothing moving any more. A page
 * that is left before that raises errors of its own (the stream is cut in the middle of its hydration), which say
 * nothing about the page: every script waits for this before it clicks something that leaves the page.
 */
export async function settled(page, { quietMs = 400, timeout = 15000 } = {}) {
  await page.waitForFunction(
    () =>
      document.readyState === 'complete' &&
      // React has taken the document over
      Object.keys(document).some((key) => key.startsWith('__reactContainer')) &&
      // no part of the page is still streaming in (a Suspense boundary waiting for its content)
      !document.querySelector('template[id^="B:"], template[id^="P:"]') &&
      !document.body.innerHTML.includes('<!--$?-->'),
    { timeout },
  );
  await page.waitForNetworkIdle({ idleTime: quietMs, timeout }).catch(() => undefined);
}
