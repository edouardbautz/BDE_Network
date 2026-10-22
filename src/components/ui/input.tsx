import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

/**
 * The text field (docs/design.md, "Fields"): a pill of 44 px on `surface-2`, no border. The ring of its focus is inset and in
 * the ink of the accent (it replaces the outline), an error is the same ring in the danger colour, read-only is a hairline.
 */
const FIELD =
  "w-full min-w-0 rounded-pill border-0 bg-surface-2 px-4 text-body text-ink transition-[background-color,box-shadow] duration-(--dur-fast) ease-(--ease-standard) outline-none placeholder:text-muted-foreground hover:bg-surface-3 focus-visible:bg-surface focus-visible:shadow-[inset_0_0_0_2px_var(--accent-ink)] focus-visible:outline-none read-only:bg-transparent read-only:shadow-[inset_0_0_0_1px_var(--line)] read-only:hover:bg-transparent disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-disabled disabled:hover:bg-surface-2 aria-invalid:shadow-[inset_0_0_0_2px_var(--danger)]"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        FIELD,
        "h-11 file:me-3 file:inline-flex file:h-full file:border-0 file:bg-transparent file:text-body-strong file:text-ink",
        className
      )}
      {...props}
    />
  )
}

export { Input, FIELD }
