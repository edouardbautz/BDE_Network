"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"

import { cn } from "@/lib/utils"

/**
 * The tabs (docs/design.md, "Segmented controls"): a pill of `surface-2` holding pills of 40 px, the selected one on `surface`. Base UI
 * gives the roles (`tablist`, `tab`, `tabpanel`), the arrow keys, Home and End. Written by hand in the style of the others, like
 * `dialog.tsx`: the generator would bring a style of its own.
 */
function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col gap-3", className)} {...props} />
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-pill bg-surface-2 p-1 max-sm:w-full",
        className
      )}
      {...props}
    />
  )
}

function TabsTab({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-tab"
      className={cn(
        "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-pill px-4 text-body-strong whitespace-nowrap text-muted-foreground transition-[background-color,color,box-shadow] duration-(--dur-fast) hover:text-ink focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent-ink)] data-active:bg-surface data-active:text-ink data-active:elev-1 max-sm:h-11",
        className
      )}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTab }
