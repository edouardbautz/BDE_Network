import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * The inline banner (docs/design.md, "Alerts"): corners of 16, a soft background of the meaning (neutral information is
 * `surface-2`), an icon of 20 on the left in the colour of the meaning, a title in ink and a text in ink. An error that blocks
 * is announced at once (`role="alert"`); anything else is a status.
 */
const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-lg px-4 py-3.5 text-left text-body has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-3 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        default: "bg-surface-2 text-ink *:[svg]:text-ink",
        success: "bg-success-soft text-ink *:[svg]:text-success",
        warning: "bg-warning-soft text-ink *:[svg]:text-warning",
        destructive: "bg-danger-soft text-ink *:[svg]:text-danger",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  role,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role={role ?? (variant === "destructive" ? "alert" : "status")}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "text-body-strong text-ink group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-body text-ink group-has-[>svg]/alert:col-start-2 text-balance md:text-pretty [&_a]:font-bold [&_a]:underline [&_a]:underline-offset-3 [&_p:not(:last-child)]:mb-4",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-2 right-2", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
