# Design system

The visual identity of BDE_Network is the "Galets" direction (pebbles): surfaces instead of lines, one accent moment per screen,
dense titles over calm text, generous nested radii. This document is the reference for the whole platform: read it before
touching layout or adding UI. It is in English only, like `docs/architecture.md`.

Everything below is a CSS variable in `src/app/globals.css`. **A component never writes a colour, a size, a radius, a shadow
or a duration of its own**: it consumes a token (`design-tokens.test.ts` fails on a hex colour, an emoji, a font or an
`outline-none` in a component). The shadcn names (`--background`, `--primary`…) are aliases onto these tokens, so that the primitives of
`src/components/ui` follow the palette without being rewritten. One collision to know: in a class, `bg-muted` is the background
`surface-2`, and `text-muted-foreground` is the text colour `--muted`.

## Principles

1. **Surfaces rather than lines.** Hierarchy comes from three backgrounds (`bg` → `surface` → `surface-2`) and very soft shadows.
   Cards never have a border. The hairline (`line`) only separates rows inside a card.
2. **One accent moment per screen.** One element is entirely filled with the BDE's colour: the "Next event" card on the dashboard,
   the selected day of the calendar, the main action of a form. Elsewhere the accent is only soft (`accent-soft`) or text (`accent-ink`).
3. **Dense titles, calm text.** Titles are Manrope 800 with tight tracking (−0.03 em); body text is 500 or 600. The contrast of
   weights is the personality, not colours or effects.
4. **Generous, nested radii.** An element inside another has a smaller radius: card 24, inner block 16, icon tile 12, chip 8.
   Interactive controls are pills.
5. **Icons are always captioned.** In the navigation an icon never stands alone: it has its label.
6. **Data is ink, not accent.** Gauges, figures and charts use `ink`, which stays readable whatever colour the BDE chose.

Avoid: gradients, decorative blur, glows, coloured shadows; a border around a card, or a coloured border on one side; more than one
accent-filled surface at a time (besides the main button); the accent for data, for statuses (success, error) or for long text;
spaced capital letters (except the weekday abbreviation in a date tile); a radius under 8 px on a control; bounce, springs,
parallax, a movement over 8 px on hover; any font other than Manrope; emoji in the interface; drop shadows in the dark theme (a
hairline replaces them); reduced opacity to grey out text (use `muted` or `disabled`).

## Typography

One typeface: **Manrope**, variable 200–800, loaded by `next/font` in `src/app/[locale]/layout.tsx` and **served by the platform
itself**: Next.js downloads the font file when the image is _built_ and serves it from `/_next/static/media/`, so a page makes no
request to Google when it runs (the policy says `font-src 'self'`, and `qa/browsers/self-hosted.spec.ts` plays it in a browser).
Fallback `system-ui, sans-serif`. Code and links to copy use the system's monospace (`ui-monospace`), not a second web font. The
startup page (`docker/startup-problems.mjs`) has no layout to load a font with: it uses `system-ui`.

Numbers are `tabular-nums` in amounts, counters, times and tables (`tabular`).

| Token         | Size / line | Weight           | Tracking | Use                                                  |
| ------------- | ----------- | ---------------- | -------- | ---------------------------------------------------- |
| `display`     | 31 / 1.08   | 800              | −0.03 em | Title of the accent card (25 on a phone)             |
| `title-1`     | 27 / 1.10   | 800              | −0.03 em | Page title (29 on a phone)                           |
| `title-2`     | 20 / 1.20   | 800              | −0.02 em | Dialog title, date of the side panel                 |
| `title-3`     | 18 / 1.25   | 800              | −0.02 em | Month of the calendar, section title                 |
| `figure`      | 34 / 1.00   | 800              | −0.03 em | Key figures (27 on a phone)                          |
| `card-title`  | 15 / 1.30   | 700              | 0        | Title of a card                                      |
| `body`        | 14 / 1.45   | 500              | 0        | Running text                                         |
| `body-strong` | 14 / 1.45   | 700              | 0        | Button label, name of a list item                    |
| `small`       | 12.5 / 1.40 | 600              | 0        | Metadata, help, card links                           |
| `caption`     | 12 / 1.35   | 700              | 0        | Badges, table headers, weekdays                      |
| `micro`       | 11 / 1.20   | 600 (800 active) | 0        | Labels of the rail and the tab bar (10.5 on a phone) |

