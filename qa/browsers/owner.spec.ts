import { expect, test } from './fixtures';
import { solidPng } from './png';

/**
 * The owner, in every engine: every page of the board opens, and the one place where a file travels from the browser to the
 * platform, the logo (a file input, a preview, an upload, a confirmation to go back), works in each engine's own way.
 */

const BOARD = [
  ['/en/dashboard', /^Dashboard · /],
  ['/en/events', /^Events · /],
  ['/en/events/review', /^To validate · /],
  ['/en/members', /^Member management · /],
  ['/en/roles', /^Roles · /],
  ['/en/audit-log', /^Audit log · /],
  ['/en/settings', /^Settings · /],
  ['/en/profile', /^My profile · /],
] as const;

test.describe('an owner', () => {
  test('opens every page of the board, from the menu and by address', async ({ as }) => {
    const page = await as('owner');
    for (const [path, title] of BOARD) {
      await page.goto(path);
      await expect(page, path).toHaveTitle(title);
      await expect(page.getByRole('main').getByRole('heading', { level: 1 }), path).toBeVisible();
    }

    // The menu lists them too, with the proposals waiting counted for those who validate.
    await page.goto('/en/dashboard');
    const menu = page.getByRole('navigation', { name: 'Navigation' });
    for (const name of ['Dashboard', 'Events', 'Members', 'Roles', 'Audit log', 'Settings']) {
      await expect(menu.getByRole('link', { name, exact: true })).toBeVisible();
    }
    await expect(
      menu.getByRole('link', { name: /^To validate \d+ proposals? to validate$/ }),
    ).toBeVisible();
  });

  test('uploads a logo, sees it in the menu, and goes back to the default one', async ({ as }) => {
    const page = await as('owner');
    await page.goto('/en/settings');
    const region = page.getByRole('region', { name: 'Logo' });
    await expect(region.getByText('The logo that comes with the platform')).toBeVisible();

    try {
      // A real PNG, chosen the way a person does: through the file input behind the button.
      await region.locator('input[type=file]').setInputFiles({
        name: 'logo.png',
        mimeType: 'image/png',
        buffer: solidPng(128, [15, 118, 110]),
      });
      // The picture shown is the chosen file itself, before anything is sent.
      await expect(region.getByText('Preview of the new logo')).toBeVisible();
      await expect(region.getByRole('img', { name: 'Current logo' })).toHaveAttribute(
        'src',
        /^blob:/,
      );
      await region.getByRole('button', { name: 'Save the logo' }).click();
      await expect(region.getByText("Your BDE's logo")).toBeVisible();

      // The address of the image is the platform's own, and the browser really draws it (128 pixels wide).
      const current = region.getByRole('img', { name: 'Current logo' });
      await expect(current).toHaveAttribute('src', /\/api\/logo\?v=[a-f0-9]{16}/);
      await expect
        .poll(() => current.evaluate((image: HTMLImageElement) => image.naturalWidth))
        .toBe(128);

      // What is served is the image, and nothing a browser could take for a page.
      const src = (await current.getAttribute('src')) ?? '';
      const served = await page.request.get(src);
      expect(served.status()).toBe(200);
      expect(served.headers()['content-type']).toBe('image/png');
      expect(served.headers()['x-content-type-options']).toBe('nosniff');
      expect(served.headers()['content-security-policy']).toBe("default-src 'none'; sandbox");
    } finally {
      // Whatever happened above, the platform is left with the logo it came with.
      await page.goto('/en/settings');
      const back = page
        .getByRole('region', { name: 'Logo' })
        .getByRole('button', { name: 'Back to the default logo' });
      if (await back.isVisible()) {
        await back.click();
        await page
          .getByRole('dialog')
          .getByRole('button', { name: 'Back to the default logo' })
          .click();
        await expect(
          page
            .getByRole('region', { name: 'Logo' })
            .getByText('The logo that comes with the platform'),
        ).toBeVisible();
      }
    }
  });

  test('is refused a file that is not an image, whatever its name says', async ({ as }) => {
    const page = await as('owner');
    await page.goto('/en/settings');
    const region = page.getByRole('region', { name: 'Logo' });
    await region.locator('input[type=file]').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: Buffer.from('<html><script>alert(1)</script></html>'),
    });
    // The platform reads the bytes, not the name: a page called logo.png is not a PNG.
    await region.getByRole('button', { name: 'Save the logo' }).click();
    await expect(region.getByText(/Format not accepted/)).toBeVisible();
    // And nothing was stored: the default logo is still the one in use.
    await page.reload();
    await expect(
      page.getByRole('region', { name: 'Logo' }).getByText('The logo that comes with the platform'),
    ).toBeVisible();
  });
});
