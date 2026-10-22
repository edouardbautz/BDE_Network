import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { isValidElement } from "react"

import { cn } from "@/lib/utils"

/**
 * The pill button of the "Galets" direction (docs/design.md, "Buttons"). The names of the variants are shadcn's, what they draw is
 * the specification's: `default` is the primary (the accent), `secondary` and `outline` the secondary (surface-2, no border),
 * `ghost` the quiet one, `destructive` the danger one (soft), `confirm` the solid danger of a confirmation dialog, `onAccent` the one
 * that sits on an accent-filled card. A button is 44 px high on a phone, whatever its size.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-1.5 rounded-pill text-body-strong whitespace-nowrap select-none transition-[background-color,box-shadow,transform] duration-(--dur-fast) ease-(--ease-standard) outline-none active:duration-(--dur-instant) motion-safe:active:not-aria-[haspopup]:scale-[.98] disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-disabled disabled:shadow-none aria-disabled:cursor-not-allowed aria-disabled:bg-surface-2 aria-disabled:text-disabled [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        default:
          "bg-accent-fill text-accent-on accent-edge hover:bg-accent-fill-hover active:bg-accent-fill-pressed",
        secondary:
          "bg-surface-2 text-ink hover:bg-surface-3 active:bg-surface-3 aria-expanded:bg-surface-3",
        outline:
          "bg-surface-2 text-ink hover:bg-surface-3 active:bg-surface-3 aria-expanded:bg-surface-3",
        ghost:
          "text-ink hover:bg-surface-2 active:bg-surface-3 aria-expanded:bg-surface-2",
        destructive:
          "bg-danger-soft text-danger hover:bg-[color-mix(in_srgb,var(--danger-soft),black_4%)] active:bg-[color-mix(in_srgb,var(--danger-soft),black_4%)]",
        confirm:
          "bg-danger-fill text-on-danger hover:bg-[color-mix(in_srgb,var(--danger-fill),black_8%)] active:bg-[color-mix(in_srgb,var(--danger-fill),black_14%)]",
        onAccent:
          "bg-accent-on text-accent-fill hover:bg-accent-on/92 active:bg-accent-on/86",
        link: "rounded-xs text-accent-ink underline-offset-3 hover:underline",
      },
      size: {
        default: "h-10 px-4.5 max-sm:h-11",
        xs: "h-8 px-3 max-sm:h-11",
        sm: "h-8 px-3.5 max-sm:h-11",
        lg: "h-11 px-4.5",
        icon: "size-9.5 max-sm:size-11",
        "icon-xs": "size-8 max-sm:size-11",
        "icon-sm": "size-8 max-sm:size-11",
        "icon-lg": "size-11",
      },
    },
    compoundVariants: [
      // A link is text: no height, no padding.
      { variant: "link", className: "h-auto px-0 max-sm:h-auto" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

// Base UI warns when `nativeButton` is true (its default) but the rendered
// element is not a <button>, e.g. `render={<Link />}` or `render={<a />}`.
// Infer it from `render` so callers don't have to pass `nativeButton={false}`.
function rendersNativeButton(render: ButtonPrimitive.Props["render"]) {
  if (render === undefined) return true
  return isValidElement(render) && render.type === "button"
}

function Button({
  className,
  variant = "default",
  size = "default",
  render,
  nativeButton = rendersNativeButton(render),
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      render={render}
      nativeButton={nativeButton}
      {...props}
    />
  )
}

export { Button, buttonVariants }
