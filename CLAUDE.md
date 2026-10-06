# CLAUDE.md

Reference document for working on BDE_Network. Read this before making structural changes.

## Context

BDE_Network is an open-source, self-hosted management platform for Bureaux Des Étudiants (BDE) —
student associations at 42 network schools. Each BDE forks this repo and deploys its own
mono-tenant instance (their own database, their own `bde.config.yml`, their own OAuth app).

The repo is public and will be read by developers outside the project — code quality,
consistency, and absence of dead/half-finished code matter more than usual. The people
_using_ the deployed app (BDE members) are not necessarily technical — the UI must stay simple.

## Stack

- **Next.js 15** (App Router, `src/` directory), **TypeScript strict**, no `any`.
- **PostgreSQL** via **Prisma 7**, using the `@prisma/adapter-pg` driver adapter — no Rust
  query engine binary, no `DATABASE_URL` in `schema.prisma` (it lives in `prisma.config.ts` for
  the CLI, and is passed to `PrismaPg` explicitly in `src/lib/prisma.ts` for the app).
- **Tailwind CSS v4** + **shadcn/ui** (`base-nova` style, **Base UI** primitives — not Radix.
  Components use a `render` prop for custom elements, not `asChild`).
- **NextAuth v5** (`next-auth@beta`), JWT session strategy, **no adapter** (the schema has no
  Account/Session/VerificationToken tables — see Auth section). **A beta, on purpose**: 5.x is only
  published under the `beta` dist-tag, and the whole auth layer relies on its universal `auth()`.
  It is pinned to an **exact** version, together with `@auth/core` (which we import directly for
  the JWT types and must match what `next-auth` uses). Never bump either on its own: change both,
  run the tests (`removed-account.test.ts` is the one that matters), read the release notes.
- **Dependency hygiene**: `next` and `eslint-config-next` share one exact version.
  `package.json` `overrides` aligns NextAuth's optional `nodemailer` peer (7/8) with ours (10) —
  we never use its email provider. `npm run audit:prod` runs in CI and fails on a new
  high/critical advisory in production dependencies; the few that cannot be fixed without a major
  upgrade of Next.js or Prisma are in `scripts/audit-allowlist.json` with a reason (drop an entry
  when its dependency is fixed). Never run `npm audit fix --force`: it proposes downgrading
  Prisma and next-auth. Dependabot batches updates weekly (`.github/dependabot.yml`).
- **next-intl** for i18n: French default, English available, routes live under `src/app/[locale]/`.
- **Zod v4** for `bde.config.yml` validation.
- **Vitest** for unit tests, **GitHub Actions** (ubuntu + windows matrix) for CI.

## Directory structure

