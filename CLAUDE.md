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
  Account/Session/VerificationToken tables — see Auth section).
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
      privacy/page.tsx       RGPD privacy policy (public)
      (app)/                route group: authenticated shell (navbar/footer), guards auth+PENDING
        layout.tsx
        dashboard/page.tsx
        members/page.tsx + actions.ts   member approval/removal (server actions)
        audit-log/page.tsx               OWNER-only
    api/
      auth/[...nextauth]/route.ts
      files/[...key]/route.ts            serves local-storage uploads
      me/export/route.ts                 self-service RGPD data export
  components/
    ui/                    shadcn/ui primitives — do not hand-edit, regenerate via shadcn CLI
    layout/                navbar, footer, nav-links, user-menu
    theme-provider.tsx, theme-toggle.tsx
  config/                  bde.config.yml loader + Zod schema (src/config/index.ts, schema.ts)
  i18n/                    next-intl routing/navigation/request config
  lib/
    auth/                  NextAuth config + 42 OAuth provider
    notifications/         NotificationAdapter + email/discord/slack/none adapters
    storage/                StorageAdapter + local adapter
    permissions.ts, audit-log.ts, prisma.ts, color.ts, utils.ts
  types/next-auth.d.ts     Session/User/JWT module augmentation
  middleware.ts             next-intl locale routing, Node.js runtime (not Edge — see below)
prisma/
  schema.prisma, seed.ts, migrations/
scripts/
  db-backup.mjs, db-restore.mjs   Node scripts (cross-platform, no shell), wrap `docker compose exec`
messages/
  fr.json, en.json          next-intl message catalogs
