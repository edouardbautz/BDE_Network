import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { FIELD } from '@/components/ui/input';

/**
 * Native <select> and <textarea> drawn like the <Input> (docs/design.md, "Fields"). Native controls are deliberate here: they work
 * without JavaScript inside plain GET filter forms and give mobile users their platform pickers.
 */

/**
 * Safari draws a select with the system's look and ignores `box-shadow` on it (checked: the computed shadow stays `none`
 * even when it is set by hand), so the inset ring that shows the focus of the other fields, which is a shadow, is not there:
 * somebody who tabs to a select sees nothing (WCAG 2.4.7). Its focus is the outline of the whole interface instead (3 px, the ink
 * of the accent), which the ring is switched off for here, so that no engine draws both.
 */
const SELECT_FOCUS =
  'focus-visible:shadow-none focus-visible:outline-3 focus-visible:outline-solid focus-visible:outline-accent-ink focus-visible:outline-offset-2';

export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(FIELD, 'h-11', SELECT_FOCUS, className)} {...props} />;
}

/** A text area is not a pill: corners of 14, 12 above and below the text, 96 high at least. */
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(FIELD, 'min-h-24 rounded-md py-3 max-sm:text-body', className)}
      {...props}
    />
  );
}
