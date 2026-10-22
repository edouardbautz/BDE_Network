import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * The badge (docs/design.md, "Badges"): a pill of 22 px, `caption` text, not interactive. `secondary` is the neutral one (a count,
 * a role, a category), `default` the accent one, then the semantic ones; `solid` is the counter on an icon.
 */
const badgeVariants = cva(
  "group/badge inline-flex h-5.5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-pill px-2.5 text-caption whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3.5",
  {
    variants: {
      variant: {
        default: "bg-accent-soft text-accent-ink",
        secondary: "bg-surface-2 text-ink",
        outline: "bg-surface-2 text-muted-foreground",
        success: "bg-success-soft text-success",
        warning: "bg-warning-soft text-warning",
        destructive: "bg-danger-soft text-danger",
        solid:
          "h-4.5 min-w-4.5 bg-accent-fill px-1 font-extrabold text-accent-on accent-edge tabular",
        ghost: "text-muted-foreground",
        link: "text-accent-ink underline-offset-3 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
