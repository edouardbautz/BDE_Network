import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { atRest } from './rest';
import { solidPng } from './png';

/**
 * What the platform says about itself to the tab, the home screen of a phone and the readers of a link (Discord, Slack, WhatsApp, iMessage):
 * the icon of the BDE (the one that comes with the platform, or its own logo as soon as it is sent, and the default again when it is
 * removed), a manifest, and a preview that holds the BDE's name, its logo and one generic sentence, on every page and never anything a
 * page shows to a member. The platform is private: the preview of a link to an event does not name the event.
 */

const head = (page: Page) =>
  page.evaluate(() => {
    const read = (selector: string, attribute: string) =>
      Array.from(document.head.querySelectorAll(selector)).map(
        (element) => element.getAttribute(attribute) ?? '',
      );
    return {
      html: document.head.innerHTML,
      icons: Array.from(document.head.querySelectorAll('link[rel="icon"]')).map((link) => ({
        href: link.getAttribute('href') ?? '',
        sizes: link.getAttribute('sizes') ?? '',
      })),
      apple: read('link[rel="apple-touch-icon"]', 'href'),
      manifest: read('link[rel="manifest"]', 'href'),
      title: document.title,
      og: Object.fromEntries(
        Array.from(document.head.querySelectorAll('meta[property^="og:"]')).map((meta) => [
          meta.getAttribute('property') ?? '',
          meta.getAttribute('content') ?? '',
        ]),
      ),
      twitter: Object.fromEntries(
        Array.from(document.head.querySelectorAll('meta[name^="twitter:"]')).map((meta) => [
          meta.getAttribute('name') ?? '',
          meta.getAttribute('content') ?? '',
        ]),
      ),
      description: read('meta[name="description"]', 'content')[0] ?? '',
    };
  });

type Head = Awaited<ReturnType<typeof head>>;

/** The width and the height a PNG announces (read from its header: no decoder needed). */
const pngSize = (bytes: Buffer) => ({
  width: bytes.readUInt32BE(16),
  height: bytes.readUInt32BE(20),
});

