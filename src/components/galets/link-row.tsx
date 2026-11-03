import { ChevronRight } from 'lucide-react';
import type { ComponentProps } from 'react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { pillButton } from './styles';

/**
 * A row of a list that opens a page, all of it (docs/design.md, "Rows that open a page"): the *stretched link* pattern.
 *
 * - The **title is the one link** of the row (a real `<a>`, so one stop of the keyboard, the title as its name, and it opens in a new tab like
 *   any link). Its `::after` covers the whole row (`RowLink`), so a click anywhere on the row is a click on the title: the same address, with
 *   nothing nested in an anchor.
 * - **The row draws what the title cannot**: the hover (a `surface-2` ground) and, for the keyboard, the focus ring around the whole row
 *   (`linkRow`: the link itself draws none, the row does, through `:has()` on its `data-row-link`).
 * - **What else can be clicked in the row keeps its own behaviour**: it is lifted above the covering layer with `rowAction` (a button of
 *   its own, a link to another page), so a click on it never opens the row.
 * - **"View details" is the same destination written as a button** (`RowDetails`): a picture of a button, under the covering layer, so a click
 *   on it is a click on the link. It is hidden from assistive technology (the title already says it, and a button that does nothing by itself
 *   would be a second stop for the same thing).
 */

/** The row: the ground under the pointer, and the ring of the keyboard focus around all of it. */
export const linkRow =
  'group/row relative -mx-3 rounded-lg px-3 py-3.5 transition-colors duration-(--dur-fast) ease-(--ease-standard) hover:bg-surface-2 ' +
  'has-[[data-row-link]:focus-visible]:bg-surface-2 has-[[data-row-link]:focus-visible]:outline has-[[data-row-link]:focus-visible]:outline-3 has-[[data-row-link]:focus-visible]:outline-offset-0 has-[[data-row-link]:focus-visible]:outline-accent-ink';

/** What stretches the link over the row; the row draws the ring, not the link. */
export const rowLinkLayer =
  "after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:outline-0";

/** Whatever else is clickable in the row: above the covering layer, so it keeps its own behaviour. */
export const rowAction = 'relative z-10';

export function RowLink({ className, ...props }: ComponentProps<typeof Link>) {
  return <Link data-row-link="" className={cn(rowLinkLayer, className)} {...props} />;
}

/** "View details", as a button: a picture of one (the link under it does the work), the same on a computer and on a phone. */
export function RowDetails({ label, className }: { label: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        pillButton({ variant: 'secondary', size: 'sm' }),
        'group-hover/row:bg-surface-3 group-has-[[data-row-link]:focus-visible]/row:bg-surface-3',
        className,
      )}
    >
      {label}
      <ChevronRight className="size-4" />
    </span>
  );
}