Utilities: `text-display`, `text-title-1`, `text-body`… (`@theme` in `globals.css`). `cn()` knows them (`lib/utils.ts`): without
that, `twMerge` takes `text-micro` for a colour and silently drops `text-accent-on`. Paragraphs are `text-wrap: pretty`, a line is
68 characters at most, no text under 10.5 px.

## Colors

### Neutrals

| Token           | Role                                                     | Light                | Dark                    |
| --------------- | -------------------------------------------------------- | -------------------- | ----------------------- |
| `--bg`          | Page background, rail                                    | `#ECEEF1`            | `#0E1012`               |
| `--surface`     | Cards, dialogs, tab bar                                  | `#FFFFFF`            | `#181B1F`               |
| `--surface-2`   | Inner blocks, fields, calendar cells, hover on a surface | `#F2F3F5`            | `#22262B`               |
| `--surface-3`   | Pressed on `surface-2`                                   | `#E8EAEE`            | `#2B3036`               |
| `--ink`         | Main text, icons, data                                   | `#14161A`            | `#ECEEF1`               |
| `--muted`       | Secondary text, metadata, inactive icons                 | `#5A606A`            | `#9AA1AB`               |
| `--disabled`    | Disabled text and icons (below 4.5:1: accepted by WCAG)  | `#A3A8B0`            | `#5C636C`               |
| `--line`        | Separator between rows in a card                         | `#E6E8EC`            | `#2A2F36`               |
| `--hover-on-bg` | Hover on an element laid on `bg`                         | `rgba(20,22,26,.05)` | `rgba(236,238,241,.06)` |
| `--scrim`       | Veil behind dialogs and sheets                           | `rgba(14,16,18,.48)` | `rgba(0,0,0,.64)`       |

### Semantic colours

Fixed, never tied to the accent. There is no "info" colour: neutral information is `surface-2` and `ink`.

| Token                           | Light                 | Dark                                |
| ------------------------------- | --------------------- | ----------------------------------- |
| `--danger` / `--danger-soft`    | `#B42318` / `#FDECEB` | `#FF8A7A` / `rgba(255,120,100,.15)` |
| `--danger-fill` / `--on-danger` | `#B42318` / `#FFFFFF` | `#D34247` / `#FFFFFF`               |
| `--success` / `--success-soft`  | `#146C43` / `#E6F4EC` | `#5FD49A` / `rgba(80,200,140,.15)`  |
| `--warning` / `--warning-soft`  | `#8A5A00` / `#FDF3DC` | `#F5C56B` / `rgba(245,190,90,.15)`  |

The dark `--danger-fill` is `#D34247`, not `#E5484D`: white text on `#E5484D` is 3.9:1, under AA; darkened by 8 % it is 4.5:1.

### Contrast (WCAG AA)

`src/lib/design-tokens.test.ts` plays this table on the real tokens, in both themes: `ink` on `surface` 18.1:1 (dark 14.9),
`muted` on `surface` 6.3:1, on `surface-2` 5.7, on `bg` 5.4 (dark 6.6 / 5.8 / 7.3); every semantic text on its own soft background
and on `surface`; `on-danger` on `danger-fill`. Text reaches 4.5:1, headings of 18 px in 800 and controls' outlines 3:1.

## Accent

The BDE chooses any hexadecimal colour (Settings, Your BDE; asked by the installer). It is never used as it is: it feeds five tokens,
for each theme separately. The default of a new installation is **`#2F5BEA`** (`DEFAULT_ACCENT` in `src/config/schema.ts`: the
installer proposes it, the example configuration writes it); a platform that has a colour keeps it.

| Token              | Role                                                                        |
| ------------------ | --------------------------------------------------------------------------- |
| `--accent-fill`    | Solid background: main button, accent card, logo, today, Create button      |
| `--accent-on`      | Text and icons on `accent-fill` (`#FFFFFF` or `#111111`)                    |
| `--accent-ink`     | The accent as text or icon on a surface: links, active icon, **focus ring** |
| `--accent-soft`    | Translucent tint: active rail entry, icon tiles, event chips                |
| `--accent-on-soft` | A veil on `accent-fill` that only adds contrast: badge in the accent card   |

