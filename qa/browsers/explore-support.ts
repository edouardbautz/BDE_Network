import type { Page } from '@playwright/test';

/** An address as a kind of page: the identifiers become `:id`, the values of the query go (its names stay). */
export function patternOf(path: string, search: string): string {
  const names = [...new URLSearchParams(search).keys()].sort();
  const shape = path
    .replace(/\/events\/(?!new\b|review\b|shared-calendar\b)[^/]+/, '/events/:id')
    .replace(/\/roles\/(?!new\b)[^/]+/, '/roles/:id');
  return names.length > 0 ? `${shape}?${names.join('&')}` : shape;
}

const MAX_TRIGGERS = 8;

/** Opens every menu and dialog the page offers (and closes it), and says what went wrong. */
export async function openPopups(page: Page, at: string): Promise<string[]> {
  const findings: string[] = [];
  const triggers = page.locator(
    '[aria-haspopup]:not([aria-haspopup="false"]):visible, button[aria-expanded]:visible',
  );
  const count = Math.min(await triggers.count(), MAX_TRIGGERS);
  for (let index = 0; index < count; index += 1) {
    const trigger = triggers.nth(index);
    const name = ((await trigger.getAttribute('aria-label')) ?? (await trigger.innerText()).trim())
      .replace(/\s+/g, ' ')
      .slice(0, 40);
    await trigger
      .click({ timeout: 5_000 })
      .catch(() => findings.push(`${at}: "${name}" could not be clicked`));
    await page.waitForTimeout(250);
    const alive = await page
      .locator('main, [role="main"]')
      .first()
      .isVisible()
      .catch(() => false);
    if (!alive) findings.push(`${at}: the page lost its content when "${name}" was opened`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
  return findings;
}
