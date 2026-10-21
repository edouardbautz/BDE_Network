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