**The algorithm** (`deriveAccent` in `src/lib/color.ts`, tested on a spread of 500 colours and against the examples): the colour is
kept as the fill whenever white (4.5:1) or near-black `#111111` (4.5:1) carries text on it, otherwise it is darkened until white
does (and `adjusted` is true: the settings page says "Your colour was slightly adjusted to stay readable on buttons"). `ink` is
pushed toward black (light) or white (dark) until it reads 4.6:1 even on its own tint over the worst surface. An orange or a mid
green therefore takes dark text rather than being changed.

**Where it runs.** On the server, for both themes (the server cannot know the theme): `buildAccentStyle` writes
`--accent-fill-l`, `--accent-fill-d`… on `<html>`; `globals.css` picks the set of the theme with `:root` and `.dark`. No script, no flash.
The fallbacks in `globals.css` are the default accent's tokens (a test keeps them equal to the algorithm).

**States.** Hover and pressed on a fill are the fill darkened (white text: black veil at 8 % and 14 %) or lightened (dark text: white
at 16 % and 26 %): the contrast only goes up (`--accent-fill-hover`, `--accent-fill-pressed`). Hover on a soft tint adds 0.06 to its
opacity. A fill too close to the page (contrast under 1.4:1: a very light grey, a navy on dark) gets a hairline
(`accent-edge`, `inset 0 0 0 1px var(--line)`).

**Rules.** At most one filled "moment" per screen, plus the main button. Never the accent for data, for semantic statuses or
for running text. The focus ring is always `accent-ink`. The settings page (and the installer) show a live preview, light and dark:
a button, a link, the accent card (`AccentPreview`).

## Spacing

Base 4 px: `--space-1` 4 · `-2` 6 · `-3` 8 · `-4` 10 · `-5` 12 · `-6` 14 · `-7` 16 · `-8` 20 · `-9` 24 · `-10` 28 · `-11` 32 · `-12` 48.

| Context                            | Value                                                          |
| ---------------------------------- | -------------------------------------------------------------- |
| Gutter of the card grid            | 16 (12 on a phone)                                             |
| Page margin                        | 28 on a computer (the content follows the rail), 16 on a phone |
| Card padding                       | 22 (20 on a phone, 18 for a compact card)                      |
| Between a card's title and content | 14                                                             |
| A list row in a card               | 44 at least, `line` separator above                            |
| Label to field / between fields    | 6 / 16                                                         |

## Radii

