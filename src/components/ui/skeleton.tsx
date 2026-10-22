import { cn } from "@/lib/utils"

/** A placeholder while a page loads (docs/design.md, "Tables"): `surface-2`, a pulse of the opacity from .6 to 1 (still when motion is reduced). */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "animate-[skeleton-pulse_1.2s_ease-in-out_infinite] rounded-xs bg-surface-2 motion-reduce:animate-none",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
