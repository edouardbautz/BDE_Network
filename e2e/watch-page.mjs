// What the end-to-end scripts need to know about a page that raised an error: where it was, how long after which
// navigation, and (when SHOTS is set) what the browser had drawn against what the server sent. A React "hydration"
// error (#418) is the case this was written for: it says only that the two differ, never how, and it left us
// guessing between a page drawn differently by the server and by the browser (a real bug) and a click that came
// before the page was ready (the test's own doing).
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
 * Starts watching `page`. `errors` holds what it raised; `describe()` says it in one line (for a failure message) and
 * writes the evidence to `shots` when there is one.
 */
export function watchPage(page, { label, shots }) {
  const navigations = [];
  const errors = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations.push({ at: Date.now(), url: frame.url() });
  });
  page.on('pageerror', (error) => {
    const at = Date.now();
    const last = navigations.at(-1);
    errors.push({
      at,
      message: error.message,
      url: page.url(),
      sinceNavigation: last ? at - last.at : null,
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
        const { pathname, search } = new URL(error.url);
        const since =
          error.sinceNavigation === null
            ? ''
            : `, ${error.sinceNavigation} ms after the last navigation`;
        lines.push(`${error.message} (on ${pathname}${search}${since})`);
        const seen = await error.snapshot;
        if (shots && seen) {
          mkdirSync(shots, { recursive: true });
          const base = join(shots, `${label.replace(/\W+/g, '-')}-error-${++index}`);
          writeFileSync(`${base}-browser.html`, seen.dom);
          writeFileSync(`${base}-server.html`, seen.server);
          writeFileSync(
            `${base}.json`,
            JSON.stringify(
              {
                message: error.message,
                url: error.url,
                readyState: seen.readyState,
                browserTimeZone: seen.timezone,
                sinceNavigation: error.sinceNavigation,
                navigations: navigations.map((n) => ({ msAgo: error.at - n.at, url: n.url })),
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
