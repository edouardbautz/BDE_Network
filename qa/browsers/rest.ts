import type { Page } from '@playwright/test';

/**
 * The page at rest: what it asks of the platform has come back, and what it animates has finished (an animation that never
 * ends, a spinner, is what it is). Whoever looks at the page, axe judging its colours or a screenshot compared with a
 * reference, sees it as drawn at that instant, and a control that fades (the Save button of the campuses is disabled while
 * the list loads, and fades in when it arrives) is drawn half-way for a moment: in CI, slower than a developer's computer,
 * axe caught it at 72 % (white on 3.2:1).
 */
export async function atRest(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState === 'finished' ||
          animation.effect?.getComputedTiming().iterations === Infinity,
      ),
  );
}
