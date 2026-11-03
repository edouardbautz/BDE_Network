import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { atRest } from './rest';

/**
 * The small controls keep their size (docs/design.md, "Fields"). A checkbox or a radio button is 20 × 20, a switch 44 × 26, whatever the
 * text beside them says, and they stay level with the first line of that text. A control in a flex row is a flex item, and a long
 * explanation squeezed it narrower than the others (the description of "Publish on the intra" in the edition of a role did); the rule
 * is written once, in the base layer of `globals.css`, and this file holds it on the screens that have controls.
 *
 * On each screen, the text beside every control is made very long (a 600-character sentence added to its neighbours, which is more than any
 * real description), then every control is measured. A screen is read on a computer and on a phone, in the three engines.
 */

const LONG =
  'une explication très longue qui n’en finit pas et qui doit passer à la ligne plusieurs fois sans jamais écraser la case à cocher ni le bouton radio ni l’interrupteur '.repeat(
    4,
  );

const SCREENS = [
  { name: 'the edition of a role', path: '/en/roles/role-member', min: 8 },
  { name: 'a new role', path: '/en/roles/new', min: 8 },
  {
    name: 'the settings (the table of notifications, the sections)',
    path: '/en/settings',
    min: 20,
  },
  {
    name: 'the customisation of a notification',
    path: '/en/notifications?type=eventConfirmed',
    min: 2,
  },
  { name: 'the form of a new event', path: '/en/events/new', min: 1 },
];

const SIZES = [
  { name: 'a computer', viewport: { width: 1280, height: 900 } },
  { name: 'a phone', viewport: { width: 390, height: 800 } },
];

interface Measure {
  kind: string;
  label: string;
  width: number;
  height: number;
  /** Distance between the middle of the control and the middle of the first line of text beside it (null: no text beside it). */
  offCentre: number | null;
  /** The control sits at the top of its row (`items-start`): the rows that say so promise to be level with the first line. */
  atTop: boolean;
}

/** Makes the text beside each control very long, then measures every control that is drawn. */
async function stretchAndMeasure(page: Page, long: string): Promise<Measure[]> {
  return page.evaluate((text) => {
    const controls = Array.from(
      document.querySelectorAll<HTMLElement>(
        'input[type="checkbox"], input[type="radio"], [role="switch"]',
      ),
    ).filter((element) => {
      const box = element.getBoundingClientRect();
      // the ones hidden behind a drawn control (`sr-only`) are not the control a person sees
      return box.width > 2 && box.height > 2 && getComputedStyle(element).visibility !== 'hidden';
    });

    for (const control of controls) {
      const parent = control.parentElement;
      if (!parent) continue;
      for (const sibling of Array.from(parent.children)) {
        if (sibling === control || sibling.contains(control)) continue;
        sibling.append(document.createTextNode(` ${text}`));
      }
      // a label whose text is a bare text node, next to the control
      const words = document.createElement('span');
      words.dataset.stretch = 'true';
      words.textContent = text;
      parent.append(words);
    }

    return controls.map((control): Measure => {
      const box = control.getBoundingClientRect();
      let offCentre: number | null = null;
      const parent = control.parentElement;
      if (parent) {
        const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent?.trim() || control.contains(node)) continue;
          const holder = node.parentElement;
          if (!holder || getComputedStyle(holder).visibility === 'hidden') continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const line = range.getClientRects()[0];
          if (!line || line.width < 2) continue;
          offCentre = Math.abs(box.top + box.height / 2 - (line.top + line.height / 2));
          break;
        }
      }
      const alignment = parent ? getComputedStyle(parent).alignItems : '';
      return {
        atTop: ['flex-start', 'start', 'baseline'].includes(alignment),
        kind: control.getAttribute('role') ?? (control as HTMLInputElement).type,
        label:
          control.getAttribute('aria-label') ??
          control.closest('label')?.textContent?.trim().slice(0, 40) ??
          control.id ??
          '',
        width: box.width,
        height: box.height,
        offCentre,
      };
    });
  }, long);
}

const SIZE_OF: Record<string, { width: number; height: number }> = {
  checkbox: { width: 20, height: 20 },
  radio: { width: 20, height: 20 },
  switch: { width: 44, height: 26 },
};

/** A tolerance of a pixel's half: WebKit draws a 20 px control 19.6 px wide on some zoom levels. */
const hasItsSize = (measure: Measure) => {
  const expected = SIZE_OF[measure.kind];
  return (
    expected !== undefined &&
    Math.abs(measure.width - expected.width) <= 0.6 &&
    Math.abs(measure.height - expected.height) <= 0.6
  );
};
const describe = (measure: Measure) =>
  `${measure.kind} “${measure.label}” is ${measure.width} × ${measure.height}`;

for (const size of SIZES) {
  test.describe(`the small controls on ${size.name}`, () => {
    for (const screen of SCREENS) {
      test(`keep their size beside a very long text: ${screen.name}`, async ({ as }) => {
        const page = await as('owner', { viewport: size.viewport });
        await page.goto(screen.path);
        await atRest(page);

        const measures = await stretchAndMeasure(page, LONG);
        expect(measures.length, 'no control was found on the screen').toBeGreaterThanOrEqual(
          screen.min,
        );

        const wrong = measures.filter((measure) => !hasItsSize(measure));
        expect(wrong.map(describe), 'controls that changed size').toEqual([]);

        // level with the first line of the text beside them (a few pixels: the line is 20 px high, the control 20)
        const crooked = measures.filter(
          (measure) =>
            measure.atTop &&
            measure.kind !== 'switch' &&
            measure.offCentre !== null &&
            measure.offCentre > 4,
        );
        expect(
          crooked.map(
            (measure) =>
              `${measure.kind} “${measure.label}” is ${measure.offCentre?.toFixed(1)} px off the first line`,
          ),
          'controls not level with the first line of their text',
        ).toEqual([]);
      });
    }

    test('keep their size in the choices of a confirmation (a long explanation)', async ({
      as,
    }) => {
      const page = await as('owner', { viewport: size.viewport });
      await page.goto('/en/events/qa-fx-series');
      await atRest(page);
      await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      const measures = await stretchAndMeasure(page, LONG);
      expect(measures.filter((measure) => measure.kind === 'radio').length).toBeGreaterThanOrEqual(
        2,
      );
      const wrong = measures.filter((measure) => !hasItsSize(measure));
      expect(wrong.map(describe), 'controls that changed size').toEqual([]);
    });
  });
}
