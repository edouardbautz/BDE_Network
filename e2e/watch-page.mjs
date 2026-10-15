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

  // HYDRATION_DEBUG=1: stop the page at the very moment React throws "the server's HTML does not match" and write down
  // what it was hydrating (the components above it, what the browser was given there). It slows the page down: only
  // for hunting a hydration error, never in the CI proper.
  const hydration = [];
  if (process.env.HYDRATION_DEBUG) {
    await session.send('Debugger.enable');
    await session.send('Debugger.setPauseOnExceptions', { state: 'all' });
    session.on('Debugger.paused', async ({ callFrames, data }) => {
      try {
        // React throws #519 (a "this is not a real error" signal) at the place where the HTML stops matching; the #418
        // that is reported comes later, from somewhere else.
        if (!String(data?.description ?? '').includes('#519')) return;
        const found = [];
        for (const frame of callFrames.slice(0, 6)) {
          const { result } = await session.send('Debugger.evaluateOnCallFrame', {
            callFrameId: frame.callFrameId,
            returnByValue: true,
            expression: `(() => {
              try {
                const fiber = Array.from(arguments).find((a) => a && typeof a === 'object' && 'tag' in a && 'return' in a);
                if (!fiber) return null;
                const name = (f) => typeof f.type === 'string' ? f.type : (f.type && (f.type.displayName || f.type.name)) || '(tag ' + f.tag + ')';
                const chain = [];
                let f = fiber;
                let dom = null;
                for (let i = 0; f && i < 30; i++, f = f.return) {
                  const props = f.pendingProps && typeof f.pendingProps === 'object' ? f.pendingProps : null;
                  chain.push({
                    name: name(f),
                    text: typeof f.pendingProps === 'string' ? f.pendingProps.slice(0, 80) : undefined,
                    className: props && typeof props.className === 'string' ? props.className.slice(0, 60) : undefined,
                    id: props && typeof props.id === 'string' ? props.id : undefined,
                    href: props && typeof props.href === 'string' ? props.href : undefined,
                  });
                  if (!dom && f.stateNode instanceof Element) dom = f.stateNode;
                }
                return {
                  chain,
                  parentTag: dom && dom.tagName,
                  parentChildren: dom && Array.from(dom.childNodes).slice(0, 40).map((n) => n.nodeType === 1 ? n.tagName + (n.id ? '#' + n.id : '') + (n.className ? '.' + String(n.className).slice(0, 40) : '') : n.nodeType === 3 ? '"' + n.textContent.slice(0, 40) + '"' : '#' + n.nodeType),
                  parentHtml: dom && dom.outerHTML.slice(0, 1200),
                };
              } catch (e) { return { error: String(e) }; }
            })()`,
          });
          if (result.value) {
            found.push(result.value);
            break;
          }
        }
        hydration.push({ at: Date.now(), found });
      } finally {
        await session.send('Debugger.resume').catch(() => undefined);
      }
    });
  }

  return {
    errors,
    hydration,
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
                hydration,
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
