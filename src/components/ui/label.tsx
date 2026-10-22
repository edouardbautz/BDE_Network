"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/** A field's label (docs/design.md, "Fields"): `body-strong` in ink, 6 above its field. A disabled field's label is dimmed. */
function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-body-strong text-ink select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:text-disabled peer-disabled:cursor-not-allowed peer-disabled:text-disabled",
        className
      )}
      {...props}
    />
  )
}

export { Label }
