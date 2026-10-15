🇬🇧 English · This page is a technical reference, written in English only. [Documentation index](en/README.md) · [Index en français](fr/README.md)

# Design system

This document describes the visual system of BDE_Network: typography, colors, spacing, components, navigation,
interface states and accessibility. It is the single reference that keeps future modules (finances, meetings…)
consistent with what exists, without having to ask again.

General direction: sober and functional, in the spirit of Linear, Vercel or Notion. No superfluous effects
(decorative gradients, heavy shadows, pronounced glassmorphism, gratuitous animation). The hierarchy comes from
typography, spacing and a disciplined use of the accent color — never from tricks.

## Typography

One sans-serif family: **Geist** (`next/font/google`), loaded in `src/app/[locale]/layout.tsx` and exposed through
the CSS variable `--font-geist-sans`. `--font-sans` in `src/app/globals.css` points to it explicitly
(`var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif`). **Never let it reference itself**
(`--font-sans: var(--font-sans)`): that silent bug makes the whole site fall back to the browser's default serif
font, with no error. `--font-heading` reuses `--font-sans`: the whole application, headings included, uses a single
font family.

Scale (Tailwind classes, no ad hoc values):

| Use                                            | Class                                              | Size / line height |
| ---------------------------------------------- | -------------------------------------------------- | ------------------ |
| Page title (`h1`)                              | `text-2xl font-semibold tracking-tight`            | 24px / 32px        |
| Card title (`CardTitle`, section `h2`)         | `text-base font-medium` or `text-sm font-semibold` | 16px or 14px       |
| Body text                                      | `text-sm`                                          | 14px / 20px        |
| Secondary text (`text-muted-foreground`)       | `text-sm` or `text-xs`                             | 14px or 12px       |
| Code / machine values (audit action key, etc.) | `<code>` + `text-xs`                               | 12px               |

One `h1` per page, in a `<div>` that also holds the subtitle (`text-muted-foreground text-sm mt-1`). Do not skip
heading levels.

## Colors

Neutral palette in OKLCH, hue `258` (a very discreet blue), almost no chroma. **Never pure black or white** in the
dark theme — see `:root` and `.dark` in `src/app/globals.css`. The 258 hue is applied uniformly to every neutral
token (background, surface, border, text) so that the whole stays optically coherent, even when a card sits on
another surface.

Three elevation levels in the dark theme, from deepest to lightest: `--background` (0.16) < `--card` / `--sidebar`
(~0.19–0.21) < `--popover` (0.225). In the light theme: `--background` (0.985, slightly grey) < `--card` /
`--popover` (pure white, 1.0) — pure white only appears on floating surfaces, never as the page background.

Every component in `src/components/ui/*` consumes these tokens through the generated Tailwind classes
(`bg-background`, `text-foreground`, `border-border`, `bg-sidebar`, etc.). **Never hardcode a color** (`bg-black`,
`#fff`, `zinc-800`…) in a component or a page. The palette changes in one place: `src/app/globals.css`.

### Accent color

The BDE's accent color (`bde.accentColor`) drives `--primary`, `--ring`, `--sidebar-primary` and
`--sidebar-ring` through `buildAccentStyle()` (`src/lib/color.ts`), injected as an inline style on `<body>`. It is
arbitrary (each BDE picks its own): **it must never carry text directly on a large surface, nor be the only text
color** — its contrast is only guaranteed for white or black text on a solid fill (that is what
`getContrastingTextColor` does), not for accent-colored text on any neutral background.

Rule: the accent is for **primary actions** (the `default` button) and **active states** (the active nav link, the
selected item), never for large surfaces (no accent-tinted page or card background). For an active state, prefer:

- a translucent background (`bg-primary/10`) — the text stays `text-foreground` / `text-sidebar-foreground`, never
  `text-primary` directly (a dark accent on a dark background can fall under 4.5:1 — checked for the default teal:
  3.4:1 in the dark theme, not enough);
- an accent-colored icon (decorative or redundant role, never the only carrier of meaning);
- a 2px vertical accent bar (see the active nav in `app-shell.tsx`).

