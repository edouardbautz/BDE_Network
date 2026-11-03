// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The small controls keep their size (docs/design.md, "Fields"). A checkbox or a radio button is 20 px and is not squeezed by the text
 * beside it: the rule is written ONCE, in the base layer of `globals.css`, and no component says another size for one. A component that
 * wrote `size-5` was not enough (a flex item shrinks, and the long description of a permission made the box narrower than the others),
 * and one that wrote `size-4` made it smaller. The browser test `qa/browsers/controls.spec.ts` measures them on the screens.
 */

const ROOT = join(__dirname, '..');
const css = readFileSync(join(ROOT, 'app/globals.css'), 'utf8');

function files(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'generated'].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files(path, found);
    else if (/\.tsx$/.test(path) && !/\.test\./.test(path)) found.push(path);
  }
  return found;
}

describe('the rule of the checkbox and the radio button', () => {
  const rule = css.match(/input\[type="checkbox"\],\s*input\[type="radio"\]\s*\{([^}]*)\}/)?.[1];

  it('is in globals.css: 20 px, never shrunk, the accent', () => {
    expect(rule, 'the base rule of the checkbox and the radio button').toBeDefined();
    expect(rule).toMatch(/flex:\s*none/);
    expect(rule).toMatch(/width:\s*1\.25rem/);
    expect(rule).toMatch(/height:\s*1\.25rem/);
    expect(rule).toMatch(/accent-color:\s*var\(--accent-fill\)/);
  });

  it('is in the base layer, under the utilities (an `sr-only` input, hidden behind a drawn control, still wins)', () => {
    const base = css.indexOf('@layer base');
    const at = css.indexOf('input[type="checkbox"]');
    expect(base).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(base);
  });

  it('is not overruled by a component: none gives a checkbox or a radio button a size of its own', () => {
    const found: string[] = [];
    for (const path of files(ROOT)) {
      const text = readFileSync(path, 'utf8');
      for (const input of text.matchAll(
        /<input\b[^>]*?type=(?:"(?:checkbox|radio)")[^>]*?\/?>/g,
      )) {
        const className = input[0].match(/className=(?:"([^"]*)"|\{([^}]*)\})/);
        const classes = className?.[1] ?? className?.[2] ?? '';
        // the hidden state of a drawn control is `sr-only`, which is another thing
        if (/\bsr-only\b/.test(classes)) continue;
        if (/\b(?:size|w|h|min-w|min-h|max-w|max-h|shrink|basis)-/.test(classes)) {
          found.push(relative(ROOT, path).replaceAll('\\', '/'));
        }
      }
    }
    expect(found).toEqual([]);
  });
});
