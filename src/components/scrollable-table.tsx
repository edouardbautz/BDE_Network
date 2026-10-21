import type { ReactNode } from 'react';

/**
 * A table wider than its card scrolls sideways (a phone), and a keyboard cannot scroll a box that cannot take the focus
 * (WCAG 2.1.1; axe: "scrollable region focusable"). The table component of shadcn/ui wraps its table in a scrolling box of
 * its own, which takes no attribute (and is generated, not edited): it is switched off here, and this box scrolls instead,
 * named, reachable with Tab, and showing the focus like every control (arrow keys then scroll it).
 */
export function ScrollableTable({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="region"
      tabIndex={0}
      aria-label={label}
      className="focus-visible:ring-ring/50 overflow-x-auto rounded-md outline-none focus-visible:ring-3 [&_[data-slot=table-container]]:overflow-visible"
    >
      {children}
    </div>
  );
}