Per-fork colors that are not the accent (the event categories' colors) are applied inline as a dot, a left border
or a translucent tint (`color-mix`), never as a text color or a large surface, so that contrast always rests on the
neutral `foreground` token.

### Contrast (WCAG AA)

Each token pair was checked by converting OKLCH → linear sRGB → WCAG relative luminance before being chosen
(throwaway script, values below):

| Pair                                   | Light | Dark |
| -------------------------------------- | ----- | ---- |
| `foreground` / `background`            | 17.7  | 17.3 |
| `foreground` / `card`                  | 18.5  | 16.0 |
| `muted-foreground` / `background`      | 6.3   | 6.7  |
| `muted-foreground` / `card` or `muted` | 5.8   | 6.2  |
| `destructive` (text) / `background`    | 4.6   | 6.7  |

Minimum required: 4.5:1 for normal text, 3:1 for large text and UI. Any new text/background pair must be checked the
same way before it is added — especially if a future module introduces a new semantic color (success, warning…).

Borders (`--border`, `--input`) are **deliberately subtle** (~1.3–1.7:1, under the 3:1 threshold of WCAG 1.4.11 for
component boundaries) — a deliberate choice for the "discreet borders" look. In exchange, every interactive element
has a clear focus ring (`focus-visible:ring-3 focus-visible:ring-ring/50`) and a sufficient background difference
(card or surface vs. page), so that it stays findable without relying on the border alone.

## Spacing

A strict 4px grid (Tailwind's default spacing: `spacing(1) = 4px`). Do not introduce arbitrary values
(`px-[13px]`) — compose with the existing scale (`1, 1.5, 2, 2.5, 3, 4, 6, 8…`). Reference points used in the app:

- `gap-0.5` / `gap-1`: very close elements (icon + label in a nav item).
- `gap-2` / `gap-2.5`: inside a component (icon + text, avatar + name).
- `gap-4` / `gap-6`: between blocks of one section (`flex flex-col gap-6` is the standard page layout).
- `gap-8`: between large sections of a page (the dashboard).
- `p-3` / `p-4`: inner padding of cards and panels (`--card-spacing` is `--spacing(4)` by default, `--spacing(3)`
  in the `sm` variant).
- `px-4 py-6 sm:px-6 md:px-8 md:py-8`: padding of the `<main>` container (`app-shell.tsx`).

## Radii

`--radius: 0.5rem` (8px) in `globals.css`, declined from `--radius-sm` (≈5px) up to `--radius-4xl` (≈21px). Cards
and panels use `rounded-xl` (`--radius-lg`, 8px); controls (button, input, badge) use smaller radii. Do not mix
radii outside the scale.

## Components

- **Cards** (`src/components/ui/card.tsx`): a subtle border through `ring-1 ring-foreground/10` (it adapts to the
  surface underneath, light or dark), no pronounced drop shadow. It is the default container for any structured
  block of content.
- **Empty states**: an icon in a `bg-muted text-muted-foreground` circle (`size-10`, icon `size-5`), then a title
  (`text-sm font-medium`), a description (`text-muted-foreground text-sm`) and an optional action. See the "no
  module turned on" block of the dashboard (`dashboard/page.tsx`) or the audit log's empty state
  (`audit-log/page.tsx`). A card with no data must **never** stay silent — it explains what is missing and, when
  relevant, what to do next.
- **Loading**: one `loading.tsx` per route that shows `Skeleton`s reproducing the real shape of the content (same
  cards, same table-row proportions) — never a generic spinner. See `dashboard/loading.tsx`,
  `members/loading.tsx`, `audit-log/loading.tsx`.
- **Tables**: secondary columns (login, campus, date) in `text-muted-foreground`, to make the main column (name,
  actor) stand out.
- **Confirmations** (`src/components/confirm-dialog.tsx`, built on the `ui/dialog.tsx` primitive): **every
  destructive or irreversible action** (remove, refuse, delete, cancel an occurrence, regenerate or turn off a link,
  change a member's role…) first asks for confirmation in **a dialog centered over the page**, never in a block
  that unfolds under the element (it ends up off screen and changes the layout). One component, `ConfirmDialog`:
  do not write your own `<details>` or popover.
  - Content: a **title** that names the action and its target ("Remove Jean from the BDE?"), **one sentence** that
    says what happens and what cannot be undone (without repeating the title), an action button in **destructive**
    style whose label is a precise verb ("Remove permanently", never "OK" or "Yes"), and **Cancel**.
    `tone="default"` for a reversible change (changing a role).
  - Behavior guaranteed by the component: focus starts on **Cancel** (never on the destructive button), it is
    **trapped** in the dialog, **Escape** and a click outside cancel, and focus **returns** to the button it came
    from (or to the menu, with `returnFocusRef`). While the action runs, the action button is busy (spinning icon,
    `aria-busy`), cannot be pressed twice, and the dialog cannot be closed.
  - Usage: `<ConfirmDialog title description confirmLabel onConfirm>Button label</ConfirmDialog>`. From a Server
    Component, `onConfirm` is a server action (`async () => { 'use server'; … }`); it may redirect, and the dialog
    stays busy until the navigation. Without a button (a dropdown menu, a shortcut), pass `open`, `onOpenChange` and
    `returnFocusRef`.
  - These do **not** ask for confirmation: reversible one-click actions (restore a date, set the default role, copy
    a link). A refusal with nothing to confirm (deleting a role that is still given) is explained by a message,
    not by a dialog.

## Navigation

A fixed sidebar on desktop (`md:` and up, 240px, the `aside` of `app-shell.tsx`), a drawer (shadcn / Base UI
`Sheet`, left side) on mobile, opened from a compact top bar (56px) holding the trigger, the logo and the BDE's
name. The content of the nav (links, user menu, language switcher, theme toggle) is the same in both — only the
container changes.

- The active item: a `bg-primary/10` background, `text-sidebar-foreground` text (never `text-primary` directly, see
  the contrast note above), a `text-primary` icon, and a 2px vertical accent bar on the left (`before:bg-primary`).
- Each item maps an `id` (`NavItem['id']`) to a Lucide icon through `NAV_ICONS` in `app-shell.tsx` — a new module
  that adds a top-level nav entry extends that type and that table, it does not hardcode an icon in the JSX.
- The user menu, the language switcher and the theme toggle live at the bottom of the nav (desktop and mobile),
  never in the page content.

## Interaction states

- **Hover**: `hover:bg-muted` / `hover:bg-accent` / `hover:bg-sidebar-accent` depending on context — never a text
  color change alone, always a background that moves.
- **Keyboard focus**: `focus-visible:ring-3 focus-visible:ring-ring/50` on every custom interactive element (nav
  links, footer links, `BrandMark`); the shadcn / Base UI components (`Button`, `Input`, `Select`…) already include
  it, do not remove it.
- **Skip link**: `app-shell.tsx` includes a "skip to the content" link (`sr-only` except on focus) pointing at
  `#main-content`. Keep it in any future layout rework.
- **Loading** and **empty**: see the Components section above.

## Accessibility

- AA contrast checked for all text (see the table above); check again for any new semantic color.
- One `h1` per page, a heading hierarchy with no skipped level.
- Full keyboard navigation: every interactive control is a native element (`button`, `a`) or a Base UI primitive
  that handles focus trap and `Escape` (menus, the mobile drawer, confirmation dialogs) with no extra code.
- `lang` is set on `<html>` from the active locale (`[locale]/layout.tsx`).
- Every decorative image (the logo) has an explicit `alt=""`; every icon-only button has a translated `aria-label`
  (see `ThemeToggle`, the mobile drawer's trigger).
- Every page has its own title (WCAG 2.4.2), set with `generateMetadata = pageTitle('namespace', 'key')`.

## For future modules

1. Never hardcode a color — use the existing semantic tokens (`background`, `card`, `muted`, `border`,
   `primary`…). If one is missing (for example "success", "warning"), add it in `globals.css` with the same 258
   hue and check its contrast before using it.
2. Respect the 4px spacing grid and the existing radius scale.
3. Every new route under `(app)/` adds its own `loading.tsx` with `Skeleton`s that match its real layout.
4. Every list or table that can be empty implements the "empty state" pattern (icon + title + description
   [+ action]), never a blank page.
5. A new module that shows up in the main nav extends `NavItem['id']` and `NAV_ICONS` in `app-shell.tsx`.
6. The accent color (`bde.accentColor`) stays reserved for primary actions and active states — never for large
   surfaces, never as the only text color on a neutral background.
7. Every destructive or irreversible action goes through `ConfirmDialog` (see "Confirmations").
