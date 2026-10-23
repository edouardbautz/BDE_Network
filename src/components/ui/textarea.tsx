import * as React from "react"

import { cn } from "@/lib/utils"
import { FIELD } from "./input"

/** The field of several lines: the field of `input.tsx` with the corners of a card (a pill would cut the text). */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(FIELD, "min-h-24 rounded-md py-3 leading-snug", className)}
      {...props}
    />
  )
}

export { Textarea }
