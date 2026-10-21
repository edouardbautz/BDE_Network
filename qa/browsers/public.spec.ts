import { expect, test } from './fixtures';

/**
 * What somebody who is not signed in (or not approved) sees, in every engine: the pages are public, the language and the
 * theme can be changed, and the pages of the application send them elsewhere rather than show anything.
 */

test.describe('a visitor', () => {
  test('reads the login page, in French and in English, and changes the language from the menu', async ({
    as,
  }) => {
    const page = await as('anonymous');
    await page.goto('/en');
    await expect(page.getByRole('button', { name: 'Sign in with 42' })).toBeVisible();
    await expect(page).toHaveTitle(/Sign in · BDE QA/);

    await page.getByRole('button', { name: 'Language' }).click();
    await page.getByRole('menuitem', { name: 'Français' }).click();
    await expect(page).toHaveURL(/\/fr$/);
    await expect(page.getByRole('button', { name: 'Se connecter avec 42' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');

    await page.getByRole('button', { name: 'Langue' }).click();
    await page.getByRole('menuitem', { name: 'English' }).click();
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('reads the privacy policy without signing in', async ({ as }) => {
    const page = await as('anonymous');
    await page.goto('/en');
    await page.getByRole('link', { name: 'Privacy' }).click();
    await expect(page).toHaveURL(/\/en\/privacy$/);
    await expect(page.getByRole('heading', { name: 'Privacy policy', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
  });

  test('is sent to the login page from every page of the application, never shown one', async ({
    as,
  }) => {
    const page = await as('anonymous');
    for (const path of [
      '/en/dashboard',
      '/en/events',
      '/en/members',
      '/en/settings',
      '/en/profile',
    ]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/en$/);
      await expect(page.getByRole('button', { name: 'Sign in with 42' })).toBeVisible();
    }
  });

  test('gets a 404 page in the language of the address, with a way back', async ({ as }) => {
    const page = await as('anonymous');
    const response = await page.goto('/fr/cette/page/nexiste/pas');
    expect(response?.status()).toBe(404);
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.getByText('Page introuvable')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retour au tableau de bord' })).toBeVisible();
  });

  test('gets the data of nobody from the API routes', async ({ as }) => {
    const page = await as('anonymous');
    for (const path of ['/api/me/export', '/api/updates']) {
      const response = await page.request.get(path);
      expect([401, 404], path).toContain(response.status());
    }
    const health = await page.request.get('/api/health');
    expect(health.status()).toBe(200);
  });
});

test.describe('an account waiting for approval', () => {
  test('is kept on the waiting page, which says who is signed in', async ({ as }) => {
    const page = await as('pending');
    for (const path of ['/en/dashboard', '/en/events']) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/en\/pending$/);
    }
    await expect(page.getByText('Your account is awaiting approval')).toBeVisible();
    await expect(page.getByText('Signed in as QA pending (qa-pending)')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });
});

test.describe('a removed member whose cookie is still valid', () => {
  test('is signed out at the next request', async ({ as }) => {
    const page = await as('deleted');
    await page.goto('/en/dashboard');
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.getByRole('button', { name: 'Sign in with 42' })).toBeVisible();
  });
});
