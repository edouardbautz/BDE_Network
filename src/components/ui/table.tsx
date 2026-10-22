"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Tables (docs/design.md, "Tables"): they live in a card; a header of 40 px in `caption` muted, rows of 52 with a hairline between
 * them, the row under the pointer on `surface-2` with rounded ends. On a phone (under 640 px) a table is a list: the header goes
 * (for the eye only), each row is a block, the first cell is its title and each other cell says what it is with its
 * `data-label` (the name of its column). No table scrolls sideways on a phone.
 */
function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn(
          "w-full caption-bottom border-separate border-spacing-0 text-body max-sm:block",
          className
        )}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("max-sm:sr-only", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("max-sm:block", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn("text-small text-muted-foreground max-sm:block", className)}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "group/row data-[state=selected]:[&>td]:bg-accent-soft hover:[&>td]:bg-surface-2 has-aria-expanded:[&>td]:bg-surface-2 [&>td:first-child]:rounded-l-sm [&>td:last-child]:rounded-r-sm",
        "max-sm:flex max-sm:flex-col max-sm:gap-1 max-sm:border-t max-sm:border-line max-sm:py-3.5 max-sm:first:border-t-0 max-sm:[&>td]:rounded-none",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 border-b border-line px-3 text-left align-middle text-caption whitespace-nowrap text-muted-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "h-13 border-t border-line px-3 align-middle whitespace-nowrap transition-colors duration-(--dur-fast) group-first/row:border-t-0 [thead+tbody_tr:first-child_&]:border-t-0 [&:has([role=checkbox])]:pr-0",
        "max-sm:flex max-sm:h-auto max-sm:items-baseline max-sm:gap-2 max-sm:border-t-0 max-sm:p-0 max-sm:whitespace-normal max-sm:first:text-body-strong max-sm:data-label:before:min-w-20 max-sm:data-label:before:shrink-0 max-sm:data-label:before:text-small max-sm:data-label:before:text-muted-foreground max-sm:data-label:before:content-[attr(data-label)] max-sm:first:data-label:before:hidden",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-small text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