docs/                        installation, configuration, user guide, contributing, deployment
```

## Data model (Prisma)

Four things exist right now: `User`, `Role` (enum), `ModulePermission`, `AuditLog`. No business
entities (events, finances, meetings) yet.

- **`Role`**: `OWNER | ADMIN | MEMBER | PENDING`, ordered in that rank (see `src/lib/permissions.ts`).
- **`User`**: synced from the 42 API on every login (`login`, `fullName`, `email`, `photoUrl`,
  `campus`). Removing a member **deletes the row** — there's no soft-delete/status field beyond
  `Role`. This is deliberate: it keeps the RGPD story simple (real erasure) and keeps `PENDING`
  as just another role rather than a separate concept.
- **`ModulePermission`**: grants a user access to one module (`module: String`, free-form —
  validated against `bde.config.yml`'s `modules.enabled` at the app layer, not a Prisma enum,
  because modules don't exist as a fixed set yet). `OWNER` bypasses this check entirely (see
  `hasModuleAccess` in `src/lib/permissions.ts`).
- **`AuditLog`**: append-only, OWNER-only to read, never edited/deleted from the app. Every row
  stores `actorLogin: String` (plain text) **and** an optional `actorId` FK (`onDelete: SetNull`).
  This is the pattern to replicate on any future business entity: keep a text field with the
  author's login so history survives the author being removed, alongside the normal relation for
  when the account still exists.

**Convention for future business entities** (events, finances, meetings — not built yet): give
each one a `schoolYear: String` field (format `"2025-2026"`) so the UI can filter by academic
year. Follow the same `authorLogin` + optional `authorId` pattern as `AuditLog` for any
member-authored record.

## Authentication & permissions

- **42 OAuth only**, no passwords. Provider defined in `src/lib/auth/fortytwo-provider.ts` (generic
  OAuth2 config — there's no maintained official 42 provider for next-auth v5).
- **No database adapter.** JWT holds only `login` (see `src/types/next-auth.d.ts` — the module
  augmentation for `JWT` must target `@auth/core/jwt`, not `next-auth/jwt`: the latter only
  re-exports the type and declaration merging silently fails against it, which surfaces as
  `token.id` typing as `{}` instead of `string`, not as an import error).
- **`signIn` callback** (`src/lib/auth/index.ts`): rejects if the user's primary 42 campus isn't
  in `bde.config.yml`'s `auth.allowedCampuses`. Otherwise upserts the `User` row: role becomes
  `OWNER` if the login is in `auth.owners`, `PENDING` on first login otherwise. An existing user
  who is no longer listed as an owner is demoted to `MEMBER` (not `PENDING`) on next login —
  config is the source of truth for `OWNER`, checked every login, never settable from the UI.
- **`session` callback** re-reads the `User` row from the DB on every call (not just at login).
  This means role/permission changes made by an admin take effect on the affected user's very
  next request, without them needing to log out — worth the extra query for a small BDE app.
- **Route guards live in Server Components**, not middleware (`(app)/layout.tsx` redirects
  unauthenticated users to `/`, `PENDING` users to `/pending`; `members/page.tsx` and
  `audit-log/page.tsx` additionally check `canManageMembers`/`canViewAuditLog`). Every
  session/DB-backed route has `export const dynamic = 'force-dynamic'` — verify this stays true
  when adding new authenticated pages, otherwise Next's static optimization could theoretically
  cache one user's render for another (checked against the prerender manifest when this was
  built: none of these routes were actually being prerendered despite the build output's
  misleading `●` SSG marker, but the explicit export makes it a guarantee, not an accident).
- Permission helpers: `src/lib/permissions.ts` (`hasMinRole`, `canManageMembers`,
  `canViewAuditLog`, `hasModuleAccess`). Server actions (e.g. `members/actions.ts`) re-check
  permissions themselves — never rely solely on a hidden button.

## Configuration: bde.config.yml vs .env

- **`bde.config.yml`** is _versioned_ (committed) — each BDE's fork edits it directly, no
  secrets in it. Validated with Zod (`src/config/schema.ts`) on every load, cached after first
  read (`src/config/index.ts`). `bde.config.example.yml` is the annotated reference copy.
- **`.env`** holds only secrets/machine-specific values (DB credentials, `AUTH_SECRET`, 42 OAuth
  client id/secret, SMTP, webhook URLs) — never committed.
- **Validation happens in `next.config.ts`**, not `src/instrumentation.ts`. That was tried first
  and breaks: Next.js compiles `instrumentation.ts` for the Edge runtime too regardless of a
  `NEXT_RUNTIME` guard or a `export const runtime = 'nodejs'` in that file, and the config
  loader's `node:fs`/`node:path` imports fail that Edge bundle (`UnhandledSchemeError`).
  `next.config.ts` is only ever executed directly by the Next.js CLI in plain Node — never
  bundled — so it has none of that risk, and it fails faster (before any compilation starts).
- `src/middleware.ts` runs on the **Node.js runtime** (`export const config = { runtime:
'nodejs' }`), stable since Next.js 15.5. It doesn't currently read `bde.config.yml` (locale
  routing default is hardcoded to `"fr"` for simplicity — `bde.defaultLocale` is validated but
  not yet wired into routing), but the Node runtime is there if that changes.

## Notifications & storage (infrastructure only, not wired up yet)

- `src/lib/notifications/`: `NotificationAdapter` interface, adapters for email (nodemailer/SMTP),
  Discord webhook, Slack webhook, and a no-op `none`. `notify(event, message)` picks the adapter
  from the channel configured per event in `bde.config.yml`'s `notifications` section. **No
  caller exists yet** — wire it up when a real workflow (member approval, an event, etc.) needs
  to notify someone.
- `src/lib/storage/`: `StorageAdapter` interface, only a local-disk implementation
  (`storage/uploads/`, served through `/api/files/[...key]` rather than `/public` so a future
  access-control check can sit in front of it). `getStorageAdapter()` is the single factory
  function to change when an S3 adapter is added.

## Conventions

- **Conventional Commits**, atomic commits per logical change.
- **No `any`** (`@typescript-eslint/no-explicit-any` is an error, not a warning).
- Cross-platform: no `&&`/`||`/`$VAR`/`rm -rf`/`cp` in npm scripts — use `cross-env`, `rimraf`,
  or plain Node (see `scripts/db-backup.mjs`, `db-restore.mjs`). LF line endings are enforced by
  `.gitattributes`.
- All user-facing strings go through next-intl (`messages/fr.json` + `en.json`) — no hardcoded
  UI text in components.
- shadcn/ui components in `src/components/ui/` are excluded from ESLint/Prettier (generated
  code) — don't hand-edit; re-run `npx shadcn add <component>` instead.
- Run `npm run lint`, `npm run typecheck`, `npm run format`, and `npm run test` before
  considering a change done; `npm run build` is the closest thing to a full integration check
  since most pages are `force-dynamic` and won't otherwise get exercised by `next dev` alone.
