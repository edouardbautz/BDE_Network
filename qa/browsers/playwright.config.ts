import { defineConfig, devices } from '@playwright/test';

/**
 * The journeys of the platform played in the three engines people use (Chromium, Firefox, WebKit), against a platform made
 * by `qa/platform.sh` (see "Browsers" in docs/architecture.md).
 *
 *   sh qa/platform.sh up && eval "$(sh qa/platform.sh env)"
 *   npx playwright test -c qa/browsers --project=chromium
 *
 * No retry, on purpose: a journey that fails now and then is a defect to find, not a result to repeat until it is green
 * (see "Browser tests that fail now and then" in docs/architecture.md). The accounts are the personas of
 * `qa/personas.ts`; nobody signs in through 42, the session cookie is forged with the platform's own secret.
 */
const baseURL = process.env.QA_BASE_URL ?? 'http://127.0.0.1:3100';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  outputDir: process.env.PW_OUTPUT_DIR ?? '../../test-results/browsers',
  // The journeys change the one database of the platform (an event is proposed, then approved): in order.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    // A picture may differ by a few pixels of anti-aliasing from one run to the next; a change of look is far above that.
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.002,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },
  // Where the reference pictures are: the branch the workflow checks out (QA_VISUAL_DIR), or a folder of your own, ignored by git.
  snapshotPathTemplate: `${process.env.QA_VISUAL_DIR ?? '{testDir}/.visual-local'}/{arg}{ext}`,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    // The platform is only ever reached over plain HTTP, on this machine.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    timezoneId: 'Europe/Paris',
    locale: 'en-GB',
  },
  projects: [
    // The pictures are compared in Chromium only, by the project of their own (and made there): see visual.spec.ts.
    { name: 'visual', use: { ...devices['Desktop Chrome'] }, testMatch: /visual\.spec\.ts/ },
    // Every other file runs in the three engines, except what is the page's and not the engine's: what axe reports, and the
    // prefetches Next.js makes (performance.spec.ts) run once, in Chromium (the keyboard ones run in all three).
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /visual\.spec\.ts/ },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testIgnore: /(a11y|visual|performance)\.spec\.ts/,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testIgnore: /(a11y|visual|performance)\.spec\.ts/,
    },
  ],
});