```
src/
  app/
    [locale]/
      layout.tsx          root layout: html/body, ThemeProvider, accent color, i18n provider
      page.tsx             login page (public)
      pending/page.tsx      waiting page for PENDING users
      auth-error/page.tsx    sign-in denied page (public)
      privacy/page.tsx       RGPD privacy policy (public)
      (app)/                route group: authenticated shell (sidebar/footer), guards auth+PENDING
        layout.tsx           builds navItems, delegates chrome to AppShell
        dashboard/page.tsx + loading.tsx
        members/page.tsx + actions.ts + loading.tsx   approve/refuse/remove members, give each one a role (server actions)
        roles/                 page + new/ + [id]/ + actions.ts + loading.tsx: custom roles (needs roles.manage)
        audit-log/page.tsx + loading.tsx               OWNER-only
        events/                events module (404 unless enabled): page, new/, [id]/, [id]/edit/,
                               shared-calendar/ (events.shared_calendar: BDE link), actions.ts (server actions),
                               loading.tsx for each route
        profile/                page + actions.ts: account info, personal calendar feed link
    api/
      auth/[...nextauth]/route.ts
      files/[...key]/route.ts            serves local-storage uploads
      me/export/route.ts                 self-service RGPD data export
      calendar/[token]/route.ts          personal .ics subscription feed (token-authenticated)
      calendar/bde/[token]/route.ts      BDE-wide .ics feed (token-authenticated, confirmed events only)
      events/[id]/ics/route.ts           "add to my calendar" download (session-authenticated)
      health/route.ts                    liveness + database check (Docker HEALTHCHECK, unavailable page)
  instrumentation.ts       startup checks (bde.config.yml + .env), then the events reminder scheduler (Node runtime only)
  components/
    ui/                    shadcn/ui primitives — do not hand-edit, regenerate via shadcn CLI
    layout/                app-shell (sidebar + mobile drawer), footer, user-menu
    events/                calendar, list, form, toolbar, category badge (module UI)
    roles/                 role form (permission checkboxes), list actions, permission groups for the form
    members/               role menu, approve/refuse and remove controls of the members panel
    theme-provider.tsx, theme-toggle.tsx
  config/                  bde.config.yml loader + Zod schema (src/config/index.ts, schema.ts)
  i18n/                    next-intl routing/navigation/request config
  lib/
    auth/                  NextAuth config + 42 OAuth provider
    notifications/         NotificationAdapter + email/discord/slack/none adapters
    events/                events module domain: time, recurrence, ics, access, queries, actions
                           helpers, notifications, reminders, scheduler (see "Events module")
    storage/                StorageAdapter + local adapter
    permissions/           registry (the list of permissions) + resolution and `can()`
    roles/                 escalation rules (guards), input validation, transactional operations, `execute`
    roles/view.ts          what pages need to show the right choices (actor from a session, role facts) — display only
    audit-log.ts, account-label.ts, health.ts, prisma.ts, color.ts, utils.ts
  types/next-auth.d.ts     Session/User/JWT module augmentation
  test/                    session fixtures, in-memory roles database, migration tests
  middleware.ts             next-intl locale routing, Node.js runtime (not Edge — see below)
prisma/
  schema.prisma, seed.ts (+ seed-events.ts), migrations/ (20261005180000_custom_roles converts the old roles)
scripts/
  backup.sh, restore.sh     POSIX sh, need only Docker on the server (no Node): one tar.gz with DB + uploads
  audit-prod.mjs            CI gate on production dependency advisories (+ audit-allowlist.json)
docker/
  prisma.config.mjs         Prisma config used by the production image to run `migrate deploy`
messages/
  fr.json, en.json          next-intl message catalogs
docs/                        installation, configuration, user guide, events, contributing, deployment, design
```

## Data model (Prisma)

`User`, `UserStatus` (enum), `Role`, `AuditLog`, plus the events module's `Event`,
`EventAssignee`, `EventCancellation`, `EventReminder`, `BdeCalendarFeed` (see "Events module"). Finances and
meetings do not exist yet.

- **`UserStatus`**: `OWNER | MEMBER | PENDING`. OWNER comes only from `bde.config.yml` and holds every
  permission; PENDING waits for approval and holds nothing; MEMBER's rights are those of its **one custom
  role**. Neither OWNER nor PENDING is a role.
- **`Role`** (custom, created by each BDE): `name` (unique, case-insensitively), `description`,
  `permissions: String[]` (free-form keys checked against the registry in code, like module keys — a
  new permission needs no migration), `allPermissions` ("everything, including future modules", the default
  Admin role) and `isDefault` (exactly one: offered at approval, and where a former owner lands).
  The migration adds database guards the Prisma schema cannot express: a CHECK that a member has a role and
  nobody else does, a partial unique index on `isDefault`, and `onDelete: Restrict` on `User.roleId` (a role
  still held cannot be deleted). CI checks the migrations leave no drift from `schema.prisma`.
- **`User`**: synced from the 42 API on every login (`login`, `fullName`, `email`, `photoUrl`,
  `campus`). Removing a member **deletes the row** — there's no soft-delete: it keeps the RGPD story
  simple (real erasure). `status` + `roleId` replace the old `role` enum; the per-user `ModulePermission`
  table is gone (permissions live on roles).