| Token             | px  | Use                                                                  |
| ----------------- | --- | -------------------------------------------------------------------- |
| `--radius-xs`     | 8   | Event chip, keyboard shortcut, checkbox                              |
| `--radius-sm`     | 12  | Icon tile, hovered table row                                         |
| `--radius-md`     | 14  | Text area, calendar cell, date tile, logo                            |
| `--radius-lg`     | 16  | Rail entry, inner block, alert, menu                                 |
| `--radius-xl`     | 20  | Card on a phone, shortcut tile                                       |
| `--radius-2xl`    | 24  | Card                                                                 |
| `--radius-3xl`    | 26  | Accent card (the screen's "moment")                                  |
| `--radius-dialog` | 28  | Dialog, sheet (top corners)                                          |
| `--radius-pill`   | 999 | Buttons, one-line fields, badges, search, segmented control, tab bar |

Nesting: inner radius ≈ outer radius − padding, never under 8.

## Borders and shadows

No border, with two exceptions: the `1px solid var(--line)` between rows, and the outline of checkboxes and radio buttons.

| Token                                 | Light                                                                | Dark                                                                |
| ------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `--shadow-1` (cards, tiles, search)   | `0 1px 2px rgba(16,24,40,.05), 0 8px 24px -14px rgba(16,24,40,.14)`  | `0 0 0 1px rgba(255,255,255,.05)`                                   |
| `--shadow-2` (menus, tab bar, toasts) | `0 1px 2px rgba(16,24,40,.06), 0 16px 40px -12px rgba(16,24,40,.28)` | `0 0 0 1px rgba(255,255,255,.07), 0 16px 40px -10px rgba(0,0,0,.7)` |
| `--shadow-3` (dialogs)                | `0 2px 4px rgba(16,24,40,.06), 0 32px 64px -16px rgba(16,24,40,.32)` | `0 0 0 1px rgba(255,255,255,.08), 0 32px 64px -12px rgba(0,0,0,.8)` |
| `--ring-today`                        | `inset 0 0 0 2px var(--accent-fill)`                                 | same                                                                |

Utilities: `elev-1`, `elev-2`, `elev-3`, `accent-edge`.

## Motion

| Token             | Value                    | Use                                                  |
| ----------------- | ------------------------ | ---------------------------------------------------- |
| `--dur-instant`   | 80 ms                    | Press                                                |
| `--dur-fast`      | 140 ms                   | Hover colours, focus                                 |
| `--dur-base`      | 200 ms                   | Menus, switches, segmented control, dialog appearing |
| `--dur-slow`      | 280 ms                   | Mobile sheet, side panel                             |
| `--ease-standard` | `cubic-bezier(.2,0,0,1)` | Entering and changing                                |
| `--ease-exit`     | `cubic-bezier(.4,0,1,1)` | Leaving (duration × 0.75)                            |

Only `opacity`, `transform` (translation ≤ 8 px, scale ≥ 0.98), `background-color`, `color` and `box-shadow` are animated. With
`prefers-reduced-motion: reduce`, transitions and animations last 120 ms at most and transforms are off (`motion-safe:`).

## Icons

**Lucide**, as SVG bundled with the platform (no icon font, no request to a third party: privacy and the content policy). Sizes: 17 in a compact
field, 20 in buttons and fields, 22 in header actions, 23–24 in the navigation, 28 for the Create button and empty states. The
active entry of the rail and the tab bar is drawn with a thicker stroke (`strokeWidth` 2.4), the equivalent of the filled variant.
A decorative icon is `aria-hidden`; a button with only an icon has an `aria-label`.

## Breakpoints

| Name      | Width    | Navigation       | Dashboard grid                                   |
| --------- | -------- | ---------------- | ------------------------------------------------ |
| `mobile`  | < 640    | Floating tab bar | 1 column, shortcuts on 3 columns                 |
| `tablet`  | 640–1023 | Rail 96 px       | 6 columns                                        |
| `desktop` | ≥ 1024   | Rail 96 px       | 12 columns (8 + 4)                               |
| `wide`    | ≥ 1440   | Rail 96 px       | content at most 1 440 px (`max-w-wide`), centred |

## Accessibility

- **Contrast** AA: 4.5:1 for text, 3:1 for titles of 18 px in 800 and for control outlines.
- **Focus** is visible on every interactive element: `outline: 3px solid var(--accent-ink); outline-offset: 2px` (1 px on a rail entry
  or a row), by the one `:focus-visible` rule of the base layer. **`outline-none` is forbidden on anything focusable** (a utility beats
  the base layer: the ring disappears; a test scans the components). Text fields replace it with their inset ring.
- **Targets**: 44 × 44 on a phone (buttons are 44 high under 640 px), 32 high at least on a computer.
- **State never rests on colour alone**: today is a fill and a ring, a late task says "Yesterday" or "Late", a field in error has an icon and a
  message, an unconfirmed event is italic.
- `<nav aria-label>`, the active entry has `aria-current="page"`. Toasts are in an `aria-live="polite"` region, blocking alerts are `role="alert"`.
- Axe checks every page of the access matrix against WCAG 2.2 AA, light and dark, on a computer and a phone (`qa/browsers/a11y.spec.ts`).

## Components

Sizes in px. Hover, focus, pressed and disabled apply to every interactive component, with `--dur-fast` / `--ease-standard`.

### Buttons

`components/ui/button.tsx`. A pill, `body-strong`, a 20 px icon at the left (6 between icon and text), padding 18 (14 on the icon side).
Sizes: `sm` 32 (actions in a card or a table row), default 40 (forms, dialogs), `lg` 44 (page header). Under 640 px every size is 44.

| Variant (shadcn name)                            | Rest                        | Hover              | Pressed                   |
| ------------------------------------------------ | --------------------------- | ------------------ | ------------------------- |
| **Primary** (`default`)                          | `accent-fill` / `accent-on` | veil of the accent | veil of the accent        |
| **Secondary** (`secondary`, `outline`)           | `surface-2` / `ink`         | `surface-3`        | `surface-3`, `scale(.98)` |
| **Quiet** (`ghost`)                              | transparent / `ink`         | `surface-2`        | `surface-3`               |
| **On accent** (`onAccent`)                       | `accent-on` / `accent-fill` | background at .92  | .86                       |
| **Danger** (`destructive`)                       | `danger-soft` / `danger`    | darkened by 4 %    | same, `scale(.98)`        |
| **Confirm danger** (`confirm`, in a dialog only) | `danger-fill` / `on-danger` | black veil .08     | .14                       |

Disabled: `surface-2`, `disabled` text, no shadow, `cursor: not-allowed` (a button stays focusable when it says why it is unavailable).
Busy: the label stays, a 16 px circle (2 px stroke, a turn in 800 ms: `Spinner`) replaces the icon, the width does not change, `aria-busy`.
Icon button: a circle of 38 (44 on a phone), `surface-2`, icon 22, `aria-label` required. Create button (phone): a circle of 54, accent, icon 28.
Card link: `small`, weight 700, `accent-ink`, underlined on hover (`cardLink`). One main action per page.

### Fields

`components/ui/input.tsx`, `events/field-styles.tsx`. A text field is a pill of 44 on `surface-2`, no border, padding 16, `body`, placeholder `muted`.
Label above (`body-strong`, 6), help below (`small` muted, 6). Hover `surface-3`; focus: `surface` and `inset 0 0 0 2px var(--accent-ink)` (it
replaces the outline); error: the same ring in `danger`, `aria-invalid`, an icon and a message in `danger` linked by `aria-describedby`;
disabled: `disabled` text and label; read-only: transparent with an inset hairline. A **text area** has a radius of 14, padding 12 × 16, 96
high at least. A **native select** keeps the 3 px outline of the interface for its focus (Safari draws no shadow on a select).
Checkbox, radio: 20 px, the accent (`accent-color`). **Switch**: a pill of 44 × 26, `surface-3` off and `accent-fill` on, a thumb of 20 moving in
`--dur-base`. **Segmented control**: a pill `surface-2`, padding 4, segments of 36 (44 on a phone), the active one `surface` with `elev-1`.

### Cards

`components/ui/card.tsx`. Standard: `surface`, radius 24 (20 on a phone), padding 22 (20; 18 compact), `elev-1`. Accent ("moment"): `accent-fill`
with `accent-on` text at full strength, radius 26, padding 24, no shadow, one button at most (on accent). Inner block: `surface-2`, radius 16.
Shortcut tile: `surface`, radius 20 on a phone / 16, `elev-1`. A card header has the `card-title` at the left and an action at the right (14 below).
Rows in a card: `border-top: 1px solid var(--line)`, none under the last. A clickable card is entirely a link (`elev-2` on hover, `scale(.99)` pressed).
Icon tile: 38 (36 on a phone), radius 12, `accent-soft`, icon `accent-ink`. Date tile: 48 × 50, radius 14, `surface-2`, weekday in small capitals, day 18/800.
Avatar: circle of 26, 34 or 44, `surface-2`, initials 800.

### Rail (computer and tablet)

`components/layout/app-shell.tsx`. 96 wide, `bg`, no separator. The logo of the BDE at the top: a tile of 46 (the logo it uploaded, or its
initials on `accent-fill`). Entries: 74 wide, radius 16, a 23 px icon above a `micro` label; hover `hover-on-bg`; active (`aria-current`)
`accent-soft`, icon `accent-ink` with a thicker stroke, label `ink` 800. The entries are the ones the person may use, in order: Home,
Calendar, To validate (with a counter), Members, Roles, Log, Settings: **an entry for a thing that does not exist is never invented**. The avatar at the foot opens the account
menu: profile, theme, language, sign out. A counter is a pill of 18, accent, over the corner of the icon.

### Tab bar (phone)

Fixed at 16 from the edges and 26 above the bottom (plus the safe area), 70 high, a pill on `surface` with `elev-2`. Home · Calendar · **Create** · Members · More, as far as the
person may use them. "More" opens a sheet with the rest of the platform, the profile, the theme, the language and sign out; Create opens a sheet of what the person may
start (today: a new event). The content has 120 of padding at the bottom so that the bar never hides it.

### Page header

`components/layout/page-header.tsx`. On a computer: a small line above (`small`, `muted`: a date, a count) then `title-1`, and on the right the actions, the main one last (`lg`). A
page that belongs to a list (an event, a role) puts "‹ Calendar" where the line is. On a phone: the line, the title (29) and the avatar; once the title has scrolled
away a bar of 52 keeps its name (`bg` at 92 %, a 12 px blur: the only blur there is, a hairline fading in).

### Tables

`components/ui/table.tsx`. A table lives in a standard card. Header: 40 high, `caption` muted, no capitals, a `line` below. Row: 52 high (44 compact), 12 of
horizontal padding, the first column `body-strong`; the row under the pointer is `surface-2` with rounded ends; a selected row is `accent-soft`. Numbers right-aligned in
tabular figures; dates like "Fri 23 Oct". **Under 640 px a table is a list**: the header goes (for the eye), each row is a block, the first cell is its title and each
other cell says what it is (`data-label`). No table scrolls sideways on a phone. **A row of actions** (a request to approve, a member's role, a proposal to validate): on a computer the controls are on one line, aligned to the right of the column, and a menu is as wide as its longest option (`sm:w-auto`: a field is `w-full` by default, and a menu left like that fills the line and sends the buttons under it); on a phone the menu takes the line, then the buttons side by side, each one filling half (`max-sm:*:flex-1`, 44 px high), and the cell's content has `flex-1 min-w-0` since the cell is a row (label, then content). `qa/browsers/rows.spec.ts` measures it. Loading: rows of 12 high in `surface-2`, radius 6, a pulse of the opacity from .6 to 1 over 1.2 s.

### Badges

A pill of 22, `caption`, not interactive. Neutral (`surface-2`/`ink`: counts, roles, categories), accent (`accent-soft`/`accent-ink`), success, warning, danger (their soft
background and colour), solid (`accent-fill`: the counter on an icon, 18 high), on accent (`accent-on-soft`: only in the accent card). A category is a neutral badge
with a dot of its colour (never the colour as text). An event chip of the calendar: radius 8, padding 3 × 7, one truncated line, `accent-soft`/`accent-ink`; not
confirmed: italic on `surface-3`.

### Calendar

`components/events/month-calendar.tsx`. The month is a card holding a grid of 7 columns with a gap of 6; a cell is `surface-2` with radius 14 (out-of-month days transparent, number muted); the day
number is a 26 px pill; today is a pill of the accent and `--ring-today` on the cell; beyond three events "+ 2". From `lg` the selected day (today by default) has a 300 px panel
beside the grid, its events as `accent-soft` blocks; below, the panel is under the grid and the cells show dots. The list view groups events by day under a `small` bold
heading, one row per event. _Not built_: the 7-day strip of the phone's list (it would be a day selection the list does not have). Keyboard: arrows, Enter, PageUp/PageDown, T are the
specification's for a grid of days; the grid here is a table of links, reached with Tab (a day is a link).

### Dialogs

`components/ui/dialog.tsx`. On a computer: a centred panel, 480 wide, at most 90 % of the height, `surface`, radius 28, padding 24, `elev-3`, over `scrim`. Title `title-2`, description
`body` muted, content 20 below, the actions on the right (the secondary first, the main one last), a close button of 38 at the top right. On a phone: a **sheet** anchored at the bottom,
corners of 28, a handle of 36 × 4, padding 20 plus the safe area, buttons stacked at full width, the main one on top. Animation: the veil fades in 200 ms, the dialog goes from
`opacity 0, scale(.98)` to 1, the sheet from `translateY(100%)` in 280 ms; leaving takes three quarters of the time. `role="dialog"`, `aria-modal`, the title labels it, the focus is trapped,
Escape or a click on the veil closes it, the focus goes back to what opened it.

### Confirmations

**Every destructive or irreversible action asks through `ConfirmDialog`** (`components/confirm-dialog.tsx`): a dialog centred over the page, never a `<details>`, a popover or a block that unfolds
under the button. A title naming the action and its target, one sentence that does not repeat the title, a **confirm danger** button with a precise verb ("Delete", never "OK"), and
Cancel; `tone="default"` for a change that can be undone (a role change). The component guarantees the focus on Cancel (the secondary action of a destructive dialog), a focus trap, Escape
and a click outside to cancel, the focus given back (`returnFocusRef` when there is no trigger button) and a busy, non-repeatable confirm button while the action runs. From a Server
Component, `onConfirm` is an inline `'use server'` action. A new module's delete, cancel and regenerate buttons use it.

### Empty states

Inside the card or the zone, centred, 32 of padding: an icon tile of 56 (radius 18, `accent-soft`, icon 28 `accent-ink`), the title (`card-title`, 800) 14 below, a `body` muted text (320 wide at most),
and at most one action 16 below (the main one if it is what the page expects). No illustration, no forced humour: the text says what is missing and how to create it. Every list that can be empty uses
`components/galets/empty-state.tsx`; every `(app)` route has a `loading.tsx` of skeletons shaped like its content, starting with `PageHeaderSkeleton` (the same box as `PageHeader`: a screen of another height moves the footer).

### Alerts

`components/ui/alert.tsx`. An inline banner: radius 16, padding 14 × 16, the soft background of its meaning (`surface-2` for neutral information), a 20 px icon in the colour of the meaning, a title
in ink (700), a text in ink, a link in 700 underlined. `role="alert"` for an error that blocks, `role="status"` otherwise. A form error is repeated at the top of the form with a link to each field.

### Toasts

`components/ui/sonner.tsx`. `surface`, `elev-2`, a pill for one line and radius 18 beyond, padding 12 × 18, 48 high at least; an icon of 20 in the colour of the meaning, the text 700, an optional
action ("Undo") as a card link. Bottom right at 24 on a computer, centred above the tab bar on a phone, three at most, 4 s (6 with an action), paused on hover and focus, in an
`aria-live="polite"` region.

## Copywriting

Impersonal sentences, neither "tu" nor "vous": "Create an event", "No task in progress". Infinitive verbs on buttons, no full stop in a label. Short dates in French ("jeu. 22 oct."), 24-hour times
("18:30"), amounts "4 812,40 €" with a thin non-breaking space before the symbol. A count of registrations is "42 / 60 registered", or "42 registered" without a gauge (the platform has no registrations yet,
so there is no gauge).

**Who is addressed decides the form.** The interface is impersonal, as above. A message written to one identified person (the e-mail that
tells a member their access is approved, "Bonjour {name}, votre demande d'accès a été approuvée") says **"vous"** in French: it is a letter to someone,
not a screen. What is written to a team, such as a card in a chat channel, speaks about the person in the third person.

## Where it lives, and what differs from the original specification

| What                               | Where                                                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The tokens, utilities, base styles | `src/app/globals.css`                                                                                                                                               |
| The accent algorithm and its CSS   | `src/lib/color.ts` (`deriveAccent`, `buildAccentStyle`), `src/app/[locale]/layout.tsx` (on `<html>`)                                                                |
| The primitives                     | `src/components/ui/*`, `src/components/galets/*` (empty state, spinner, pill/card classes)                                                                          |
| The frame and the page header      | `src/components/layout/*`                                                                                                                                           |
| The tests that hold it             | `design-tokens.test.ts` (contrast, tokens, no hex/emoji/font/`outline-none`), `color.test.ts`, `utils.test.ts`, the visual references (`qa visual references`), axe |

Choices made for this platform that the original specification did not foresee or states otherwise: **Lucide** instead of an icon font (no third-party request); the dark `danger-fill` darkened to `#D34247` (AA);
counters at 11 px, not 10 (nothing under 10.5); the entries of the navigation are those the platform has (no Budget, no Announcements, no search, no "change BDE"); no gauge on the accent card
(no registrations); the view switch of the events is a `<nav>` of links (it changes the address), not a `tablist`; the week strip of the phone's list is not built; the compact title bar of a phone is
`title-3` (18), not 17.

## For future modules

A module adds: a nav entry (a key in `NavItem['id']`, an icon in `NAV_ICONS` of `app-shell.tsx`, a short label under `nav.rail.*`), its pages with a `PageHeader`, cards on the standard surface, an empty state
and a `loading.tsx` with skeletons, `ConfirmDialog` for anything destructive, tokens only (the guards of `design-tokens.test.ts` apply to it), and a screen in the visual references.

## Checklist

- [ ] No colour, size or radius written in a component (the test says so).
- [ ] Tried with four accents: `#2F5BEA`, `#E4572E`, `#1E9E6A`, `#F0B429`, in light and dark (`QA_ACCENT=… sh qa/platform.sh up`, `npx tsx qa/design-preview.ts`).
- [ ] One accent "moment" per screen.
- [ ] Focus visible on everything with the keyboard, a logical tab order.
- [ ] Targets of 44 px on a phone, the content never hidden by the tab bar.
- [ ] `prefers-reduced-motion` respected.
- [ ] No text under 10.5 px; contrast AA checked by axe.
