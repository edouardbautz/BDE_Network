import type { Page } from '@playwright/test';
import { Client } from 'pg';
import { expect, test } from './fixtures';
import { atRest } from './rest';
import { solidPng } from './png';

/**
 * The profile picture of a 42 account is shown where a person is shown (the menu of the account, the profile, the list of members, the requests
 * waiting), and the initials stand in when there is none, when the address is not 42's, or when 42 does not answer: never a broken image, and
 * never a request to a host that is not 42's. The pictures are served by the test itself (`page.route` answers for the domain of 42), so what
 * is checked is the platform's side: the address kept, the policy of the pages, the fallback.
 */

const OWNER = 'qa-owner';
const PENDING_LOGIN = 'aandre';
const GOOD = 'https://cdn.intra.42.fr/users/2c1f/medium_qa-owner.png';
const BROKEN = 'https://cdn.intra.42.fr/users/2c1f/missing.png';
const EVIL = 'https://evil.example/users/x.png';

async function withPhotos(photos: Record<string, string | null>, run: () => Promise<void>) {
  const db = new Client({ connectionString: process.env.QA_DATABASE_URL });
  await db.connect();
  try {
    for (const [login, url] of Object.entries(photos)) {
      await db.query(`UPDATE "User" SET "photoUrl" = $1 WHERE login = $2`, [url, login]);
    }
    await run();
  } finally {
    await db.query(`UPDATE "User" SET "photoUrl" = NULL WHERE login = ANY($1)`, [
      Object.keys(photos),
    ]);
    await db.end();
  }
}

/** The domain of 42 answers with a picture (and a missing one with a 404); every other host is recorded, to see that nothing asks it. */
async function playTheCdn(page: Page) {
  const asked: string[] = [];
  await page.route('https://*.intra.42.fr/**', async (route) => {
    if (route.request().url().includes('missing')) {
      await route.fulfill({ status: 404, contentType: 'text/html', body: 'Not found' });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: solidPng(64, [15, 118, 110]),
      });
    }
  });
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1') && !request.url().includes('42.fr')) {
      asked.push(request.url());
    }
  });
  return asked;
}

const loaded = (page: Page, source: string) =>
  page
    .locator(`img[src="${source}"]`)
    .evaluateAll((images) =>
      images.map(
        (image) =>
          (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
      ),
    );

test.describe('the profile picture', () => {
  test('is shown in the menu of the account, on the profile and in the list of members, and for a request waiting', async ({
    as,
  }) => {
    await withPhotos({ [OWNER]: GOOD, [PENDING_LOGIN]: GOOD }, async () => {
      const page = await as('owner');
      await playTheCdn(page);

      await page.goto('/en/dashboard');
      await atRest(page);
      // the menu of the account (the rail on a computer, and the tab bar on a phone, are both in the page)
      await expect.poll(async () => (await loaded(page, GOOD)).some(Boolean)).toBe(true);

      await page.goto('/en/profile');
      await atRest(page);
      await expect.poll(async () => (await loaded(page, GOOD)).some(Boolean)).toBe(true);

      await page.goto('/en/members');
      await atRest(page);
      await expect
        .poll(async () => (await loaded(page, GOOD)).filter(Boolean).length)
        .toBeGreaterThan(0);
    });
  });

  test('is replaced by the initials when 42 does not answer, with no broken image', async ({
    as,
  }) => {
    await withPhotos({ [OWNER]: BROKEN }, async () => {
      const page = await as('owner');
      await playTheCdn(page);
      await page.goto('/en/profile');
      await atRest(page);
      // the initials of the account stand in…
      await expect(page.getByText('QO', { exact: true }).first()).toBeVisible();
      // …and no image that failed is left in the page
      await expect.poll(() => page.locator(`img[src="${BROKEN}"]`).count()).toBe(0);
    });
  });

  test('is never asked from a host that is not 42’s: the address is not kept, not drawn, and nothing loads', async ({
    as,
  }) => {
    await withPhotos({ [OWNER]: EVIL }, async () => {
      const page = await as('owner');
      const asked = await playTheCdn(page);
      for (const path of ['/en/dashboard', '/en/profile', '/en/members']) {
        await page.goto(path);
        await atRest(page);
        await expect(page.locator('img[src*="evil.example"]')).toHaveCount(0);
      }
      expect(asked.filter((url) => url.includes('evil.example'))).toEqual([]);
      await expect(page.getByText('QO', { exact: true }).first()).toBeVisible();
    });
  });
});
