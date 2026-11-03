// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The lists that open a page open it from all of it (docs/design.md, "Rows that open a page"): the title is a `RowLink`, not a plain link, and the
 * lists of requests and of proposals have the "View details" button. Read from the sources, so that a list rewritten by hand with a plain title link
 * (the defect: nothing said the line was clickable) fails here; the browser test plays the behaviour.
 */

const src = (path: string) => readFileSync(join(__dirname, '..', '..', path), 'utf8');

const LISTS = {
  'requests to publish on the intra': 'app/[locale]/(app)/events/intra/page.tsx',
  'proposals to validate': 'app/[locale]/(app)/events/review/page.tsx',
  events: 'components/events/event-list.tsx',
} as const;

describe.each(Object.entries(LISTS))('the list of %s', (_name, path) => {
  const text = src(path);

  it('opens its page by a stretched link on the title, with the ground and the ring of the row', () => {
    expect(text).toMatch(/<RowLink\b/);
    expect(text).toContain('linkRow');
    // the title is not a plain link any more
    expect(text).not.toMatch(/import \{ Link \} from '@\/i18n\/navigation'/);
    expect(text).not.toMatch(/<Link\b/);
  });
});

describe('"View details"', () => {
  it.each([
    'app/[locale]/(app)/events/intra/page.tsx',
    'app/[locale]/(app)/events/review/page.tsx',
  ])('is on %s, in the words of the catalog', (path) => {
    expect(src(path)).toMatch(/<RowDetails label=\{t\('(?:list\.)?viewDetails'\)\}/);
  });
});

describe('the actions of a proposal', () => {
  it('are lifted above the covering layer, so Refuse and Validate never open the row', () => {
    const review = src('app/[locale]/(app)/events/review/page.tsx');
    const at = review.indexOf('rowAction,');
    expect(at, 'rowAction is imported').toBeGreaterThan(-1);
    const wrapper = review.search(/cn\(\s*rowAction\b/);
    expect(wrapper, 'the wrapper of the buttons carries rowAction').toBeGreaterThan(-1);
    // and the wrapper holds both dialogs, and "View details" is outside it (a click on it must reach the link)
    const buttons = review.slice(wrapper, review.indexOf('</li>', wrapper));
    expect(buttons).toContain('detail.review.refuseDialog.title');
    expect(buttons).toContain('detail.review.approveDialog.title');
    expect(review.slice(review.indexOf('<RowDetails'), wrapper)).not.toContain('rowAction');
  });
});
