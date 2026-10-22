import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Class merging that knows the tokens of the design system (globals.css): without this, `text-micro` (a size) is taken for a
 * colour and silently removes `text-accent-on`, and `elev-1` is not known to replace another shadow.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'display',
            'title-1',
            'title-2',
            'title-3',
            'figure',
            'card-title',
            'body',
            'body-strong',
            'small',
            'caption',
            'micro',
          ],
        },
      ],
      shadow: [{ elev: ['1', '2', '3'] }, 'accent-edge'],
    },
    theme: { radius: ['pill', 'dialog'] },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