- **`AuditLog`**: append-only, OWNER-only to read, never edited/deleted from the app. Every row
  stores `actorLogin: String` (plain text) **and** an optional `actorId` FK (`onDelete: SetNull`).
  This is the pattern to replicate on any future business entity: keep a text field with the
  author's login so history survives the author being removed, alongside the normal relation for
  when the account still exists.

**Convention for business entities** (`Event` is the reference implementation; finances and
meetings will follow): give each one a `schoolYear: String` field (format `"2025-2026"`, September
to August, computed by `schoolYearOf` in `src/lib/events/time.ts`) so the UI can filter by
academic year. Follow the same `authorLogin` + optional `authorId` (`onDelete: SetNull`) pattern
as `AuditLog` for any member-authored record, and keep a plain-text `login` on join rows that
point at a user (see `EventAssignee`).

## Authentication & permissions

- **42 OAuth only**, no passwords. Provider defined in `src/lib/auth/fortytwo-provider.ts` (generic
  OAuth2 config — there's no maintained official 42 provider for next-auth v5).
- **No database adapter.** JWT holds only `login` (see `src/types/next-auth.d.ts` — the module
  augmentation for `JWT` must target `@auth/core/jwt`, not `next-auth/jwt`: the latter only
  re-exports the type and declaration merging silently fails against it, which surfaces as
  `token.id` typing as `{}` instead of `string`, not as an import error).
- **`signIn` callback** (`src/lib/auth/index.ts`): rejects if the user's primary 42 campus isn't
  in `bde.config.yml`'s `auth.allowedCampuses`. Otherwise upserts the `User` row: status becomes
  `OWNER` if the login is in `auth.owners`, `PENDING` on first login otherwise. An existing owner
  who is no longer listed becomes a `MEMBER` with the **default role** (`src/lib/auth/account.ts`; no default
  role: `PENDING`) on next login — config is the source of truth for `OWNER`, checked every login, never
  settable from the UI.
- **`jwt` and `session` callbacks** (`src/lib/auth/callbacks.ts`) re-read the `User` row **and its role** from
  the DB on every call (not just at login) and resolve the permissions into the session
  (`session.user.status / roleId / roleName / permissions / holdsAll`, built by `lib/auth/access.ts`). Role
  changes made by an admin take effect on the affected user's very next request, without them needing to log
  out — worth the extra query for a small BDE app. The same lookup is what signs out a **removed member**: their
  row is gone but the JWT stays valid for 30 days, so `jwt` returns `null` (Auth.js then clears the cookie and
  `auth()` resolves to null) and `session` throws rather than return a user without id/status (or a member
  without a role, which the database refuses to store).
- **Fail closed on identity.** `getEffectiveSession` returns null unless the session carries an id, a login, a
  known status, resolved permissions and (for a member) a role; `isApproved` is an allow-list
  (`APPROVED_STATUSES`), never `!== 'PENDING'`; `can()` is false for anything missing or unknown; and any query
  keyed on a user id must never see `undefined` — **Prisma drops a filter whose value is `undefined`**, so
  `where: { userId }` returns every row. Guard the id before the query (`requireUserId` in
  `events/export.ts`). The regression test is `src/lib/auth/removed-account.test.ts` (real NextAuth config +
  forged cookie; its fake database reproduces Prisma's `undefined` behaviour).

- **Route guards live in Server Components**, not middleware (`(app)/layout.tsx` redirects
  unauthenticated users to `/`, `PENDING` users to `/pending`; `members/page.tsx` and
  `roles/` and `audit-log/page.tsx` additionally check `can(user, 'members.manage' | 'roles.manage')` /
  `canViewAuditLog`). Every
  session/DB-backed route has `export const dynamic = 'force-dynamic'` — verify this stays true
  when adding new authenticated pages, otherwise Next's static optimization could theoretically
  cache one user's render for another (checked against the prerender manifest when this was
  built: none of these routes were actually being prerendered despite the build output's
  misleading `●` SSG marker, but the explicit export makes it a guarantee, not an accident).
- **Permissions** (`src/lib/permissions/`): the list lives in code (`registry.ts`): core `members.manage`,
  `roles.manage`, plus `<module>.view` / `<module>.manage` for **every enabled module** (managing implies
  viewing) and the extras a module declares in `MODULE_EXTRA_PERMISSIONS` (events: `shared_calendar`). Check
  with `can(session.user, key)`; server actions and pages re-check themselves — never rely solely on a hidden
  button. The audit log is **not** a permission: `canViewAuditLog` is OWNER-only. Always build on
  `getEffectiveSession`, never `auth()` directly. A module's pages/actions get their access through one
  function (for events: `getEventsAccess` / `requireEventsManager` in `src/lib/events/access.ts`) that returns
  null when the module is disabled — pages treat null as `notFound()`, actions throw `Forbidden`.
- **Roles and privilege escalation** (`src/lib/roles/`, **non-negotiable**). One idea: you can only hand out,
  edit or take away what you hold. `guards.ts` has the pure rules (a role is _covered_ by the actor when they
  hold every permission it grants; a role with `allPermissions` is covered only by someone who holds all): no
  granting a permission you lack; no editing/deleting/re-flagging **your own role** or one above you; no
  changing **your own** role; no moving or removing a member whose current role you do not cover, nor assigning
  one you do not cover; never an owner; a role still held (or the default) is not deleted. Colleagues with
  exactly your rights _can_ be moved (everything is audited). `service.ts` applies them and writes the audit
  entry **in the same transaction**; `execute.ts` wraps every action: permission gate, the actor's rights **read
  again from the database inside the transaction**, SERIALIZABLE with retry, a refusal rolls back and comes out
  as a code (`errors.ts`, translated under `roles.errors.*`). While the dev owner simulates a role, the
  simulated rights bind the action and the audit entry says so. Tests: `escalation.test.ts` (real actions on
  `test/fake-roles-db.ts`, which also enforces the database guards), `guards.test.ts`, `execute.test.ts`; they
  were mutation-checked (each rule re-broken must fail a test) — redo that when touching a rule.
- Permissions of a module that is not enabled stay in the role but are ignored (and an edit preserves them);
  the form only offers enabled modules and the server refuses an unknown key rather than dropping it.

## Configuration: bde.config.yml vs .env

- **`bde.config.yml`** is _versioned_ (committed) — each BDE's fork edits it directly, no
  secrets in it. Validated with Zod (`src/config/schema.ts`) on every load, cached after first
  read (`src/config/index.ts`). `bde.config.example.yml` is the annotated reference copy.
  An optional git-ignored `bde.config.local.yml` replaces it when present (full file, no merge) so
  personal values stay out of commits — see `docs/configuration.md`.
- **`.env`** holds only secrets/machine-specific values (DB credentials, `AUTH_SECRET`, 42 OAuth
  client id/secret, SMTP, webhook URLs) — never committed.
- **Startup validation, in two places.** `bde.config.yml` is validated in `next.config.ts` (it fails
  `next build`/`next dev` fast, before any compilation) **and** again when the server starts, from
  `src/instrumentation.ts` → `src/lib/startup-checks.ts`. The second one is not redundant: a
  standalone production build (the Docker image) **never evaluates `next.config.ts` at start-up**,
  its config is inlined in `server.js`. `.env` is checked only there (`src/config/env.ts`, pure and
  unit-tested): required variables (`AUTH_SECRET` ≥ 32 characters, 42 OAuth id/secret, `DATABASE_URL`),
  plus the SMTP/webhook variables of the channels the _events_ notifications actually use (the
  `member*` notifications are not wired, so they don't count). Errors refuse to start with a French
  message a non-developer can act on (the container then restarts in a loop; `docker compose logs
app` shows it); warnings (placeholder owner `votre-login-42`, public `http://` `APP_URL`) don't block.
  **Never check `.env` at build time**: the image is built without it — `instrumentation.ts` skips
  `NEXT_PHASE === 'phase-production-build'`.
- `src/instrumentation.ts` is compiled for the Edge runtime too, so it does nothing but
  `await import(...)` its Node-only modules behind `process.env.NEXT_RUNTIME === 'nodejs'`
  (static imports of `node:fs`/Prisma there fail the Edge bundle with `UnhandledSchemeError`;
  verified: `next build` emits only `instrumentation.js`). Keep every import in it dynamic and guarded.
- `bde.config.local.yml` (git-ignored) replaces `bde.config.yml` when present, whole-file, no merge.
- `src/middleware.ts` runs on the **Node.js runtime** (`export const config = { runtime:
'nodejs' }`), stable since Next.js 15.5. It doesn't currently read `bde.config.yml` (locale
  routing default is hardcoded to `"fr"` for simplicity — `bde.defaultLocale` is validated but
  not yet wired into routing), but the Node runtime is there if that changes.

## Notifications & storage

- `src/lib/notifications/`: `NotificationAdapter` interface, adapters for email (nodemailer/SMTP),
  Discord webhook, Slack webhook, and a no-op `none`. `notify(event, message)` picks the adapter
  from the channel configured per event in `bde.config.yml`'s `notifications` section. The events
  module is the first caller (`eventConfirmed`, `eventReminder`). `memberPending/Approved/Removed`
  are still unwired. Notification keys added after the first release must default to `"none"` in
  the Zod schema so old configs keep validating. Callers must treat notification as best-effort:
  never let it throw into the action that triggered it (see `deliver()` in
  `src/lib/events/notifications.ts`, which also isolates failures per email recipient).
- `src/lib/storage/`: `StorageAdapter` interface, only a local-disk implementation
  (`storage/uploads/`, served through `/api/files/[...key]` rather than `/public` so a future
  access-control check can sit in front of it). `getStorageAdapter()` is the single factory
  function to change when an S3 adapter is added.

## Events module (`modules.enabled: [events]`)

User guide: `docs/events.md`. The shape worth knowing before touching it:

- **An event is one row.** A recurring event is a single "series master" (`startsAt`,
  `endsAt`, `recurrence`, `recurrenceUntil`); occurrences are **computed**, never stored
  (`allOccurrences` in `src/lib/events/recurrence.ts`), on the wall clock of `bde.timezone` so DST
  doesn't shift local times. Editing edits the series; the only per-occurrence state is
  `EventCancellation` (cancelled date) and `EventReminder` (reminder already claimed). All
  instants are UTC in the database; anything typed or shown goes through `src/lib/events/time.ts`
  (Intl only, no date library) and `format.ts`.
- **Event input is validated by one pure Zod module** (`src/lib/events/input.ts`): required =
  title, description, location, category, start, end (+ series end date); only the assignees are
  optional. The form imports the very same `parseEventInput` to show errors before sending, and
  the server actions run it again — never trust the browser. `Event.description`/`location` stay
  nullable in Prisma on purpose: rows created before the rule must keep rendering, and are only
  blocked at their next edit through the form (status toggle / cancel-a-date don't go through it).
- **Visibility is decided in one place.** `expandEvents` (`occurrences.ts`) drops drafts unless
  `includeDrafts`; the queries also exclude them in SQL. Every consumer (calendar, list,
  dashboard, `.ics` download, subscription feed) passes `includeDrafts = canManage`. A draft the
  user can't see is a 404, not a 403.
- **Subscription feed** (`/api/calendar/[token]`): token = 32 random bytes in `User.calendarToken`,
  stored in clear (so the profile can show the link), recomputed per request from the token owner's
  _current_ role/permission, same bare 404 for every failure. Removing a member deletes their row,
  so their token stops resolving immediately. Never log the token.
- **BDE-wide feed** (`/api/calendar/bde/[token]`, `BdeCalendarFeed` singleton row `id = "bde"`,
  `token` null = disabled): a second, independent secret from the per-member tokens. It has no owner,
  so it can never widen: `buildBdeSubscriptionFeed` asks for `includeDrafts: false` _and_ re-filters
  to `CONFIRMED`. Managed only with the `events.shared_calendar` permission (`canManageSharedCalendar` /
  `requireSharedCalendarManager` — _not_ `events.manage`) from
  `events/shared-calendar`. Enable is idempotent; regenerate/disable overwrite the single column, so the
  old link 404s at once. Audit actions `calendar_feed.enable|regenerate|disable` with targetType
  `CalendarFeed` and **never the token** (nor in logs). Removing a member does not touch it: the members
  page, reached with `?removed=<login>` (login pattern-checked), _offers_ regeneration when a link is
  active — never automatic, because it forces pasting the link again. Its honest limit is documented:
  access to a shared Google/Outlook calendar is managed there, not here. Both feed routes share
  `calendarFeedResponse` (`feed-response.ts`).
- **Notifications are best-effort and after the response.** `after(() => notifyEventConfirmed(id))`
  in the actions; the once-only guarantee is the atomic `confirmationNotifiedAt` claim.
- **Reminders** (`reminders.ts` + `scheduler.ts`): an in-process loop (every 5 min) started from
  `instrumentation.ts`. Exactly-once-or-lost: insert `EventReminder(eventId, occurrenceStart)` (unique)
  _before_ sending, ignore `P2002`. Due from `reminderHour` the day before; catch-up until the
  occurrence starts. Tested in `reminders.test.ts` including restart and concurrent callers.
- **Tests that must keep passing** when you change access rules: `access.test.ts`,
  `events/actions.test.ts` (every action refused for PENDING / member without permission / a role that
  only views / module disabled), `events/pages.test.tsx`, `export.test.ts`, `export-bde.test.ts`, `shared-calendar/*.test.ts(x)`.
- **Adding another module** follows the same recipe: a key in `modules.enabled` + a config section
  validated in `src/config/schema.ts` (required only when enabled), one `getXAccess()` gate
  returning null when disabled, `notFound()` on pages, a nav entry in `(app)/layout.tsx` + `NavItem`
  - `NAV_ICONS`, its permissions (`<module>.view`/`.manage` are automatic; extras go in `MODULE_EXTRA_PERMISSIONS` with
    their `permissions.items.<module>.<name>` messages), audit entries for every mutation, FR/EN messages, `loading.tsx` per route, seed data, a `docs/<module>.md`.

## Production image & hardening

- **Dockerfile** (multi-stage): `next build` with `output: 'standalone'` (server.js + only the
  node_modules it uses; `outputFileTracingExcludes` drops sharp/typescript, `images.unoptimized`
  removes the `/_next/image` endpoint), run with `node server.js` — no npm in the final image.
  The Prisma CLI (a dev dependency, so not in the bundle) is installed separately at the lockfile's
  exact version into `/opt/migrate` and **pruned of what only Studio / `prisma dev` use** (~120 MB);
  `CMD` runs `prisma migrate deploy --config /opt/migrate/prisma.config.mjs` then `node server.js`.
  If a Prisma bump ever makes `migrate deploy` need a pruned file, the CI `docker` job (build + start
  against Postgres + `/api/health`) fails. `.dockerignore` must keep `.audit`, `.env*` and
  `bde.config.local.yml` out of the image. `HEALTHCHECK` calls `/api/health` (503 when the DB is down).
- **docker-compose.yml** publishes the app on `${APP_BIND:-127.0.0.1}:3000`: only the reverse proxy
  reaches it unless the operator opts out (`APP_BIND=0.0.0.0`, documented in `docs/deployment.md`).
- **Security headers** (`src/lib/security-headers.ts`, wired in `next.config.ts`): CSP (production
  only; `'unsafe-inline'` is needed by Next hydration and next-themes; no `upgrade-insecure-requests`
  so an instance without an HTTPS proxy still works; profile pictures from `cdn.intra.42.fr`),
  nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, and HSTS only when the request came
  with `X-Forwarded-Proto: https`. A new external image/script host must be added to the CSP.
- **Database down**: Auth.js turns a failing session lookup into "no session", which looks like a
  logged-out visitor. `(app)/layout.tsx` and the login page therefore call `isDatabaseReachable()`
  (`src/lib/health.ts`) before redirecting to `/` and send to `/unavailable` instead (translated,
  reassuring, polls `/api/health` and brings the visitor back). The pool connect timeout is 3 s.

## Design system

Full spec (typography scale, color tokens + contrast rationale, spacing/radius scale, component
and empty/loading-state conventions, accessibility rules): **`docs/design.md`**. Read it before
touching layout or adding UI. The short version:

- One typeface (Geist, sans-serif only, wired through `--font-sans` in `src/app/globals.css`) —
  never let that variable self-reference (`--font-sans: var(--font-sans)`), it silently falls
  back to the browser's serif default with no error.
- Neutral color scale is OKLCH hue `258` (a faint blue) at low chroma, three light/dark tokens
  never touch pure black/white (`--background` < `--card`/`--sidebar` < `--popover` in dark
  mode). Never hardcode a color — consume the semantic tokens (`bg-background`, `border-border`,
  etc.); change the palette in one place, `globals.css`.
- `bde.accentColor` (arbitrary per-fork hex, via `buildAccentStyle()` in `src/lib/color.ts`) is
  reserved for primary actions and active states — never for large surfaces, and never as a
  standalone text color on a neutral background (its contrast is only guaranteed against a solid
  fill with `getContrastingTextColor`'s black/white pick, not against arbitrary backgrounds — the
  default teal fails AA as text on the dark sidebar, 3.4:1). Active nav state = translucent
  background + `foreground`-colored text + accent-colored icon/left bar, not accent-colored text.
- Per-fork colors that are not the accent (events: `events.categories[].color`) are applied
  inline as a dot, a left border or a translucent tint (`color-mix`), never as text color or a
  large surface, so contrast always rests on the neutral `foreground` token.
- Every list/table that can be empty renders an empty state (icon-in-muted-circle + title +
  description [+ CTA]) — never a blank card. Every `(app)/` route ships a `loading.tsx` with
  `Skeleton`s shaped like its real content, not a generic spinner.
- Sidebar nav items are keyed by `NavItem['id']` mapped to a Lucide icon in `NAV_ICONS`
  (`src/components/layout/app-shell.tsx`) — a new top-level module extends that type and table,
  it doesn't inline an icon in JSX.

## Conventions

- **Conventional Commits**, atomic commits per logical change.
- **No `any`** (`@typescript-eslint/no-explicit-any` is an error, not a warning).
- Cross-platform: no `&&`/`||`/`$VAR`/`rm -rf`/`cp` in npm scripts — use `cross-env`, `rimraf`,
  or plain Node. LF line endings are enforced by `.gitattributes`. The exception is the server-side
  operations scripts (`scripts/backup.sh`, `restore.sh`): the server only has Docker, so they are
  POSIX `sh` (kept `shellcheck -s sh` clean, run from Git Bash/WSL on Windows, `MSYS_NO_PATHCONV=1`
  inside because Git Bash rewrites `/app/...` arguments).
- All user-facing strings go through next-intl (`messages/fr.json` + `en.json`) — no hardcoded
  UI text in components.
- shadcn/ui components in `src/components/ui/` are excluded from ESLint/Prettier (generated
  code) — don't hand-edit; re-run `npx shadcn add <component>` instead.
- `docker-compose.dev.yml` runs `prisma db push --accept-data-loss` on start (so the dev database gets neither
  the data conversions nor the CHECK / partial index of the migrations: `seed:demo` recreates the roles and
  demo accounts) (Prisma refuses to
  add a unique index to an existing table non-interactively); production applies the committed
  migrations with `prisma migrate deploy`. A new model therefore needs **both** the schema change and
  a migration (generate the SQL without touching a database via `prisma migrate diff
--from-schema <old> --to-schema prisma/schema.prisma --script`).
- Run `npm run lint`, `npm run typecheck`, `npm run format`, and `npm run test` before
  considering a change done; `npm run build` is the closest thing to a full integration check
  since most pages are `force-dynamic` and won't otherwise get exercised by `next dev` alone.
