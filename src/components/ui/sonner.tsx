"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      // docs/design.md, "Toasts": bottom right at 24 on a computer, centred above the tab bar on a phone, three at most, 4 seconds
      position="bottom-right"
      offset={24}
      mobileOffset={{ bottom: "calc(var(--tabbar-height) + var(--tabbar-gap) + var(--space-5))", left: 16, right: 16 }}
      visibleToasts={3}
      duration={4000}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-5 text-success" />
        ),
        info: (
          <InfoIcon className="size-5 text-ink" />
        ),
        warning: (
          <TriangleAlertIcon className="size-5 text-warning" />
        ),
        error: (
          <OctagonXIcon className="size-5 text-danger" />
        ),
        loading: (
          <Loader2Icon className="size-5 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--surface)",
          "--normal-text": "var(--ink)",
          "--normal-border": "transparent",
          "--border-radius": "var(--radius-xl)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast elev-2 text-body-strong",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
