"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

/** The veil behind a dialog or a sheet (docs/design.md, "Dialogs"): `scrim`, a fade of 200 ms, no blur. */
function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-scrim transition-opacity duration-(--dur-base) ease-(--ease-standard) data-ending-style:opacity-0 data-ending-style:duration-150 data-ending-style:ease-(--ease-exit) data-starting-style:opacity-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * A dialog (docs/design.md, "Dialogs"): a panel centred on a computer (480 wide, corners of 28, padding 24), a sheet anchored to
 * the bottom of a phone (corners of 28 on top, a handle, padding 20 and the safe area). It enters in 200 ms and leaves in three
 * quarters of that. `closeLabel` gives it the close button at the top right.
 */
function DialogContent({
  className,
  children,
  closeLabel,
  ...props
}: DialogPrimitive.Popup.Props & { closeLabel?: string }) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed z-50 grid max-h-[90dvh] gap-5 overflow-y-auto bg-surface text-body text-ink elev-3 outline-none",
          "transition-[opacity,transform] duration-(--dur-base) ease-(--ease-standard) data-ending-style:duration-150 data-ending-style:ease-(--ease-exit) data-ending-style:opacity-0 data-starting-style:opacity-0",
          // a phone: the sheet rises from the bottom
          "inset-x-0 bottom-0 rounded-t-dialog px-5 pt-2 pb-[calc(var(--space-8)+env(safe-area-inset-bottom))] data-ending-style:translate-y-full data-starting-style:translate-y-full max-sm:duration-(--dur-slow)",
          // a computer: the panel fades in, a little smaller
          "sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[calc(100%-2rem)] sm:max-w-120 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-dialog sm:p-6 sm:data-ending-style:translate-y-0 sm:data-starting-style:translate-y-0 sm:data-ending-style:scale-[.98] sm:data-starting-style:scale-[.98]",
          className
        )}
        {...props}
      >
        <div
          aria-hidden="true"
          className="mx-auto h-1 w-9 rounded-pill bg-line sm:hidden"
        />
        {children}
        {closeLabel && (
          <DialogPrimitive.Close
            render={
              <Button
                variant="secondary"
                size="icon"
                aria-label={closeLabel}
                className="absolute top-3 right-3 sm:top-5 sm:right-5"
              />
            }
          >
            <XIcon aria-hidden="true" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 pe-12", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 max-sm:*:w-full sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-title-2 text-ink", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-body text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
