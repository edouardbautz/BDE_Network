import { expect, test } from './fixtures';

/**
 * The platform serves everything it shows: its font (Manrope, downloaded when the image is built and served from
 * `/_next/static/media/`) and its icons (inline SVG). A page makes no request to Google, nor to anybody else but the platform
 * (the pictures of the profile that come from 42 are the one declared exception, and the dataset has none). The policy already
 * says `font-src 'self'`: this checks it in a browser, on what really loads, and that the font is the one that is drawn.
 */
test.describe('what a page loads', () => {
  const pages: [string, 'anonymous' | 'member' | 'owner'][] = [
    ['/en', 'anonymous'],
    ['/en/dashboard', 'member'],
    ['/en/events', 'member'],
    ['/en/settings', 'owner'],
  ];

  for (const [path, who] of pages) {
    test(`${path} as ${who} makes no request outside the platform, and draws Manrope from it`, async ({
      as,
    }) => {
      const page = await as(who);
      const platform = new URL(process.env.QA_BASE_URL ?? 'http://127.0.0.1:3100').origin;
      const outside: string[] = [];
      const fonts: string[] = [];
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.protocol === 'data:' || url.protocol === 'blob:') return;
        if (url.origin !== platform) outside.push(request.url());
      });
      page.on('response', (response) => {
        if (response.request().resourceType() === 'font') fonts.push(response.url());
      });

      await page.goto(path);
      await page.waitForLoadState('networkidle');

      expect(outside, 'a request that leaves the platform').toEqual([]);
      // the font is a file of the platform, found under its own address, and the page draws with it
      expect(fonts.length, 'a font file was loaded').toBeGreaterThan(0);
      for (const url of fonts)
        expect(new URL(url).pathname).toMatch(/^\/_next\/static\/media\/.+\.woff2$/);
      const drawn = await page.evaluate(async () => {
        await document.fonts.ready;
        return [...document.fonts].some(
          (face) => /manrope/i.test(face.family) && face.status === 'loaded',
        );
      });
      expect(drawn, 'Manrope is loaded and in use').toBe(true);
    });
  }
});
