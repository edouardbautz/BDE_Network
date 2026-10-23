import { expect, test } from './fixtures';

/**
 * Every journey of the suite ends by asking what its pages raised: an exception, an error written to the console, a
 * violation of the content policy, a server error. A watcher that sees nothing would let all of them pass, so this one makes
 * a page do each, on purpose, in every engine, and checks it is seen.
 */
test.describe('the watcher of the journeys', () => {
  test('sees an exception, a console error, and a violation of the content policy', async ({
    as,
    problems,
  }) => {
    const page = await as('anonymous');
    await page.goto('/en');
    await expect(page.getByRole('button', { name: 'Sign in with 42' })).toBeVisible();

    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('thrown on purpose');
      });
    });
    await page.evaluate(() => console.error('written on purpose'));
    // The policy forbids evaluating a string: this is the violation Zod used to cause on every page. It is asked later, by
    // the page itself: while the call of the debugging protocol is running, the engines let evaluation through.
    await page.evaluate(() => {
      setTimeout(() => {
        try {
          new Function('return 1');
        } catch {
          // refused, as it should be
        }
      });
    });

    await expect
      .poll(() => problems.list.some((line) => /thrown on purpose/.test(line)))
      .toBe(true);
    await expect
      .poll(() => problems.list.some((line) => /written on purpose/.test(line)))
      .toBe(true);
    await expect
      .poll(() =>
        problems.list.some((line) => /policy violation: script-src blocked eval/.test(line)),
      )
      .toBe(true);

    // What was wanted has been seen: the journey is not to fail on it.
    problems.list.length = 0;
  });

  test('reads an error object whole, even when the page navigates away at once', async ({
    as,
    problems,
  }) => {
    const page = await as('anonymous');
    await page.goto('/en');
    await expect(page.getByRole('button', { name: 'Sign in with 42' })).toBeVisible();
    // What went wrong in a journey once: the arguments were read after the fact, and a page that had already left (a redirect,
    // the next click) gave back "?" instead of the words the judgment of a cancelled fetch needs.
    await page.evaluate(() => {
      console.error(new Error('object read on purpose'));
      const leave = document.createElement('a');
      leave.href = '/en/privacy';
      leave.click();
    });
    await expect(page).toHaveURL(/\/en\/privacy$/);
    await expect
      .poll(() => problems.list.some((line) => /Error: object read on purpose/.test(line)))
      .toBe(true);
    expect(problems.list.some((line) => /console error: \?$/.test(line))).toBe(false);
    problems.list.length = 0;
  });

  test('lets through what an engine raises for a request that a navigation cancelled, and only that', async ({
    as,
    problems,
  }) => {
    const page = await as('anonymous');
    await page.goto('/en');
    await expect(page.getByRole('button', { name: 'Sign in with 42' })).toBeVisible();

    // The engine's word for an aborted fetch, with nothing in flight and no navigation: a real failure, not an abort.
    // (The page has been at rest for a while: the load that brought it here is not a departure "around" the error.)
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      setTimeout(() => {
        throw new TypeError('Load failed');
      });
    });
    await expect.poll(() => page.evaluate(() => true)).toBe(true);
    await page.waitForTimeout(300);
    problems.judge();
    expect(
      problems.list.filter((line) => /Load failed.*no request was cancelled/.test(line)),
    ).toHaveLength(1);
    problems.list.length = 0;

    // The same word while a request of the page is in flight, when the page leaves: the navigation cancelled it, which is all
    // the engine says (WebKit, on some systems, gives no `requestfailed` for it). Nothing is reported.
    await page.route('**/api/stays-in-flight', () => new Promise(() => {}));
    await page.evaluate(() => {
      void fetch('/api/stays-in-flight').catch(() => undefined);
      setTimeout(() => {
        throw new TypeError('Load failed');
      });
    });
    await page.waitForTimeout(300);
    await page.goto('/en/privacy');
    problems.judge();
    expect(problems.list).toEqual([]);

    // And with nothing seen in flight at all (the engine does not always tell), the page leaving right after is the evidence.
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      setTimeout(() => {
        throw new TypeError('Load failed');
      });
    });
    await page.waitForTimeout(100);
    await page.goto('/en/privacy');
    problems.judge();
    expect(problems.list).toEqual([]);
  });

  test('sees a server error', async ({ as, problems }) => {
    const page = await as('anonymous');
    await page.goto('/en');
    // A path that makes the platform answer with a 5xx is not part of the platform: the test answers it itself.
    await page.route('**/api/health', (route) => route.fulfill({ status: 503, body: 'down' }));
    await page.evaluate(() => fetch('/api/health').then(() => undefined));
    await expect
      .poll(() => problems.list.some((line) => /server error: 503/.test(line)))
      .toBe(true);
    problems.list.length = 0;
  });
});