test.describe('the icon and the preview of a link', () => {
  test('are in the head of the first page a visitor sees: tab, home screens, manifest, preview', async ({
    as,
  }) => {
    const page = await as('anonymous');
    await page.goto('/en');
    const found = await head(page);

    // the tab: an icon at two sizes, and the home screen of an iPhone
    expect(found.icons.map((icon) => icon.sizes).sort()).toEqual(['192x192', '48x48']);
    expect(found.apple).toHaveLength(1);
    // the manifest of a phone
    expect(found.manifest).toEqual([expect.stringMatching(/^\/api\/manifest/)]);
    // the preview of a link: the name of the BDE, one generic sentence, the logo at an address a reader of a link can fetch
    expect(found.og['og:title']).toBe(found.og['og:site_name']);
    expect(found.og['og:title']).not.toBe('');
    expect(found.og['og:description']).toBe(found.description);
    expect(found.og['og:image']).toMatch(
      /^https?:\/\/.+\.png$|^https?:\/\/.+\/api\/logo\/icon\/512/,
    );
    expect(found.twitter['twitter:card']).toBe('summary');
    expect(found.twitter['twitter:title']).toBe(found.og['og:title']);

    // and every one of those addresses answers with what it promises
    for (const href of [...found.icons.map((icon) => icon.href), ...found.apple]) {
      const response = await page.request.get(href);
      expect(response.status(), href).toBe(200);
      expect(response.headers()['content-type'], href).toBe('image/png');
    }
    const manifest = await page.request.get(found.manifest[0]!);
    expect(manifest.status()).toBe(200);
    expect(manifest.headers()['content-type']).toContain('application/manifest+json');
    const body = (await manifest.json()) as {
      name: string;
      icons: { src: string; sizes: string }[];
      start_url: string;
    };
    expect(body.name).toBe(found.og['og:title']);
    expect(body.icons.map((icon) => icon.sizes)).toEqual(['192x192', '512x512']);
    for (const icon of body.icons) {
      expect((await page.request.get(icon.src)).status(), icon.src).toBe(200);
    }
    expect((await page.request.get('/favicon.ico', { maxRedirects: 0 })).status()).toBe(307);
  });

  test('are the BDE_Network logo by default, not the icon of the tool that made the project', async ({
    as,
  }) => {
    const page = await as('anonymous');
    await page.goto('/en');
    const found = await head(page);
    expect(found.icons.map((icon) => icon.href)).toEqual(
      expect.arrayContaining(['/icons/icon-48.png', '/icons/icon-192.png']),
    );
    expect(found.apple).toEqual(['/icons/icon-180.png']);
    const tab = await page.request.get('/icons/icon-48.png');
    expect(pngSize(await tab.body())).toEqual({ width: 48, height: 48 });
    // no default file of the project's tool is left behind
    expect((await page.request.get('/next.svg')).status()).toBe(404);
    expect((await page.request.get('/vercel.svg')).status()).toBe(404);
  });

  test('say the same thing on every page, and never anything a member sees: not an event, not a person', async ({
    as,
  }) => {
    const visitor = await as('anonymous');
    await visitor.goto('/en');
    const reference = await head(visitor);
    expect(reference.og['og:title'], 'the preview of the login page').toBeTruthy();

    const member = await as('member');
    await member.goto('/en/events');
    await atRest(member);
    // the title of an event of the dataset, and the name of one of the people in charge
    const link = member.locator('a[href^="/en/events/qa-"]').first();
    const href = (await link.getAttribute('href')) ?? '';
    await member.goto(href);
    await atRest(member);
    const eventTitle = (await member.getByRole('heading', { level: 1 }).first().innerText()).trim();
    expect(eventTitle.length).toBeGreaterThan(2);
    const peopleInCharge = (await member.locator('dd').allInnerTexts()).join(' ');

    const seen: Head = await head(member);
    for (const found of [seen, await headOf(visitor, href)]) {
      // the preview is the BDE's: same name, same sentence, same image as on the login page
      expect(found.og['og:title']).toBe(reference.og['og:title']);
      expect(found.og['og:description']).toBe(reference.og['og:description']);
      expect(found.og['og:image']).toBe(reference.og['og:image']);
      expect(found.description).toBe(reference.description);
      // and nothing of the event or of its people is anywhere in the head
      expect(found.html).not.toContain(eventTitle);
      for (const word of peopleInCharge.split(/\s+/).filter((word) => word.length > 4)) {
        expect(found.html, `“${word}” is in the head`).not.toContain(word);
      }
    }
  });

  test('follow the logo the moment it is sent, and the default again when it is removed', async ({
    as,
  }) => {
    const page = await as('owner');
    await page.goto('/en/settings');
    const region = page.getByRole('region', { name: 'Logo' });
    await expect(region.getByText('The logo that comes with the platform')).toBeVisible();
    const before = await head(page);
    expect(before.icons.map((icon) => icon.href)).toContain('/icons/icon-48.png');

    try {
      await region.locator('input[type=file]').setInputFiles({
        name: 'logo.png',
        mimeType: 'image/png',
        buffer: solidPng(300, [15, 118, 110]),
      });
      await region.getByRole('button', { name: 'Save the logo' }).click();
      await expect(region.getByText("Your BDE's logo")).toBeVisible();

      // the very next page says it: icons of the BDE's own logo, their address carrying its version (so no cache keeps the old one)
      await page.goto('/en');
      const after = await head(page);
      const addresses = [...after.icons.map((icon) => icon.href), ...after.apple];
      expect(addresses).toHaveLength(3);
      for (const address of addresses) {
        expect(address).toMatch(/^\/api\/logo\/icon\/(48|180|192)\?v=[a-f0-9]{16}$/);
      }
      expect(after.og['og:image']).toMatch(/\/api\/logo\/icon\/512\?v=[a-f0-9]{16}$/);
      expect(new Set(addresses.map((address) => address.split('?v=')[1])).size).toBe(1);

      // the sizes were drawn by the browser from the logo, and the platform checked them: exactly the size of the icon
      for (const [address, size] of [
        [after.icons.find((icon) => icon.sizes === '48x48')?.href, 48],
        [after.icons.find((icon) => icon.sizes === '192x192')?.href, 192],
        [after.apple[0], 180],
        [after.og['og:image'], 512],
      ] as const) {
        const response = await page.request.get(address ?? '');
        expect(response.status(), address).toBe(200);
        expect(response.headers()['content-type']).toBe('image/png');
        expect(response.headers()['content-security-policy']).toBe("default-src 'none'; sandbox");
        expect(pngSize(await response.body()), address).toEqual({ width: size, height: size });
      }

      // the manifest follows too
      const manifest = (await (await page.request.get(after.manifest[0] ?? '')).json()) as {
        icons: { src: string }[];
      };
      expect(
        manifest.icons.every((icon) => /\/api\/logo\/icon\/\d+\?v=[a-f0-9]{16}$/.test(icon.src)),
      ).toBe(true);
    } finally {
      await page.goto('/en/settings');
      const logo = page.getByRole('region', { name: 'Logo' });
      await expect(logo).toBeVisible();
      await atRest(page);
      const back = logo.getByRole('button', { name: 'Back to the default logo' });
      if (await back.isVisible()) {
        await back.click();
        await page
          .getByRole('dialog')
          .getByRole('button', { name: 'Back to the default logo' })
          .click();
        await expect(logo.getByText('The logo that comes with the platform')).toBeVisible();
        await atRest(page);
      }
    }

    // removed: the default icons are back, at once
    await page.goto('/en');
    const removed = await head(page);
    expect(removed.icons.map((icon) => icon.href)).toContain('/icons/icon-48.png');
    expect(removed.apple).toEqual(['/icons/icon-180.png']);
  });
});

/** The head of an address as somebody who is not signed in finds it (a link shared in a chat is read by a visitor). */
async function headOf(visitor: Page, path: string): Promise<Head> {
  await visitor.goto(path);
  return head(visitor);
}
