"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

/** The switch (docs/design.md, "Fields"): a pill of 44 × 26, `surface-3` off and the accent on, a thumb of 20 that moves in 200 ms. */
function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex h-6.5 w-11 shrink-0 items-center rounded-pill bg-surface-3 px-0.75 transition-colors duration-(--dur-base) ease-(--ease-standard) after:absolute after:-inset-x-1 after:-inset-y-2 data-checked:bg-accent-fill data-checked:accent-edge aria-invalid:shadow-[inset_0_0_0_2px_var(--danger)] data-disabled:cursor-not-allowed data-disabled:opacity-60",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-5 rounded-pill bg-surface elev-1 transition-transform duration-(--dur-base) ease-(--ease-standard) group-data-checked/switch:translate-x-[18px] group-data-checked/switch:bg-accent-on"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
