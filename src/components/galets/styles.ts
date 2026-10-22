import { cva, type VariantProps } from 'class-variance-authority';

/**
 * The pill button of the "Galets" direction (spec 5.1), as classes: a link or a button takes it with `className`.
 * Colours and radii are tokens; the states are the specification's (a veil of the fill on hover and press).
 */
export const pillButton = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-pill text-body-strong whitespace-nowrap select-none',
    'transition-[background-color,box-shadow,transform] duration-(--dur-fast) ease-(--ease-standard)',
    'motion-safe:active:scale-[.98] motion-safe:active:duration-(--dur-instant)',
    'aria-disabled:cursor-not-allowed aria-disabled:bg-surface-2 aria-disabled:text-disabled',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary:
          'bg-accent-fill text-accent-on accent-edge hover:bg-accent-fill-hover active:bg-accent-fill-pressed',
        secondary: 'bg-surface-2 text-ink hover:bg-surface-3 active:bg-surface-3',
        ghost: 'text-ink hover:bg-surface-2 active:bg-surface-3',
        onAccent: 'bg-accent-on text-accent-fill hover:bg-accent-on/92 active:bg-accent-on/86',
      },
      size: {
        sm: 'h-8 px-3.5',
        md: 'h-10 px-4.5',
        lg: 'h-11 px-4.5',
      },
    },
    defaultVariants: { variant: 'primary', size: 'lg' },
  },
);

export type PillButtonProps = VariantProps<typeof pillButton>;

/** The small link of a card header ("Tout voir"): accent ink, underlined under the pointer (spec 5.1). */
export const cardLink =
  'text-small font-bold text-accent-ink underline-offset-3 hover:underline rounded-xs';

/** The surface of a standard card (spec 5.3): no border, a soft shadow, 24 px corners (20 on a phone). */
export const cardSurface = 'bg-surface elev-1 rounded-xl p-5 sm:rounded-2xl sm:p-5.5';
