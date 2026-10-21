# Architecture and conventions

Reference document for working on BDE_Network: how the project is organised, the rules that hold it
together and the pitfalls already met. Read it before making structural changes. The contributor
guide (`docs/en/contributing.md`, in French `docs/fr/contributing.md`) covers setting up a development environment.

## Context

BDE_Network is an open-source, self-hosted management platform for Bureaux Des Étudiants (BDE) —
student associations at 42 network schools. Each BDE forks this repo and deploys its own
mono-tenant instance (their own database, their own `bde.config.yml`, their own OAuth app).

The repo is public and will be read by developers outside the project — code quality,
consistency, and absence of dead/half-finished code matter more than usual. The people
_using_ the deployed app (BDE members) are not necessarily technical — the UI must stay simple.

## Stack

- **Next.js 16** (App Router, `src/` directory), **TypeScript strict**, no `any`. Pinned to an **exact** version, with
  `eslint-config-next`. **Why 16 and not 15.5**: Next.js 15.5 ships a React from August 2025 with a hydration bug that made
  about one page load in seven raise errors on a slow connection (see "A hydration error on a slow connection"); the React of
  Next.js 16 carries the fix, and 15.5 will not get it. The **bundler stays webpack** (`next build --webpack`, `next dev
--webpack`): Turbopack is the default of 16 and builds this application, but it traces the whole project for the few
  dynamic file reads (`bde.config.yml`, the uploads folder) and nothing here needs it; switching is a decision of its own.
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

```text
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
        settings/              page + actions.ts + loading.tsx: the platform's settings, OWNER-only (see "Settings in the database")
        events/                events module (404 unless enabled): page, new/, [id]/, [id]/edit/,
                               review/ (the proposals to validate: events.validate), shared-calendar/ (events.shared_calendar:
                               BDE link), actions.ts (server actions), loading.tsx for each route
        profile/                page + actions.ts: account info, personal calendar feed link
    api/
      auth/[...nextauth]/route.ts
      me/export/route.ts                 self-service RGPD data export
      logo/route.ts                      the logo the BDE uploaded (public, an image checked by its bytes)
      calendar/[token]/route.ts          personal .ics subscription feed (token-authenticated)
      calendar/bde/[token]/route.ts      BDE-wide .ics feed (token-authenticated, confirmed events only)
      events/[id]/ics/route.ts           "add to my calendar" download (session-authenticated)
      health/route.ts                    liveness + database check (Docker HEALTHCHECK, unavailable page)
  instrumentation.ts       startup checks (bde.config.yml + .env), then the events reminder scheduler (Node runtime only)
  components/
    ui/                    shadcn/ui primitives — do not hand-edit, regenerate via shadcn CLI
                           (`dialog.tsx` was written by hand in the same style: the CLI would overwrite
                           button.tsx and add a stray dependency)
    confirm-dialog.tsx     the one confirmation for destructive actions (see "Design system")
    layout/                app-shell (sidebar + mobile drawer), footer, user-menu
    events/                calendar, list, form, toolbar, category badge (module UI)
    roles/                 role form (permission checkboxes), list actions, permission groups for the form
    members/               role menu, approve/refuse and remove controls of the members panel
    settings/              the settings page: panels (the installer's forms in "section" mode), owners, 42 refusal alert
    theme-provider.tsx, theme-toggle.tsx, locale-switcher.tsx (FR/EN, in the menu and on the public pages)
  config/                  bde.config.yml loader + Zod schema (src/config/index.ts, schema.ts)
  i18n/                    next-intl routing/request config; `navigation.ts` is what code imports (`Link` is ours, `link.tsx`,
                           see "Navigation"; the rest comes from `intl-navigation.ts`)
  lib/
    auth/                  NextAuth config + 42 OAuth provider
    notifications/         NotificationAdapter + email/discord/slack/none adapters
    events/                events module domain: time, repeat rules (`repeat*.ts`, see "Repeat rules"), recurrence, series (dates of their own), series-operations
                           (cutting a series), ics, access, review (the rules of the proposal circuit), queries, actions
                           helpers, notifications, reminders, scheduler (see "Events module")
    permissions/           registry (the list of permissions) + resolution and `can()`
    roles/                 escalation rules (guards), input validation, transactional operations, `execute`
    settings/              the platform's settings in the database: runtime cache, sealing (AES-GCM), store + import,
                           `update.ts` (changing them from the settings page), owners, access (OWNER-only)
    roles/view.ts          what pages need to show the right choices (actor from a session, role facts) — display only
    branding/              the uploaded logo: what is accepted (image.ts), where it lives (storage.ts)
    public-address.ts      the platform's public address, in one place (see "The public address")
    audit-log.ts, account-label.ts, health.ts, prisma.ts, color.ts, utils.ts
  types/next-auth.d.ts     Session/User/JWT module augmentation
  test/                    session fixtures, in-memory roles database, migration tests
  proxy.ts                  next-intl locale routing and the installer gate, Node.js runtime (called `middleware.ts` before Next.js 16)
prisma/
  schema.prisma, seed.ts (+ seed-events.ts), migrations/ (20261005180000_custom_roles converts the old roles)
scripts/
  backup.sh, restore.sh     POSIX sh, need only Docker on the server (no Node): one tar.gz with the database dump
  audit-prod.mjs            CI gate on production dependency advisories (+ audit-allowlist.json)
  release.mjs               what a release is made of (tag = package.json = compose default = CHANGELOG)
docker-compose.yml          the published image of one version; docker-compose.build.yml builds it from the folder instead
e2e/                        browser tests run by CI against the real image (installer, settings page, sign-in) + a stand-in 42 API
qa/                         the quality campaign: personas, dataset, invariants, the platform script, and the suites built on them
                            (see "Quality campaign")
docker/
  prisma.config.mjs         Prisma config used by the production image to run `migrate deploy`
  master-secrets.mjs        the keys of the `secrets` volume (session secret, settings key), created once
  start.mjs                 the image's command: migrations, then the application, and the explanation page
                            when either cannot start (see "A startup problem is shown, not looped")
  startup-problems.mjs      its pure parts: Prisma failure classifier, redaction, database address, the page
  safe-update.mjs           the pure rules of a safe update (stack contract, migrations plan, copies and retention)
  database-tools.mjs        what it does to the database with psql and pg_dump: inspect, copy, put back, prune
messages/
  fr.json, en.json          next-intl message catalogs
docs/en/, docs/fr/           the documentation, the SAME files in both languages (README = index by reader, glossary, faq,
                             troubleshooting, installation, deployment, upgrading, configuration, user-guide, roles,
                             events, notifications, contributing); docs/architecture.md and docs/design.md = the technical
                             references, English only; images/{en,fr}/ = screenshots (WebP); slack-app-manifest.yml
README.md / README.fr.md     the storefront, in English and French: keep them in step, promise nothing that does not exist
CONTRIBUTING*.md, CODE_OF_CONDUCT*.md   English at the root, `.fr.md` for French; SECURITY.md is bilingual in one page
SECURITY.md                  private vulnerability reporting; .github/ has issue forms and the PR template
```

## Data model (Prisma)

`User`, `UserStatus` (enum), `Role`, `AuditLog`, `PlatformSettings` (see "Settings in the database"), plus the events module's `Event`,
`EventAssignee`, `EventCancellation`, `EventOccurrence` (+ `EventOccurrenceAssignee`), `EventReminder`,
`BdeCalendarFeed` (see "Events module"). Finances and
meetings do not exist yet.

- **`UserStatus`**: `OWNER | MEMBER | PENDING`. OWNER comes only from the list of owners in the platform's
  settings (`auth.owners`; edited by an OWNER on the settings page, never from the members or roles pages) and holds every
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
- **`signIn` callback** (`signInCallback` in `src/lib/auth/callbacks.ts`, wired in `index.ts`): rejects if the user's primary 42 campus isn't
  in `bde.config.yml`'s `auth.allowedCampuses`. Otherwise upserts the `User` row: status becomes
  `OWNER` if the login is in `auth.owners`, `PENDING` on first login otherwise. An existing owner
  who is no longer listed becomes a `MEMBER` with the **default role** (`src/lib/auth/account.ts`; no default
  role: `PENDING`) on next login — the list of owners in the settings is the source of truth for `OWNER`, checked every
  login, and settable only by an OWNER on the settings page (never through a role or the members page). The accounts
  follow the list at once, not at the next login (`syncOwnerAccounts`, in the same transaction as the change; at start-up
  `reconcileOwnerAccounts` does the same for a list changed through the files).
- **`jwt` and `session` callbacks** (`src/lib/auth/callbacks.ts`) re-read the `User` row **and its role** from
  the DB on every call (not just at login) and resolve the permissions into the session
  (`session.user.status / roleId / roleName / permissions / holdsAll`, built by `lib/auth/access.ts`). Role
  changes made by an admin take effect on the affected user's very next request, without them needing to log
  out — worth the extra query for a small BDE app. The same lookup is what signs out a **removed member**: their
  row is gone but the JWT stays valid for 30 days, so `jwt` returns `null` (Auth.js then clears the cookie and
  `auth()` resolves to null) and `session` throws rather than return a user without id/status (or a member
  without a role, which the database refuses to store).
- **The public address** (`src/lib/public-address.ts`, **non-negotiable**). Everything the platform sends out is built from
  the address registered in the settings (`APP_URL`): the `redirect_uri` given to 42 on the way out **and** on the way
  back, Auth.js's redirects (the error page), the links of notifications and cards, the feed links. Never from what the
  server believes its address is. In the production image the server listens on `0.0.0.0` and Next.js builds every
  `request.url` from that (`http://0.0.0.0:3000/api/auth/callback/42-school` while the browser asked for
  `localhost:3000`): Auth.js made its `redirect_uri` from that URL, so 42 answered `invalid_grant` ("does not match the
  redirection URI used in the authorization request") and the visitor was sent to `0.0.0.0`. Reproduced against the real
  image, fixed in two places that must stay together: the NextAuth config function sets `AUTH_URL` from
  `registeredAddress()` (read by `signIn()` and `auth()` through `createActionURL`, and by `reqWithEnvURL` for the
  handlers), and the route handlers (`api/auth/[...nextauth]/route.ts`) rewrite the request to `publicOrigin()` first
  (`auth/public-request.ts`) — which is also the fallback when no address is registered: the forwarded host / `Host` of
  the request, **`0.0.0.0` becoming `localhost`**. `registeredAddress()` returns an origin, or null when the value is not
  http(s) or is an unspecified host (an older installation may have saved `0.0.0.0`: it is ignored, and a start-up warning
  says so, rather than locking the sign-in). `isUnspecifiedHost` (`0.x.x.x`, `::`) is refused by `validateAddress` (the
  installer and the settings page: code `addressUnspecified`) and by the `.env` rescue. **`127.0.0.1` / `::1` are written
  `localhost`** (`canonicalHost`, in `validateAddress` and `registeredAddress`): Next.js's `NextURL` rewrites them to
  `localhost` in every URL it builds, so an address saved as `127.0.0.1` gave `127.0.0.1` on the way out and `localhost`
  on the way back. A new place that needs the platform's URL calls `registeredAddress()` / `publicOrigin(headers)`; it does
  not read `APP_URL`, `request.url` or `Host` itself. Tests: `auth/public-address-signin.test.ts` (a server listening on
  `0.0.0.0` that builds `request.url` like Next, the real handlers and config, a 42 that refuses a code whose
  `redirect_uri` differs from the authorization's; mutation-checked: without the rewrite or `AUTH_URL` it receives
  `http://0.0.0.0:<port>/…`), `public-address.test.ts`, and `e2e/signin.mjs` in CI (the whole sign-in in a browser, the
  stand-in 42 playing `/oauth/authorize`, `/oauth/token`, `/v2/me`).
- **The session is resolved once per request.** `getEffectiveSession` is wrapped in `React.cache`: the
  layout, the page and every access check of one render share one resolution, instead of replaying the
  `jwt` + `session` callbacks (3 SQL queries) each time — a page went from 13 statements to 7. It is
  per request, never shared, so a removal or role change still shows on the next request. A page that
  shows only the signed-in person's own data (dashboard, profile) calls `requireApprovedSession()`
  (`lib/auth/require-session.ts`) itself instead of trusting the layout. The `signIn` callback tolerates two
  simultaneous first sign-ins (the loser of the `P2002` race carries on as a return visit) and the
  e-mail is **not unique**: the login is the identity.
- **Fail closed on identity.** `getEffectiveSession` returns null unless the session carries an id, a login, a
  known status, resolved permissions and (for a member) a role; `isApproved` is an allow-list
  (`APPROVED_STATUSES`), never `!== 'PENDING'`; `can()` is false for anything missing or unknown; and any query
  keyed on a user id must never see `undefined` — **Prisma drops a filter whose value is `undefined`**, so
  `where: { userId }` returns every row. Guard the id before the query (`requireUserId` in
  `events/export.ts`). The regression test is `src/lib/auth/removed-account.test.ts` (real NextAuth config +
  forged cookie; its fake database reproduces Prisma's `undefined` behaviour).

- **What Auth.js logs** (`src/lib/auth/logger.ts`). A request refused because of what the visitor sent (a cookie that cannot be
  read, a missing CSRF token, an unreadable callback address or state, an unknown action: `REFUSED_REQUEST_ERRORS`) is
  a one-line warning with no trace and no echo of the value; every other error keeps Auth.js's complete report. A new
  kind of refusal that floods the logs is added to that list; an error that matters never is. The attacks of the quality
  campaign read the logs at the end (`qa/security/logs.ts`).
- **Route guards live in Server Components**, not middleware (`(app)/layout.tsx` redirects
  unauthenticated users to `/`, `PENDING` users to `/pending`; `members/page.tsx` and
  `roles/`, `audit-log/page.tsx` and `settings/` additionally check `can(user, 'members.manage' | 'roles.manage')` /
  `canViewAuditLog` / `canManageSettings`). Every
  session/DB-backed route has `export const dynamic = 'force-dynamic'` — verify this stays true
  when adding new authenticated pages, otherwise Next's static optimization could theoretically
  cache one user's render for another (checked against the prerender manifest when this was
  built: none of these routes were actually being prerendered despite the build output's
  misleading `●` SSG marker, but the explicit export makes it a guarantee, not an accident).
- **Permissions** (`src/lib/permissions/`): the list lives in code (`registry.ts`): core `members.manage`,
  `roles.manage`, plus `<module>.view` / `<module>.manage` for **every enabled module** (managing implies
  viewing) and the extras a module declares in `MODULE_EXTRA_PERMISSIONS`, each with what it implies (an implication
  is not followed transitively: list everything). The events module is the one that has **no `manage`**
  (`MODULES_WITHOUT_MANAGE`): it has `events.propose` (implies view), `events.validate` (implies propose and view) and
  `events.shared_calendar` (see "The proposal circuit"). Check
  with `can(session.user, key)`; server actions and pages re-check themselves — never rely solely on a hidden
  button. The audit log and the settings are **not** permissions: `canViewAuditLog` and `canManageSettings` are OWNER-only
  (a permission a role could hold would let its holder make themselves an owner). Always build on
  `getEffectiveSession`, never `auth()` directly. A module's pages/actions get their access through one
  function (for events: `getEventsAccess` / `requireEventsProposer` / `requireEventsValidator` in
  `src/lib/events/access.ts`) that returns null when the module is disabled — pages treat null as `notFound()`,
  actions throw `Forbidden`.
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

## Settings in the database (`src/lib/settings/`)

What used to be two files read at start-up, `bde.config.yml` and `.env`, lives in the database once the platform
has started once: one `PlatformSettings` row (id `platform`; its existence means "installed"). The aim is that
nobody opens a configuration file, and that a setting changes with no rebuild and no restart.

- **Row** : `config` (what `bde.config.yml` held, validated by `src/config/schema.ts` on every load),
  `environment` (the non-secret former `.env` values: `APP_URL`, `FORTYTWO_CLIENT_ID`, `SMTP_HOST/PORT/USER/FROM`),
  `secrets` (a sealed text: `FORTYTWO_CLIENT_SECRET`, `SMTP_PASSWORD`, `DISCORD_WEBHOOK_URL`,
  `SLACK_WEBHOOK_URL`), `source`. The managed keys are listed once, in `settings/runtime.ts` (`SETTING_KEYS`,
  `SECRET_SETTING_KEYS`): a new setting is added there and nowhere else.
- **Sealing** (`crypto.ts`): AES-256-GCM, a random IV each time, the format versioned (`v1.<iv>.<tag>.<data>`) and
  authenticated. The key is **not in the database**: `docker/master-secrets.mjs` creates it once in the `secrets`
  volume and the supervisor hands it to the server as `SETTINGS_KEY` (without it, `npm run dev` and the tests,
  it is derived from `AUTH_SECRET` with HKDF). A database dump alone gives no secret away.
- **Runtime cache** (`runtime.ts`): the settings are loaded into memory when the server starts (`instrumentation.ts`
  → `initializePlatform`) and `getConfig()` / `setting(KEY)` read it, so the 35 readers of the configuration stay
  synchronous. It sits on `globalThis` (Next.js bundles the instrumentation hook and the pages separately: a module
  variable would exist twice). Until something is loaded, every reader falls back on the files and `process.env`,
  exactly as before (`npm run dev`, the tests, an installation not imported yet). **Never read one of the managed
  variables from `process.env` directly: use `setting()`.** Once the database is the source, a stale variable of `.env`
  is ignored on purpose.
- **NextAuth's configuration is a function** (`NextAuth(() => ({ ... }))`, supported by the version we pin): the 42
  application's identifier and secret are read for each request, so they can change while the server runs.
- **Existing installations are imported, once.** At the first start after the update, when there is no row,
  `bde.config.yml` and `.env` are read for the last time: when they are complete (a real owner in place of the
  template's `votre-login-42`, and `.env` passing `validateEnvironment`), they are copied into the row (secrets
  sealed) and the platform is installed; otherwise it runs from the files as before and the start-up checks say
  what is wrong. `BDE_REIMPORT=1` replaces the row by the files again at every start while it is set (for
  deployments driven by files, and to change a setting by hand until the Settings page); incomplete files are
  ignored and the database kept. A concurrent first start is safe (the loser of the unique violation loads the
  winner's row).
- **Losing the `secrets` volume** is survivable by design: the row's non-secret part still loads; the sealed part
  cannot be opened, so the secrets of `.env` (if it is still there) are sealed again with the new key, or are missing
  and the checks name them. Backups therefore save the volume's keys apart (`scripts/backup.sh` writes
  `bde-secrets-*.tar.gz`, `restore.sh --secrets` puts them back; the postgres password is deliberately not in it:
  it only serves to create the cluster, a dump restores into any password).
- **Why a volume and not a file of the project folder**: a named volume belongs to the Docker daemon, so it behaves
  the same on Windows, macOS, Linux and with rootless Docker, where a mounted file was not reliable (see "The
  configuration is baked into the image").

### The settings page (`src/app/[locale]/(app)/settings/`, `src/lib/settings/update.ts`)

OWNER-only (`canManageSettings`; a role simulated in development counts for what it simulates), and read only
while the settings are still in the files (`isSettingsEditable`: no runtime cache, nothing to write to). It reuses the
installer: the same step components (`components/setup/*`) in **"section" mode** (`FrameModeContext`: their own Save
button, nothing takes the focus), the same validators (`lib/setup/validate.ts`, `notifications.ts`, `fortytwo.ts`,
`notify-test.ts`), one copy of each. The forms call an `api` object (`StepApi`) that is the installer's actions on
`/setup` and the settings actions here; both answer `ActionResult` with the same codes (`setup.errors.<code>`).

- **One section, one save, one transaction.** `updateSettings(change, actor)` takes a `SettingsChange` (identity,
  address, oauth, campuses, owner-add, owner-remove, modules, notifications), reads the row **again inside the
  transaction**, applies the change, re-validates the whole result with the Zod schema and `validateEnvironment` (what
  is written always starts), writes only if nobody changed the row meanwhile (`updatedAt` compare-and-set, 3 tries, then
  `conflict`), writes the **audit entry in the same transaction** and only then loads the new settings into the runtime
  cache (`setRuntimeSettings`): `getConfig()` and `setting()` answer the new values for the next request. Nothing to
  restart or rebuild. A change that changes nothing writes nothing (`changed: false`).
- **Every action is an entry point**: `requireSettingsManager()` first (throws `Forbidden` for a crafted request), the
  input parsed again with Zod, validation again in `updateSettings`. A refused change is a code, never a throw.
- **Secrets never go back to the browser, nor to a log or the audit log.** The page gets `settingsView()` (only
  `hasClientSecret`, `hasDiscordWebhook`...); a blank secret field keeps the saved one; the audit metadata says
  `secretChanged` / `changedSecrets: [names]`, never a value.
- **The 42 application is asked to 42 before it is saved** (`verifyFortyTwo`): a wrong pair would lock everybody out.
  Only when 42 cannot be reached can the owner save without the check (`skipFortyTwoVerification`). The campus list and
  the owners' logins are checked with a token of the saved application (`fortytwo-token.ts`, cached, forgotten when the
  credentials change).
- **Owners.** `addOwner` re-checks the login on the intra (a login 42 does not know is refused; a 42 that cannot answer
  needs an explicit `acceptUnverified`); adding and removing both go through a `ConfirmDialog`. The rules are in
  `updateSettings` and tested there: **never oneself** (`ownerSelf`), **never zero** (`noOwner`), no duplicate, at most 30.
  The accounts follow in the same transaction (`syncOwnerAccounts`: listed becomes OWNER, no longer listed becomes a member
  with the default role); the audit entry records who was promoted or demoted.
- **Logo, events, contact address.** The logo (`saveLogo` takes a `FormData`, so the 3 MB `serverActions.bodySizeLimit` of
  `next.config.ts` applies to every action): the size is refused before the file is read, the bytes are checked and
  stored, **then** the settings point to them, and only after that are the older files removed (a failed save leaves
  the previous logo working). The events section (`section: 'events'`): categories are renamed and recoloured freely
  and a new one gets a key made from its name (`categoryKeyFor`, unique, never changed afterwards: events refer to
  it); taking one out while events use it **needs a category to move them to** (`reassign`), and the move happens in
  the same transaction as the settings write, which the audit entry counts (`removed: [{ label, events, movedTo }]`);
  at least one category stays; the hour of the reminder is read on every tick, so it is immediate. The contact address
  (identity section, also asked by the installer) is optional and blank removes it.
- **Effect on running parts.** NextAuth reads the 42 identifiers for each request (function config), so a new secret
  applies to the next sign-in. The reminder scheduler is started when the events module is turned on and **stopped**
  (`stopEventReminderScheduler`) when it is turned off. A change of name, colour or modules is shown by
  `revalidatePath('/', 'layout')`.
- **If 42 refuses the application** (`oauth-check.ts`), the login page says to warn an owner, and an owner who still has
  a session sees an alert with a link to the settings on the dashboard (`OAuthRejectedAlert`) and on the page itself. A
  visitor is never told more than that (the login page cannot know who is an owner). When nobody can sign in at all,
  `BDE_REIMPORT=settings` copies the values of `.env` (and nothing else) into the settings at the next start. It is also
  **the rescue for a wrong address** (`APP_URL=…` + `BDE_REIMPORT=settings`, documented in `docs/en/troubleshooting.md`, `docs/fr/troubleshooting.md`): the
  address is run through `validateAddress` first (so it is written like the installer writes it, and `0.0.0.0` is
  refused), and the log says `ancienne → nouvelle`. There is deliberately no second mechanism.
- **The page always reminds to back up the `secrets` volume** (the key is not in the database), with the command, and
  says so loudly when the secrets were found unreadable (`secretsStatus` of the runtime cache: `lost`, `resealed`).
- **Tests**: `update.test.ts` (every section, the owner rules, the concurrent save, no secret in the audit), `actions.test.ts`
  (every action refused unless OWNER, read-only mode), `page.test.tsx`, `settings-ui.test.tsx`, `scheduler.test.ts`, and
  `e2e/settings.mjs` (a real browser against the real image, run by CI after the installer: logo upload and removal, categories, language switch, contact address). The access tests were
  mutation-checked: re-break a guard (`canManageSettings`, `requireSettingsManager`, an action's first line) and one fails.

## The web installer (`src/lib/setup/`, `src/app/[locale]/setup/`, `src/components/setup/`)

A platform with nothing decided (no `PlatformSettings` row and `bde.config.yml` is the unfilled template, the
`votre-login-42` owner) is installed from the browser: `initializePlatform` answers `{ source: 'setup' }`,
`instrumentation.ts` calls `enterSetupMode` and returns **without running the start-up checks, the 42 warning or the
reminder scheduler** (none of them can pass on a platform that has no configuration). A platform whose files are
filled (an installation that predates the database, or a deployment driven by files) is imported instead and never
sees the installer.

- **The only installation path.** A terminal questionnaire (`setup/`, run through its own Docker image and writing
  `.env` and `bde.config.yml`) existed before the installer and was removed with it in place: two ways to do the same
  thing meant two sets of questions, messages and tests to keep equal, and the files it wrote are no longer where the
  settings live. The quick start of the READMEs and `docs/en/installation.md` describe only `docker compose up` (without
  `-d` the first time, to see the box with the code in the terminal or in the Logs tab of Docker Desktop), then
  `docker compose up -d`. Do not bring a second installer back: extend the one in `src/lib/setup/`, which the settings
  page shares.
- **Protection** (`guard.ts`, all of it on `globalThis`, like the runtime settings). A code of 8 characters from a
  31-letter alphabet without look-alikes (`K7QM-4XPD`), made at every start and kept in memory only, written to the logs
  in a box (`mode.ts`; `BDE_HOST_PORT`, passed by compose from `APP_PORT`, is only there to print the right address).
  5 wrong tries lock the entry for 30 s, doubling to 15 min (never a guess, only a delay; a restart gives a new code
  and clears the lock). The right code gives a session: 256 random bits in an `HttpOnly`, `SameSite=Strict` cookie (`Secure`
  behind an HTTPS proxy), 2 h, of which the server keeps only the SHA-256. At most 20 sessions.
- **Nothing is served but the installer** (`src/proxy.ts`, Node.js runtime): every page redirects to
  `/<locale>/setup`, every API route answers 503 `not-installed`, except `/api/health`. The state is read from
  `globalThis`, which the proxy shares with the server. **Two traps met while building it**: the `matcher` is a
  regular expression compiled by Next, and a lost backslash (`.*..*` for `.*\..*`) made the proxy see only `/`
  (`proxy.test.ts` checks which paths it sees); and a redirect built from a relative `Location`, or from
  `request.url` (the container's own host name behind Docker), is refused or wrong, so it is cloned from
  `request.nextUrl`, which carries the host the visitor used.
- **The address step never proposes nor accepts `0.0.0.0`** (see "The public address"): the proposal is
  `originOfRequest(headers)` (a browser on `0.0.0.0` gets `localhost`), `validateAddress` refuses it, and the screen
  **warns, without blocking**, when the address typed is not the one of the browser (`addressNotice`, compared with
  `window.location.origin` after hydration: 42 sends the visitor back to the saved address, and the sign-in cookies belong to
  the address it started from, so another name or port cannot succeed). The same component serves the settings page.
- **Server actions** (`actions.ts`, one per step). Every one answers 404 once installed (`isSetupMode`), `session` without
  the installer cookie, re-validates its input with Zod and the validators of `validate.ts` (the browser is not
  trusted), and keeps the answer in the server's memory (`draft.ts`: per session, lost on restart, which also changes the
  code). **A `'use server'` file may only export async functions, and each export is a public entry point**: the
  helpers (`session.ts`) live outside. What goes back to the browser is a **code** of what is wrong (translated by the
  page: `setup.errors.<code>`, a test checks every code the actions can answer has a sentence in both languages) or a
  `DraftView` (`toView`): no secret, only whether there is one. The 42 secret travels in the body of the token request
  only; the token of the application stays server side to list the campuses and check the logins.
- **Finishing** (`finishInstallation`): `buildInstallation` assembles the configuration and the settings from the draft
  and checks them with the schema and `validateEnvironment` the platform applies at start-up (so what is written always
  starts), `installPlatform` creates the row (`source: 'installer'`, unique id: two people finishing at once, the loser
  gets a 404) and loads it into the runtime cache, then the code, the sessions and the drafts are forgotten and the reminder
  scheduler starts. The action **does not touch a cookie**: that would make Next reload the page, which no longer
  exists, before the last screen is read. From then on `/setup` is a 404 for good; there is no way to reopen it.
- **The 42 client** (`fortytwo.ts`): the credentials are checked with the client-credentials grant, the campuses listed
  (paged, 600 ms apart, a 429 waited out), a login looked up; 8 s timeouts; every failure is a code
  (`invalidCredentials`, `rateLimited`, `network`) and the person may go on without the check (campuses typed by hand).
  `FORTYTWO_API_URL` replaces the address of the API for the end-to-end tests (`fortyTwoApiBase`, used by the installer's
  checks and by the sign-in provider: `e2e/signin.mjs` plays a whole sign-in). It is never set in a real installation.
- **Tests**: unit tests for each piece, the real French messages in `setup-ui.test.tsx`, and `e2e/install.mjs`, run
  by CI against the real image: a browser (`puppeteer-core` driving the installed Chrome) goes through every step with
  `e2e/mock-fortytwo.mjs` standing in for the 42 API, then checks the installer is a 404 and no secret was in a page, a
  log or the database in clear.

## Configuration: bde.config.yml vs .env

- **`bde.config.yml`** is _versioned_ (committed) — each BDE's fork edits it directly, no
  secrets in it. Validated with Zod (`src/config/schema.ts`) on every load, cached after first
  read (`src/config/index.ts`). `bde.config.example.yml` is the annotated reference copy.
  An optional git-ignored `bde.config.local.yml` replaces it when present (full file, no merge) so
  personal values stay out of commits — see `docs/en/configuration.md`.
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
- `src/proxy.ts` (`middleware.ts` until Next.js 16, which renamed the file convention) runs on the **Node.js
  runtime**, the only one a proxy has. It doesn't read `bde.config.yml`: the interface
  language comes from the URL (`/fr`, `/en`; the default `"fr"` is hardcoded in `i18n/routing.ts`, which
  client code imports and so cannot read the config). `bde.defaultLocale` is **the language of outgoing
  notifications**, nothing else — wiring it into routing was judged not worth a config read in the
  proxy for a visitor whose browser language is neither French nor English.

## Notifications

- `src/lib/notifications/`: `NotificationAdapter` interface, adapters for email (nodemailer/SMTP),
  Discord webhook, Slack webhook, and a no-op `none`. `notify(event, message)` picks the adapter
  from the channel configured per event in `bde.config.yml`'s `notifications` section. The events
  module sends `eventConfirmed` / `eventReminder` and, for the proposal circuit, `eventProposed` / `eventApproved` /
  `eventRefused`; `src/lib/members/notifications.ts` sends
  `memberPending` (new account created in the `signIn` callback → owners and holders of
  `members.manage` by email, or the chat channel), `memberApproved` (email goes to the member, chat
  gets a team message) and `memberRemoved` (**chat only, never an email to the removed member**: the
  `email` channel sends nothing). Notification keys added after the first release must default to
  `"none"` in the Zod schema so old configs keep validating. Callers must treat notification as
  best-effort: run it in `after()`, never let it throw into the action that triggered it. The shared
  `deliver()` (`src/lib/notifications/deliver.ts`) sends an email batch over **one SMTP connection**
  (`notifyMany` → `EmailAdapter.sendMany`), isolates failures per recipient and only logs; text builders are pure (`members/messages.ts`, `events/messages.ts`) and use
  `getNotificationTranslate`. **Texts sent to Discord/Slack are neutralized in the adapters**
  (`sanitize.ts`: `@everyone`/`@here`/`@channel`, `<!channel>`, `<@id>`, Slack `<url|text>`; Discord
  also sends `allowed_mentions: { parse: [] }`) — every caller gets it, a new adapter must do the same.
  A member-notification channel that is not set up in `.env` is a **startup warning, not an error**
  (`env.ts`): those keys sat in every config before they sent anything.
- **Discord cards** (`docs/en/notifications.md`). On the `discord` channel a notification is an _embed_, built
  next to what it says (`events/discord-embed.ts`, `members/discord-embed.ts`) on the Discord-specific parts
  in `notifications/discord-embed.ts` (colours, `<t:…>` date markup, `fitEmbed` = every limit of Discord:
  256/4096/1024/25 fields/6000 in total, cut with “…”). **One layout for every card**: the essentials are large
  headings in the description (`-# KIND` in capitals, `### 📅 when`, `### 📍 where`, the text as a `>` quote, a
  zero-width-space line between blocks: a truly empty line is collapsed, and `fitEmbed` keeps a field made of it),
  the secondary facts are small inline fields with an icon, and the title carries the icon of the kind. The helpers
  are `kindLine` / `headingLine` / `quoteBlock` / `oneLine` / `BLANK_LINE` (`notifications/discord-embed.ts`):
  **anything a member typed that lands in a heading goes through `oneLine`** (a place or a login must not open a
  second heading), a quote keeps every line (a blank one as `> ​`). `withDiscordCard` signs the card (`signCard`: the
  BDE's name and logo as `author`, its logo as the thumbnail of a card without a picture of its own — an event; a member
  keeps their 42 photo — and neither logo when Discord cannot fetch it); a new card follows this layout and leaves the
  signature to it. `withDiscordCard` (`discord-card.ts`) adds the card to
  a message **only when the event's channel is Discord** — email and Slack never build one and keep their
  plain `subject`/`body`, which Discord also falls back to. The adapter neutralizes **every text of the card**
  (`neutralizeEmbedForDiscord`) and always sends `allowed_mentions: { parse: [] }`. The sender (`sender.ts`)
  is `bde.name` + an avatar Discord must be able to fetch: `bde.logoPath` if it is a PNG/JPEG/GIF/WebP, else
  `public/logo.png`, only when `APP_URL` is a public address (not localhost / a private range) **and** a HEAD
  request shows an image (cached 10 min); otherwise name only, never a broken picture. A new notification
  that should be a card gets a builder + a `withDiscordCard` call; who did an action is passed by the action
  (`ctx.actor.login`), the row being deleted before the message goes out.
- **Slack cards** (`docs/en/notifications.md`, Block Kit). Built like the Discord ones (`events/slack-blocks.ts`,
  `members/slack-blocks.ts`, the shared parts in `notifications/slack-blocks.ts`) and chosen with the others by
  `withRichMessage` (`notifications/rich.ts`: only the builder of the event's channel is ever called). **The
  message is `{ attachments: [{ color, fallback, blocks }] }` and has no top-level `text`**: Slack shows a message's
  `text` in the channel above the card, which would say everything twice; the summary for push notifications is
  the attachment's `fallback` (a test forbids a top-level `text`). A member's text in a `mrkdwn` field goes through
  `neutralizeForSlack` (cut first, then escaped, never mid-entity); the platform's own `<!date^…>` markup is added
  after, and `fitSlackPayload` — applied by the adapter to whatever a caller built — lets nothing through but that
  strict markup (every other `<…>` becomes text), cuts to Slack's limits, drops blocks Slack refuses. The app
  that posts is the BDE_Network Slack app created from `docs/slack-app-manifest.yml` (a test ties the docs link to it):
  name and icon are the app's, a webhook cannot change them per message.
- **Designed e-mails** (`docs/en/notifications.md`). On the `email` channel a notification carries an
  `EmailContent` (`html` + `text` + optional `.ics`) next to its plain `subject`/`body`: built by
  `events/email.ts` / `members/email.ts` from the one layout `notifications/email-layout.ts` (`renderEmail`, a
  pure function of a model) and added by `withEmailContent` **only when the event's channel is e-mail**. The
  layout is for the worst clients, not browsers: tables, inline styles, `bgcolor`, a VML button for desktop
  Outlook, a hidden preheader, a `<style>` only for dark mode / narrow screens. **Everything inserted goes
  through `escapeHtml` / `httpUrl` / `normalizeHex` in that file** (never concatenate a member's text into the
  HTML elsewhere). The logo is `resolveLogoUrl(…, { requirePublic: false })` (a mail client loads it itself).
  A confirmation attaches the `.ics` through nodemailer's `icalEvent` (every occurrence to come, same UIDs as the
  feeds); a reminder does not. `memberRemoved` never sends an e-mail. In development `docker-compose.dev.yml`
  points `SMTP_*` at Mailpit (<http://localhost:8025>) unless `DEV_SMTP_*` say otherwise.
- **The one file the platform stores is the BDE's logo** (`src/lib/branding/`, `src/app/api/logo/route.ts`). An
  earlier local-disk adapter with a public `/api/files/[...key]` route was removed because nothing wrote to it and
  it would have been a stored XSS the day something did (no authentication, SVG served without `nosniff`). The logo
  is built the way that note asked: the format is **read from the bytes** (PNG, JPEG, GIF, WebP; never trusted from
  the name or the browser's type; **no SVG**, which can carry a script and which Discord, Slack and mail clients do
  not show), 2 MB at most, 64 to 4096 px; the file lives in the `uploads` volume (`UPLOADS_DIR`, `/uploads` in the
  image) under a name made of its SHA-256 (`logo-<16 hex>`), written to a temporary name and renamed; the route
  answers `404` for anything that is not an image **when read back**, with `nosniff` and
  `Content-Security-Policy: default-src 'none'; sandbox`, and never builds a path from the request (the version must
  match `^[a-f0-9]{16}$`). It is public on purpose (login page, Discord, Slack, mail clients). `bde.logoPath` is
  `/logo.svg` (the default) or `/api/logo?v=<version>`: a new logo is a new address, so nothing keeps showing the old
  one (see `resolveLogoUrl`, which knows that path is an image). `scripts/backup.sh` puts the file in the database
  archive (`logo.tar`: it holds nothing secret) and `restore.sh` puts it back. Anything else that needs uploads
  gets the same treatment, with its own checks: do not widen this one.

## Events module (`modules.enabled: [events]`)

User guide: `docs/en/events.md`. The shape worth knowing before touching it:

- **An event is one row, a series is one row plus what its dates have of their own.** A recurring event is a
  "series master" (`startsAt`, `endsAt`, `repeat`, `recurrenceUntil`); its dates are
  **computed**, never stored (`allOccurrences` in `src/lib/events/recurrence.ts`, which asks `repeat.ts`), on the wall clock of
  `bde.timezone` so DST doesn't shift local times. What one date has of its own is stored sparsely (see "Dates
  of a series" below): `EventOccurrence` (the fields that differ from the series), `EventCancellation` (a
  cancelled date), `EventReminder` (reminder already claimed). All instants are UTC in the database; anything
  typed or shown goes through `src/lib/events/time.ts` (Intl only, no date library) and `format.ts`.
- **Repeat rules** (`src/lib/events/repeat*.ts`; user guide: `docs/en/events.md`). A series is **a rule**, not one of four shapes.
  - **Model.** `Event.repeat` is a JSON column (`RepeatRule`, `repeat.ts`, validated by `repeatRuleSchema`, strict):
    `freq` (`DAILY | WEEKLY | MONTHLY | YEARLY`), `interval` (1 to 99), optional `weekdays`, `monthly`
    (`{ kind: 'day', day }`, `{ kind: 'lastDay' }` or `{ kind: 'nth', nth: 1..4 | -1, weekday }`) and `count`. **What a
    rule leaves out means "like the first date"** (the weekday, the day of the month, the month of a year), which is why
    moving the first date moves a series that left it out, and why `resolveRule` / `sameRepeat` always work from a first
    date. `readRepeatRule` never trusts what is stored: a value that is not a rule is an event that does not repeat, not a
    crash. The end stays in `recurrenceUntil`: the end date typed (23:59 local of that day), or, for a rule that ends
    after `count` dates, **the start of its last date** (`endOfCountedRule`, worked out from the dates themselves), so that
    the database can keep filtering on it (`queries.ts`, `reminders.ts`). The invariant is **`repeat IS NULL ⇔
recurrenceUntil IS NULL`**, a CHECK of the migration (`Event_repeat_has_an_end`) that Prisma cannot express; an event
    that repeats is recognised by `isRepeating`, never by one column alone.
  - **One engine, in a pure module** (`expandRepeat`): the calendar days of the rule (`calendarDays`) at the wall clock of
    the first date in `bde.timezone` (so the hour does not move at a change of clock), stopped by `recurrenceUntil`
    (inclusive), `count` or **`MAX_OCCURRENCES` = 400** (`truncated`: the form and the server refuse it, `planRepeat`).
    Choices that are decisions, not accidents: a day a month lacks is its last day (the 29th of February is the 28th);
    weeks start on Monday and the interval counts weeks from the one of the first date (RFC 5545 with `WKST=MO`: a Saturday
    start with "every 2 weeks on Monday and Wednesday" starts on the Monday two weeks later); a first date that does not fit
    the rule **moves to the first that does** (`alignStart`, announced by the preview); a yearly rule has one month, the
    one of the first date. Known limit: a row holds one instant for its first date, so when a series is **cut exactly on a
    date that falls in the hour a clock change skips** (02:30 the night the clocks go forward), the second row starts an
    hour later and keeps it (`repeat-cut.test.ts` pins it).
  - **The form and the server are the same code** (`repeat-input.ts`, pure, imported by both): the raw fields
    (`RawRepeat`: `repeat`, `repeatFreq`, `repeatInterval`, `repeatWeekdays`, `repeatMonthly`, `repeatMonthDay`,
    `repeatEnd`, `recurrenceUntil`, `repeatCount`), the choices of the list (`presetRule`, worded from the first date by
    `describeRepeat`; a fifth weekday offers "the last"), `presetOf` / `rawRepeatOf` (a stored rule back into the form),
    `parseRepeatInput` and `planRepeat` (the rule, the first date and the end, or the errors, each on its field). `parseEventInput`
    calls `planRepeat`, so **the first date saved can differ from the one typed**; the server runs it again, the browser is not trusted.
    The preview of `components/events/repeat-fields.tsx` (sentence, three next dates, total, "first date becomes…") is
    computed by those same functions, never by a second implementation.
  - **One sentence** (`repeat-summary.ts`, messages `events.repeat.summary.*`): the form, the page of an event, the page
    of proposals and every notification say a rule with `summarizeRepeat`, so they never say it differently
    (`NotificationEventData.repeat` is that sentence, or null). The names of days and months come from Intl; French elides
    "de" before a vowel (`elide`, picked by the message).
  - **Cutting** (`cutRule`): the first row keeps the dates before the cut, the second those from it on. What the rule left
    out is "like the first date", which is no longer the same date for the second row, so `cutRule` **writes the day of the
    month** into the second row; a series that ends after N dates **shares them** (`index` for the first row, the rest for
    the second). **The form describes the dates from the one it was opened on** (`edit/page.tsx` prefills the rest of
    the series, so a counted series says how many dates are left), and `updateFollowing` compares it with that same rest,
    never with the whole rule: otherwise "10 times" counted again from the 5th date would grow the series.
  - **Identifiers do not depend on the rule**: a UID is the series key and the date's original start, so a change of rule
    keeps the identifier of every date that stays, and a cut changes none (`series-feed.test.ts`).
  - **Migration** (`20261017100000_event_repeat_rules`): every old series becomes the rule that gives exactly its dates
    (weekly, every 2 weeks, monthly, monthly on `monthlyDay`), `monthlyDay` and the `EventRecurrence` enum are dropped.
    Tested on legacy series to the millisecond (`repeat.test.ts`: 1500 random series against the old algorithm kept in the
    test) and on a real PostgreSQL in CI (`test/migrations/event-repeat-rules.test.ts`; `e2e/safe-update.sh` looks for
    the new column in the pre-update copy).
  - **Tests, mutation-checked** (re-break a rule and one must fail): `repeat.test.ts` (cases, an oracle that looks at
    every day on 1000 random rules, DST in four zones), `repeat-cut.test.ts` (dates before + dates after = the dates of the
    series, at every cut of random series), `repeat-input.test.ts`, `input.test.ts`, `repeat-summary.test.ts` (the real
    French and English messages), `repeat-fields.test.tsx` (the form), `series-operations.test.ts`, `pages.test.tsx`, and
    `e2e/repeat.mjs` in a real browser (run by CI, and by the stress workflow).
- **Dates of a series** (`series.ts`: the pure rules; `series-operations.ts`: what they do to the database;
  `transaction.ts`: SERIALIZABLE, retried, `null` after the third try; tests `series.test.ts`,
  `series-operations.test.ts` on `test/fake-events-db.ts`, `actions-series.test.ts`, mutation-checked).
  Every action on a date of a series asks **"only this one" or "this one and the following"** in one dialog
  (`ConfirmDialog` with `choices`; the narrowest is selected first); on the first date the second is the whole
  series, and an event that does not repeat has no scope at all.
  - **The key of a date is where the series puts it** (`occurrenceStart`, the "original start", like an
    iCalendar RECURRENCE-ID), whatever the date was moved to: `?occ=`, `EventCancellation`, `EventReminder`,
    `EventOccurrence`, the UID in calendar files. A moved date has `EventOccurrence.startsAt/endsAt` (both or none:
    a CHECK the schema cannot express). `resolveOccurrences` puts a date's own values on top of the series'
    and is the one function every consumer goes through (pages, feeds, reminders, notifications).
  - **Only this one** (`updateOccurrence`): the fields that changed are written to the date's row, and a field
    that equals the series' value is not stored (a date never keeps a value that says nothing). A row with
    nothing left is deleted **unless it carries a claimed notice** (`confirmationNotifiedAt`): confirming
    again must not announce again.
  - **This one and the following** (`updateFollowing`): the series is **cut into two `Event` rows** at the
    date (the first stops at the date before, or becomes an ordinary event when one date is left; the second
    starts at the date), in one transaction that also moves the dates' rows, cancellations and reminders from
    that date on, copies the members in charge and **inherits `confirmationNotifiedAt`** (a series is announced
    once, not again because it was cut), the author and `seriesId` (the first row's id: the base of every UID,
    so the cut changes no identifier in any calendar). On the first date nothing is cut. A change that changes
    nothing (compared with the date as it is **inside the transaction**) writes and cuts nothing.
  - **What the following keep** (Google Calendar's rule): the fields the edit changed are cleared from the
    dates that had their own (`clearOverride`), the others stay; "confirm the following" is a change of the
    status field, so it also confirms the drafts (the dialog counts them: `scopeFacts`). Dates, cancellations
    and reminders are re-keyed by **local calendar day** when only the hour changed (`remapByLocalDay`, DST
    safe) and dropped when the day or the frequency changed (counted in the audit entry: `alignedDates`,
    `droppedDates`). A monthly series cut on a day a short month had moved (the 28th of a "31st") keeps its
    day: the rule of the second row says it (`cutRule`, see "Repeat rules").
  - **Deleting**: only this one stays the restorable cancellation; the following (`deleteFollowing`) stops the
    series at the date before and deletes what was stored from that date on, or the event on the first date.
  - **Audit**: every entry of an event that repeats says `scope: 'occurrence' | 'following'`, the date
    (`occurrenceStart`), `fromFirst: true` when it covered the whole series, and for a cut `splitInto`; the entry
    is written **in the same transaction** as the change (`auditEventAction(..., tx)`).
  - **A conflict is a notice, not an error**: two people cutting the same series at once is retried, then answered
    with `?notice=seriesBusy`; a date that is gone is `occurrenceGone` (`lib/events/notice.ts`).
- **Quick add from the calendar** (`lib/events/defaults.ts`, `month-calendar.tsx`, `events/new/page.tsx`; scenario "the
  form opens on that day" and the member check of `e2e/events.mjs`). A "+" in each cell (from `md` up: `hidden md:flex`,
  revealed by `[td:hover_&]` (an arbitrary variant, not `group-hover`: Tailwind wraps `hover:` in `@media (hover: hover)`, which a headless Chrome without a pointer, the CI's, does not match) and `group-focus-within/cell`, always shown under `pointer-coarse`, right after the day
  link in the tab order, named "Add an event on" plus the day) and, below `md`, an "add on this day" button in the panel of the
  selected day (`#add-on-selected-day`) both link to `/events/new?date=YYYY-MM-DD`. **Permission**: they are rendered only
  when `access.canCreate` (propose or validate), which is a courtesy; `/events/new` redirects anybody else (with or without
  the date) and `createEvent` calls `requireEventsProposer()`: the day in the address grants nothing. The date is read
  defensively (`requestedEventDay`: a real day of 2000–2100, anything else is ignored and the form starts from tomorrow as
  from the button; a past day is kept, events are recorded after the fact). **Default time**: 18:00–20:00 on that day in
  `bde.timezone` (`defaultEventTimes`, the same wall-clock helpers as the form: DST days stay 18:00 local; the browser's
  time zone plays no part). Cancel returns to that day of the calendar (`cancelHrefFor`).
- **Event input is validated by one pure Zod module** (`src/lib/events/input.ts`): required =
  title, description, location, category, start, end (+ how a series ends); only the assignees are
  optional. The form imports the very same `parseEventInput` to show errors before sending, and
  the server actions run it again — never trust the browser. `Event.description`/`location` stay
  nullable in Prisma on purpose: rows created before the rule must keep rendering, and are only
  blocked at their next edit through the form (status toggle / cancel-a-date don't go through it).
- **Visibility is decided in one place, date by date.** `expandEvents` (`occurrences.ts`) drops the dates that are not
  published (a draft or a proposal) unless `includeDrafts`, or unless the event is the reader's own (`ownLogin`; a series
  can be confirmed with one date back to draft, or a draft with one date confirmed alone); the queries also exclude them in
  SQL (`visibleTo` in `include.ts`: `VISIBLE_WITHOUT_DRAFTS` = a confirmed event, or one with a date confirmed alone, plus
  `authorLogin = ownLogin` for a proposer; `queries.test.ts`). Every consumer (calendar, list, dashboard, `.ics` download)
  passes `draftVisibility(access)` (`review.ts`): everything for a validator, one's own for somebody who only proposes,
  nothing for the others. The subscription feeds are stricter: only a validator's personal feed holds drafts and proposals.
  An unpublished event the user can't see is a 404, not a 403; a draft event with a date confirmed alone shows that date only.
- **The proposal circuit** (`src/lib/events/review.ts`, **non-negotiable**; user guide: `docs/en/events.md`). Two rights
  replace `events.manage`: **`events.propose`** (create events that wait, edit one's own until they are published) and
  **`events.validate`** (approve, refuse, edit and delete anything, publish directly; it includes propose and view). A
  migration (`20261016120000_event_proposals`) turns every `events.manage` of a role into `events.validate` plus what it
  includes, with a `role.migrate` audit entry listing the roles as they were: the server refuses a permission it does not
  know, so a role must never keep the old key. A role that held `manage` loses nothing.
  - **The rules are one pure module** (`review.ts`, like `roles/guards.ts`), asked by every page and action and by nothing
    else: `editRefusal` / `canEditEvent` / `canDeleteEvent` (a validator anything; a proposer **their own events that are not
    published**, and `isPublished` counts a date confirmed alone), `canCreateWithStatus`, `canChangeStatus` (a proposer moves
    between draft and proposed and **never to confirmed**; a validator publishes, unpublishes and keeps a proposal, **never
    makes one and never sends one back to draft: that is a refusal, which has a comment**), `statusChoices` (what the form
    offers: only what `canChangeStatus` accepts), `statusMove` (what a change is called in the audit log),
    `parseRefusalComment` (1 to 1000 characters, spaces ignored), `draftVisibility`.
  - **Statuses.** `EventStatus` is `DRAFT | PROPOSED | CONFIRMED`. A refusal is a `DRAFT` that carries `refusalComment`,
    `refusedByLogin`, `refusedAt` (set together: a CHECK of the migration), cleared when it is proposed or confirmed;
    `proposedAt` orders the list of proposals. A proposal is **the whole event, never one date of a series**: a proposer
    edits and moves a series as a whole (`updateEvent` and `setEventStatus` force the scope `following` from the first date,
    whatever the request says), so no date of a series is ever proposed on its own and the cut of a series needs no rule.
    A date confirmed alone by a validator makes the event partly published: its proposer can no longer touch it.
  - **A published event is never touched by a proposer**, not even their own (the page shows an explanation where the Edit
    button would be, `/edit` redirects to the event), so it never leaves the calendar without a validator's action. There is
    no "pending changes" copy of a published event, on purpose.
  - **Every action asks twice.** `requireEventsProposer()` / `requireEventsValidator()` (the right), then the rules of
    `review.ts` against the event as read (`canEditEvent`, `canChangeStatus`, `canCreateWithStatus`: a request that breaks one
    is crafted and throws `Forbidden`), then **again inside the transaction** (`assertMayEdit`: a validator may have published
    the event since the page was drawn). Validator-only: `refuseEvent`, `cancelOccurrence`, `restoreOccurrence`,
    `deleteFollowingDates`. `createEvent` now writes the event and its audit entries in one transaction.
  - **Approving is a status change** (`setEventStatus(…, 'CONFIRMED')` or the form), recognised by `statusMove` (`PROPOSED` →
    `CONFIRMED`) and audited `event.approve`; proposing is `event.propose` (from the form, a button, or the creation, which
    writes `event.create` and `event.propose`), withdrawing `event.withdraw`, refusing `event.refuse` (with the comment and
    the author). `refuseEvent` answers a notice, not an error, when somebody answered first (`?notice=alreadyReviewed`).
  - **Notifications** (`eventProposed` → the owners and holders of `events.validate` by e-mail, or the chat channel;
    `eventApproved` and `eventRefused` → the author by e-mail, or the chat channel, never the person who gave the answer).
    They are `optional` and `none` by default, take the channel the installer or the settings page chose, and count in
    `env.ts` like the other events notifications. `announceReview` (`notifications.ts`) re-reads the event and **sends nothing when
    the notice is stale** (a proposal withdrawn or answered meanwhile): unlike the confirmation there is no once-only claim,
    because a proposal can be made again after a refusal, so the transition itself (in the transaction) is what triggers
    exactly one `after()`. The cards are the existing builders with three more kinds (`EventCardKind`: `proposed`,
    `approved`, `refused`; `data.review` carries the author, the validator and the comment); the comment is a quote that
    keeps every line, first in the card, and is neutralized by the adapters like any text a member typed.
  - **The "To validate" page** (`events/review`, a 404 for anybody who cannot validate) lists `listProposals()` (the oldest
    first) with approve and refuse. The entry of the menu (`NavItem.badge`, counted by `countProposals()` in `(app)/layout.tsx`
    only for validators) shows the count, with the number for a screen reader (`badgeLabel`) and in a neutral colour (the accent
    stays for primary actions); the longest matching address is the active entry, so `/events/review` does not light up
    "Events" too. Refusing asks for the comment in a `ConfirmDialog` with a `field`.
  - **Navigation.** Every action of the circuit that stays on its page answers an `ActionTarget` (rule 2 of "Navigation"):
    the browser loads the page, so the counter, the list and the banners are always the real ones. `setEventStatus` and
    `refuseEvent` take a `returnTo` from a closed list (`event`, `review`), never an address.
  - **Tests, mutation-checked** (re-break a rule and one must fail): `review.test.ts` (every row of the tables),
    `access.test.ts`, `events/actions.test.ts` (what a proposer can never do, what a validator can never do to a proposal),
    `actions-series.test.ts` (the circuit end to end on the in-memory database), `pages.test.tsx`, `occurrences.test.ts` and
    `queries.test.ts` (who sees what), `review-notifications.test.ts`, `escalation.test.ts` (somebody who only proposes cannot
    hand out the right to validate: the generic rules of `roles/` apply unchanged), `layout.test.ts`, `app-shell.test.tsx`, and
    `e2e/review.mjs` in a real browser (run by CI, and by the stress workflow).
- **Subscription feed** (`/api/calendar/[token]`): token = 32 random bytes in `User.calendarToken`,
  stored in clear (so the profile can show the link), recomputed per request from the token owner's
  _current_ role/permission, same bare 404 for every failure. Removing a member deletes their row,
  so their token stops resolving immediately. Never log the token.
- **BDE-wide feed** (`/api/calendar/bde/[token]`, `BdeCalendarFeed` singleton row `id = "bde"`,
  `token` null = disabled): a second, independent secret from the per-member tokens. It has no owner,
  so it can never widen: `buildBdeSubscriptionFeed` asks for `includeDrafts: false` _and_ re-filters
  to `CONFIRMED`. Managed only with the `events.shared_calendar` permission (`canManageSharedCalendar` /
  `requireSharedCalendarManager` — _not_ `events.validate`) from
  `events/shared-calendar`. Enable is idempotent; regenerate/disable overwrite the single column, so the
  old link 404s at once. Audit actions `calendar_feed.enable|regenerate|disable` with targetType
  `CalendarFeed` and **never the token** (nor in logs). Removing a member does not touch it: the members
  page, reached with `?removed=<login>` (login pattern-checked), _offers_ regeneration when a link is
  active — never automatic, because it forces pasting the link again. Its honest limit is documented:
  access to a shared Google/Outlook calendar is managed there, not here. Both feed routes share
  `calendarFeedResponse` (`feed-response.ts`).
- **Notifications are best-effort and after the response.** `after(() => notifyEventConfirmed(id))`
  in the actions; the once-only guarantee is the atomic `confirmationNotifiedAt` claim. Confirming the following
  announces **once for the whole confirmed part** (the row that holds it; one calendar file with every date to
  come, never one message per date); confirming one date alone announces **that date** once
  (`notifyOccurrenceConfirmed`, claimed on the date's own row, and only when the date has its own CONFIRMED status:
  a date simply confirmed again like the rest of its series announces nothing).
- **Reminders** (`reminders.ts` + `scheduler.ts`): an in-process loop (every 5 min) started from
  `instrumentation.ts`. Exactly-once-or-lost: insert `EventReminder(eventId, occurrenceStart)` (unique)
  _before_ sending, ignore `P2002`. Due from `reminderHour` the day before the date's **effective** start;
  catch-up until it starts. The claim is keyed by the date's original start, so a date moved after its reminder is
  not reminded twice, and a cut moves the claims with the dates. The time, place and members in charge are the
  date's own; a draft or cancelled date is not reminded. Tested in `reminders.test.ts` including restart and
  concurrent callers.
- **Tests that must keep passing** when you change access rules: `access.test.ts`, `review.test.ts`,
  `events/actions.test.ts` (every action refused for PENDING / member without permission / a role that
  only views / module disabled; a proposer's limits), `events/pages.test.tsx`, `export.test.ts`, `export-bde.test.ts`, `shared-calendar/*.test.ts(x)`;
  and, when you change a series rule, `repeat*.test.ts`, `series*.test.ts`, `actions-series.test.ts`, `queries.test.ts`,
  `series-feed.test.ts` (UIDs, the BDE feed never holds a draft date), `series-notifications.test.ts`,
  `reminders.test.ts`, `e2e/series.mjs` (the dialogs in a real browser, run by CI) and `e2e/repeat.mjs`. Re-break a rule (the draft
  filter, the clearing of changed fields, the move of the reminders, the claim kept on a row) and one must fail.
- **Adding another module** follows the same recipe: a key in `modules.enabled` + a config section
  validated in `src/config/schema.ts` (required only when enabled), one `getXAccess()` gate
  returning null when disabled, `notFound()` on pages, a nav entry in `(app)/layout.tsx` + `NavItem`
  - `NAV_ICONS`, its permissions (`<module>.view`/`.manage` are automatic; extras go in `MODULE_EXTRA_PERMISSIONS` with
    their `permissions.items.<module>.<name>` messages), audit entries for every mutation, FR/EN messages, `loading.tsx` per route, seed data, a `docs/en/<module>.md` and its twin `docs/fr/<module>.md`.

## Production image & hardening

- **Dockerfile** (multi-stage): `next build` with `output: 'standalone'` (server.js + only the
  node_modules it uses; `outputFileTracingExcludes` drops sharp/typescript, `images.unoptimized`
  removes the `/_next/image` endpoint), run with `node server.js` — no npm in the final image.
  The Prisma CLI (a dev dependency, so not in the bundle) is installed separately at the lockfile's
  exact version into `/opt/migrate` and **pruned of what only Studio / `prisma dev` use** (~120 MB);
  `CMD` is `node /opt/start/start.mjs`, which runs `prisma migrate deploy --config /opt/migrate/prisma.config.mjs`
  then `node server.js` (next bullet).
  If a Prisma bump ever makes `migrate deploy` need a pruned file, the CI `docker` job (build + start
  against Postgres + `/api/health`) fails. `.dockerignore` must keep `.audit`, `.env*` and
  `bde.config.local.yml` out of the image. `HEALTHCHECK` calls `/api/health` (503 when the DB is down).
- **The operating system of the image is kept up to date, and checked.** The runner stage starts with `apk upgrade`: a fix of
  a library of Alpine (OpenSSL, for `psql` and `pg_dump`) is published before it reaches the next Node image. The `docker image` job
  of CI then scans the image with Trivy and **fails on a HIGH or CRITICAL vulnerability that has a fix** (`--ignore-unfixed`:
  what nobody can fix yet stops nobody). What is accepted is in `.trivyignore`, each with its reason and the same wording as
  `scripts/audit-allowlist.json`.
- **The published image** (`.github/workflows/release.yml`, `scripts/release.mjs`; tests in `scripts/release.test.ts`).
  `docker-compose.yml` starts `ghcr.io/edouardbautz/bde_network:${BDE_VERSION:-X.Y.Z}`: the version is **written in the
  file**, never `latest`, so that `git pull` + `docker compose up -d` is the whole update and an older checkout runs its
  own image. `BDE_VERSION` is an escape hatch for pinning, not something to set. A test ties the default to
  `package.json` and to a CHANGELOG section: bumping one without the others fails CI, and so does the release.
  - **`docker-compose.build.yml`** is the way to build from the folder (`build: .`, image `bde-network:local`, which
    can never be taken for the published tag). The CI steps that need a freshly built image set `COMPOSE_FILE` to both
    files; so do `scripts/docs-screenshots.mjs` and a contributor's `.env` (`COMPOSE_FILE` +
    `COMPOSE_PATH_SEPARATOR=:`, which `backup.sh` / `restore.sh` follow because they call `docker compose`). A platform
    driven by files needs it too: **the published image holds the template `bde.config.yml`**, not an owner's file, and
    the `release.yml` build checks it (`votre-login-42` in the image). The messages that tell a files-driven operator
    to rebuild name that command (`src/config/rebuild.ts`, the pages of `docker/startup-problems.mjs`).
  - **A release is a tag `vX.Y.Z` on main**, nothing else. `check` (the four places agree, the tag is an ancestor of
    main) → `build` (each architecture built **natively**, amd64 on `ubuntu-latest` and arm64 on `ubuntu-24.04-arm`, no
    emulation; pushed **by digest, with no tag**, then `e2e/safe-update.sh` runs against that digest on that
    architecture) → `publish` (only when both passed: `imagetools create` makes `X.Y.Z`, `X.Y` and, without a suffix,
    `latest`; provenance and SBOM are attached as attestations). An image that failed its test is never named. On a pull request that
    touches the workflow, the Dockerfile, `docker/` or the test, `check` and `build` run **without pushing**, so
    the part that cannot be tried on the day (arm64, the smoke test) is tried before. A fork skips the workflow.
  - **Preparing one**: a pull request that moves `package.json` (and the lock: `npm version X.Y.Z --no-git-tag-version`,
    then `npx -y npm@10 ci --dry-run`), the compose default, and the CHANGELOG (`## [Unreleased]` becomes
    `## [X.Y.Z] - date`, with the link list at the bottom). Then, once merged, `git tag vX.Y.Z && git push origin
vX.Y.Z`. **The GitHub release is created by the maintainer, not by the workflow**, once the images are out
    (`gh release create vX.Y.Z --title vX.Y.Z --notes-file …`): the CHANGELOG is the complete record, the release notes
    are written for the people who run a BDE (English, with a short French summary, nothing technical) and the release
    is then published under the maintainer's name. The first publication of a package on GHCR is private: make it public once, in the package's settings.
    Mistakes are fixed forward (a new patch version); an image that is already pulled is never replaced under the same
    tag.
- **bde.config.yml is never bind-mounted; it is the seed of an import.** `docker-compose.yml` has no volume for
  it: a file mount is resolved by the Docker **daemon**, on its side, with the rights of the container's user. On a
  rootless daemon, a remote one, or a home on a network/FUSE share, the file is either not visible (the daemon
  creates an empty directory) or visible but unreadable by the app's uid 1001 (a `chmod 644` changes nothing), and
  the app used to report "introuvable" for every one of those. The file now travels in the **build context**, which
  the docker client sends itself with the user's own rights, through the `builder` stage (`COPY --from=builder`); a
  missing file is replaced there by `bde.config.example.yml` (the template: "nothing decided"). Only an image built on
  the spot (`docker-compose.build.yml`) carries the operator's file; the published one carries the committed template. **The build does not
  read it** (`next.config.ts` no longer validates it: a broken file must not stop a rebuild once the database is the
  source), and **the build output must never depend on the configuration** (the only prerendered page,
  `/_not-found`, holds none: keep it so). At runtime the file is read only by an installation that has not been
  imported yet (`src/config/index.ts`: `describeReadFailure` tells a missing file, a directory in its place, an
  unreadable file, an empty one and an invalid one apart, with the exact path checked). Reproduced and fixed against
  a rootless Docker-in-Docker (`docker:dind-rootless`, project mounted from a client container so the daemon cannot
  see it). The commands that read what the container sees are under "Problèmes fréquents" in
  `docs/en/installation.md`.
- **The notice of a new version** (`src/lib/updates/`, `src/app/api/updates/route.ts`,
  `src/components/updates/update-banner.tsx`, setting `updates.check`; tests next to them and the scenario "turn the
  notice of new versions off and on" of `e2e/actions.mjs`). The one thing the platform asks the outside world about
  itself: GitHub's `releases/latest` of the project, a `GET` carrying nothing but `User-Agent: BDE_Network/<version>`.
  - **Never on the way of a page.** The banner is a client component that asks the platform's own route **after** the
    page is shown; the route is owner-only (`getSettingsManager`, a bare 404 for anybody else), answers `no-store`, and
    reads a cache on the server: a success is kept 6 hours, a failure 30 minutes, simultaneous asks share one request,
    the timeout is 3 s, and nothing ever throws (`latest-release.ts`). Pages only pass `enabled` (`updates.check`) to it,
    so turning the setting off removes the banner at the next refresh and nothing is asked any more.
  - **What GitHub says is not trusted.** Only a published (not draft, not preview) release whose tag is `vX.Y.Z` and
    whose page is under `github.com/edouardbautz/BDE_Network/releases/` is believed (`readRelease`); the notes are
    reduced to one plain-text paragraph of 320 characters at most (`summarizeNotes`) and shown as text, never as markup;
    the link is the validated page. The running version is the one written into the image (`BDE_VERSION`, see
    `runningVersion`): unknown in development, where nothing is asked.
  - **No update button, on purpose.** The application has no control over Docker and must not get one (that would be
    the container being able to replace itself, or a mount of the Docker socket): the banner shows the two commands
    and the platform's own safe update does the rest. A dismissed banner is remembered per browser, per version
    (`localStorage`, optional).
  - `RELEASES_API_URL` replaces `api.github.com` for the end-to-end tests (`e2e/mock-fortytwo.mjs` answers with
    `MOCK_LATEST_RELEASE`); it is never set in a real installation.
- **docker-compose.yml needs no `.env`.** There is no `env_file`: the variables an installation that predates the
  database needs from `.env` are passed by name (`${VAR:-}`; compose reads `.env` itself when it exists and does not
  mind when it does not, with any Compose v2), to be copied into the database once. A one-shot `secrets` service
  (`postgres:17-alpine`, already pulled) writes the password of PostgreSQL into the `secrets` volume the first time
  (or copies the `POSTGRES_PASSWORD` of an existing `.env`, because the database exists with it), `postgres` reads
  it with `POSTGRES_PASSWORD_FILE`, and the supervisor reads it to build `DATABASE_URL`. `APP_PORT` and `APP_BIND`
  are the only settings left to `.env`: they are the daemon's, the application cannot change them. `/secrets` exists
  in the image (owned by uid 1001) so that `docker run` without the volume (the CI) still works.
- **A startup problem is shown, not looped** (`docker/start.mjs`, `docker/startup-problems.mjs`; tests next to
  them). `restart: unless-stopped` turned every fixable mistake (a typo in `.env`, a changed
  `POSTGRES_PASSWORD`, a database that is not up yet, a failing migration) into a silent restart loop whose only
  explanation was in `docker compose logs`, half of it Prisma's English. The container's command is now a small
  supervisor (plain JavaScript: the image has `node` and nothing else) that **never exits for a problem the
  operator can fix**: it classifies a failed `migrate deploy` by its Prisma code (`P1000`/`P1003` wrong
  credentials, `P1001`/`P1002`/`P1017` database not there, `P1012`/`P1013` bad address, anything else a failed
  migration), and the application leaves exit code **78** (`EXIT_CONFIG`, kept equal in both files by a test)
  with a report (`BDE_STARTUP_REPORT`: `{ kind: 'env' | 'config', variables: [names] }`, written by
  `refuseToStart` in `startup-checks.ts`) when `.env` or `bde.config.yml` is unusable. In both cases it answers every
  request itself with a **503 page** (FR/EN by `Accept-Language` or `?lang=`, `no-store`, `noindex`, CSP, no script)
  and `/api/health` with 503 (the container shows as unhealthy), and logs one French line. A database that is not
  there yet (and a refused password, which the operator may fix inside PostgreSQL) is awaited every 15 s and the
  application starts by itself, giving the port back; a failed migration or a bad `.env` waits for the operator
  (`docker compose up -d` recreates the container). A real crash of the application still ends the container with
  its exit code: that is what the restart policy is for. **Nothing a person typed reaches the page**: it is
  fixed sentences, a kind from a closed list, a Prisma code matched by `^P\d{4}$` and the NAMES of variables
  matched by `^[A-Z][A-Z0-9_]+$`; Prisma's own output goes to the logs only through `redact` (every secret of
  the environment, clear or URL-encoded, and any `postgres://` address). The page has its own inline CSS: a test
  keeps its tokens equal to those of `globals.css`. The in-app pages (login, error) are unaffected.
- **A safe update** (`docker/start.mjs`, `safe-update.mjs`, `database-tools.mjs`; tests next to them, and
  `e2e/safe-update.sh` against the real image and a real PostgreSQL, run by CI). Before the migrations the
  supervisor looks at three things and answers each in the browser, not in a loop:
  - **the stack**: `docker-compose.yml` passes `BDE_STACK` (a number, `STACK_VERSION` in `safe-update.mjs`, raised
    when the file and the image have to change together). An image older than its compose file (the incident that
    made this: an old image kept by `docker compose up -d` after a `git pull`, which answered "Connection url is
    empty" in a loop), or the reverse, is a page (`stack-old-image`, `stack-old-compose`). A plain `docker run` passes
    nothing and is not checked. A database address that cannot be built is a page too (`database-url`), before
    Prisma is run;
  - **the database against the image** (`planMigrations`, from `_prisma_migrations` read with `psql` and the folders of
    `/app/prisma/migrations`): `newer` (migrations this image does not have: refused, untouched), `stuck` (a migration
    failed earlier and was neither finished nor rolled back: Prisma refuses to go on), `pending`, `current`,
    `fresh`;
  - **a copy** when migrations are `pending`: `pg_dump --clean --if-exists` (the dump `scripts/backup.sh` makes) to
    `/backups` (the `backups` volume), compressed, checked complete (its last line), named
    `pre-update_<UTC>_v<version>.sql.gz` (`BDE_VERSION` is written into the image from `package.json`); 5 kept, nothing
    older than 90 days, never the newest; none for `current` or `fresh`; one per set of pending migrations even if the
    attempt is repeated. A copy that cannot be made **stops the update** (`backup-failed`; `BDE_SKIP_BACKUP=1` goes on
    without, knowingly).
  - **A failed migration puts the copy back**, but only a real failure (`classifyMigrationFailure` says `migration`:
    a database that is slow or refuses a password is waited for, and nothing was changed). The restore **drops the
    schema first** (a migration that failed halfway may have added tables the copy does not know, and the next attempt
    would stop on "already exists"), in one transaction (`--single-transaction`, `ON_ERROR_STOP`), then the plan is
    read again and must be the one from before; otherwise the page says the database could not be put back
    (`migration-restore-failed`) and names the copy. Either way the platform stays stopped, `/api/health` answers 503,
    and the application never ran on that database. `scripts/restore.sh --pre-update` restores a copy by hand, with
    the same confirmation and safety copy as any restore.
  - **Existing data, no settings.** The application, not the supervisor, knows whether the files hold a complete
    configuration: when it would open the installer (`initialized.source === 'setup'`) **on a database that has
    accounts**, it refuses (`refuseToStart('existing-data')`, exit 78, the page `existing-data`): the installer would
    replace the settings of a platform that was installed before it. (A platform whose image does not hold its
    `bde.config.yml`, which is what a published image is: build once with `docker-compose.build.yml`, see "If your
    platform predates the installer" in the upgrading guide.)
  - What goes on the pages is fixed sentences, a file name matching `BACKUP_PATTERN`, migration names matching
    `^[0-9]{14}_[A-Za-z0-9_]+$` and a version: nothing read from the database or the environment as it is
    (`renderProblemPage` filters again).
    Add a row to `e2e/safe-update.sh` for every new case, and a page in `PROBLEMS` in both languages.
- **The terminal shows the address to open, not the one the server listens on.** Next.js prints
  `Network: http://0.0.0.0:3000` and the container's port; the supervisor passes the application's output through
  `terminalLine` (`startup-problems.mjs`): the Network line is dropped and `Local:` becomes
  `http://localhost:<BDE_HOST_PORT>`. The installer's code box already said `http://localhost:<port>`.
- **The database address is built in the container, encoded.** `docker-compose.yml` sets `DATABASE_URL: ''` (it
  overrides the one of `.env`, which is for `npm run dev`) and `start.mjs` builds
  `postgresql://user:password@postgres:5432/db` from `POSTGRES_*` with `encodeURIComponent`. Interpolated by
  compose, a password with `@ / : ? #` cut the address in the wrong place and Prisma printed pieces of it in
  the logs. A `DATABASE_URL` given to `docker run` (the CI) is used as is.
- **42 refusing the application is told, not guessed** (`src/lib/auth/oauth-check.ts`). A secret that expired or
  was regenerated on the intra breaks nothing until someone signs in, and Auth.js then only says "failed". The
  `client_credentials` grant (no member needed) tells "refused" (`invalid_client`) from "42 is slow": cached
  10 min (a refusal 2 min, "unknown" 30 s), 2.5 s timeout, never throws. Used by the login page (an alert and a
  disabled button), by `auth-error` (`OAuthCallbackError` / `Configuration` become "the platform cannot sign in
  with 42" only when 42 says so; a visitor who cancelled still gets "try again") and, once at start-up, as a
  warning in the logs. The secret only travels in the body of the request.
- **docker-compose.yml** publishes the app on `${APP_BIND:-127.0.0.1}:${APP_PORT:-3000}`: only the reverse proxy
  reaches it unless the operator opts out (`APP_BIND=0.0.0.0`, documented in `docs/en/deployment.md`). **PostgreSQL
  publishes no port** (only the app, on the compose network, reaches it); `docker-compose.dev.yml` still
  publishes 5432 on 127.0.0.1 for `npm run dev` outside Docker.
- **Security headers** (`src/lib/security-headers.ts`, wired in `next.config.ts`): CSP (production
  only; `'unsafe-inline'` is needed by Next hydration and next-themes; no `upgrade-insecure-requests`
  so an instance without an HTTPS proxy still works; profile pictures from `cdn.intra.42.fr`),
  nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, and HSTS only when the request came
  with `X-Forwarded-Proto: https`. A new external image/script host must be added to the CSP. **Nothing of ours may violate it**: Zod compiles its schemas with
  `new Function` and finds out by trying, which was a `script-src` violation on every page (found by the browser suite, which
  listens to `securitypolicyviolation` in the three engines), so every module that brings a schema to the browser imports
  `lib/zod-config.ts` (`jitless`) first; `zod-config.test.ts` lists them and fails if one asks to evaluate a string. **A header set in
  `next.config.ts` replaces the one a route sets for the same name** (the unit test of the route sees only the route, so it
  cannot tell): an address that needs a policy of its own, like the logo (`OWN_POLICY_PATH`), is left out of the rule of the
  pages. The attacks of the quality campaign (`qa/security/`) read the headers of the running image.
- **Error pages**: `[locale]/not-found.tsx` + `[locale]/[...rest]/page.tsx` (unknown URLs, a catch-all so
  the localized 404 renders instead of Next's English one), `[locale]/(app)/not-found.tsx` (inside the
  shell), `error.tsx` at both levels (`components/layout/error-view.tsx`: apology, retry, back to the
  dashboard, and only the error's `digest` — never its message), and `app/global-error.tsx` +
  `app/not-found.tsx`, which have no layout, locale or provider to rely on and so are the only places
  with bilingual hard-coded text. Server actions must **not throw for an expected situation** (already
  approved, already deleted, role gone): return a code the UI translates (`ActionResult`, see
  `lib/roles/errors.ts`) or, for the events module, redirect with `?notice=` (`lib/events/notice.ts`).
  `throw` stays for a crafted request (`Forbidden`, invalid status).
- **Database down**: Auth.js turns a failing session lookup into "no session", which looks like a
  logged-out visitor. `(app)/layout.tsx` and the login page therefore call `isDatabaseReachable()`
  (`src/lib/health.ts`) before redirecting to `/` and send to `/unavailable` instead (translated,
  reassuring, polls `/api/health` and brings the visitor back). The pool connect timeout is 3 s.

## Navigation: a link to the page you are on (`src/i18n/link.tsx`)

**Symptom met in production** (reported by a member): on the events page the month buttons, and on a computer the
calendar/list switch, did nothing. Nothing in the console, nothing in the logs, `next dev` fine. Reproduced against the
production image in a real browser (and then against a local `next build` + `next start`), with a request that leaves, a
`200`, and a page that does not move: not even the address.

**What happens.** Clicking a link whose pathname is the one you are on and whose query differs (`/events` →
`/events?view=list`) makes the production router reuse the entry it cached for that pathname (an _aliased_ prefetch entry:
it is only used outside development, and it only exists for a route that has a `loading.tsx`, which every `(app)` route has),
show the "loading" state, then fetch the page. The navigation resolves, the follow-up `server-patch` action is applied, and
the transition **never commits**: the old page stays and `history.pushState` is never called. The same click on a link to
another pathname (sidebar, a card to `/events/<id>`) works, which is why it went unnoticed; timing decides for some pages, the events page always fails. We did not isolate the line that
holds the commit. It is the family of Next.js 15 client-router bugs reported upstream (vercel/next.js #86151 "`loading.js`
sometimes causes soft-navigation to get stuck", #90008 on aliased entries; the React side is facebook/react #35821,
`useDeferredValue` stuck on a stale value), reported fixed in 16.x. **Checked again on Next.js 16.4.1: it is still
there** (an image built without the workaround fails `e2e/events.mjs` four runs out of four, on the list button), so the
rule below stays.

**Rule.** Every link goes through `Link` from `@/i18n/navigation`, never `next/link` or `next-intl/navigation` directly.
That `Link` is next-intl's, except that a link to the page you are already on is a plain `<a>` (the page loads again, which is
what the server-rendered, JavaScript-free calendar already is; the menu entry of the page you are reading does the same).
The address is built by next-intl's `getPathname`, so it is the one the real `Link` would write; a link that changes the
language (`locale` prop) stays the router's. **Do not call `router.push`/`replace` to the pathname you are on.** The only such call, the member removal, was
checked by hand; the CI test below does not cover it.

**Actions that stay on the page** (every button that changes something and leaves you on the same page) can leave the
old state on screen in the production build: the action is done, the audit entry written, the page not updated, nothing in
the console, and `next dev` never does it. It is the same family of router bug, but it is **not** random across the
platform: it was **measured**, in a real browser on the real image (`e2e/actions.mjs`, `MEASURE=1`, 15 plays of each
scenario, a reload telling "the page did not follow" from "the action did not work"):

| Action (page)                                                                                       | Stale in the production build          |
| --------------------------------------------------------------------------------------------------- | -------------------------------------- |
| confirm, back to draft, cancel, restore (event page, before `ActionTarget`)                         | about 1 click in 2                     |
| turn the BDE calendar link on / regenerate / turn off (`redirect()` to itself)                      | 14 plays in 15                         |
| approve, refuse, remove, change the role of a member                                                | 0 in 15 each                           |
| make a role the default, delete a role, create, edit a role                                         | 0 in 15 each                           |
| settings: identity, owners (add, remove), logo, modules (the menu follows)                          | 0 in 15 each                           |
| regenerate one's personal calendar link (`ActionTarget` since the CI saw it stale once in 45 plays) | 0 in 15 before; 1 in 45 in a later run |
| switch language                                                                                     | 0 in 15                                |

We could not isolate why the members, roles, settings and profile pages are spared (they have the same `loading.tsx`,
the same `revalidatePath`, the same `ConfirmDialog`), so **do not assume a new page is spared**.

**Rule.**

1. An action that stays on the page and **redirects to the page it is on** is never acceptable (it is the same click on
   a link to the page you are on, see above).
2. An action whose result the page must show (a row that disappears, a link that changes, the menu) **returns an
   `ActionTarget`** (`{ href }`, `lib/action-target.ts`, built with `getPathname`) and the browser **loads** it:
   `ConfirmDialog` does it when `onConfirm` answers one, `ActionButton` for what asks no question. This is what the
   events and the shared calendar do. The cost is a page load, which keeps the scroll position but not a toast or the
   local state of a form: say what happened in the page itself (a `?status=` notice, as the shared calendar does).
3. An action may keep the soft refresh (a server action that returns a result, then `revalidatePath`) **only if a
   scenario of `e2e/actions.mjs` plays it in a real browser and the table above says 0 stale**. Members, roles and settings
   are in that case today: converting them would only cost their toasts. If a scenario ever goes STALE,
   the action moves to rule 2; the CI fails it.
4. An action that leaves for **another pathname** (the edit form, deleting an event, sign-out) may `redirect()`.

**Nothing is left to memory.** `src/lib/server-actions-coverage.test.ts` lists the exported actions of every `'use server'`
file and fails until each one is named in a `// covers: <folder>.<action>` line of an `e2e/*.mjs` script or in its `EXEMPT`
list with the reason it needs none. A module's author therefore writes the scenario (a few lines in `e2e/actions.mjs`:
create what it needs with `sql`, click, `expectPage(...)`) before the CI is green. `e2e/actions.mjs` runs in CI on the real
image (3 plays of each scenario: a defect that was 1 in 2 is missed 1 time in 8 per scenario, and one that is 14 in 15 is
never missed); `MEASURE=1 ROUNDS=15 node e2e/actions.mjs` is how to measure a new page before choosing rule 2 or 3.

**Prefetch.** Next.js prefetches the links it sees, and each prefetch of a page with data is a rendering by the server. A link that
is repeated many times on a page (the events of the calendar: up to a hundred a month) is `prefetch={false}`: measured, the calendar
made 110 prefetch requests against 13 to 18 for the list and the dashboard.

**Tests.** `src/i18n/link.test.tsx` (the choice of the element, the address, no router option on the anchor). The proof that
the buttons work is `e2e/events.mjs`, run by CI against the real image: it clicks next/previous month and "today", a day of
the grid, the list and calendar buttons, another date of a series and the menu entry of the page itself, on a computer-sized and
a phone-sized screen, in French and in English, and waits for the **page to change** (a request leaving proves nothing). It
fails on the image without the fix (checked) and passes with it. A new button that changes only the query of the page it is
on belongs in that file.

## A hydration error on a slow connection (Next.js 16 and `e2e/hydration.mjs`)

**Symptom met in the CI**, one run out of three or four, in `e2e/events.mjs` and `e2e/series.mjs`: `Minified React error #418` (args `HTML`: the server's HTML does not match
what the client drew) followed by up to a dozen `TypeError: Cannot read properties of null (reading 'parentNode')`. Never on
a developer's computer. First read as "a click that left a page that was still hydrating" (the test's own doing), and
tolerated for a while by ignoring the errors that came before a navigation. **That reading was wrong**: the stress workflow
(`.github/workflows/e2e-stress.yml`) caught errors on pages that were never left, `111 ms after the document began`.

**What it is** (the upstream report that matches the symptoms, the versions and the fix we measured; we did not bisect React). A bug of the React that Next.js 15.5 vendors (`19.2.0-canary-0bdb9206-20250818`), in the client's
time-sliced hydration of a page whose RSC data is still streaming: when a lazy child suspends and its data arrives while
React yields, React replays the unit of work **without putting the hydration cursor back** (facebook/react issues 35210 and 37584, fixed by pull request 35494 in January 2026, released in react-dom 19.3.0; maintainers do not backport to 19.2). The client then
finds "different" HTML on an identical tree, throws the server's DOM away and draws the page again; the `$RC` scripts that
finish the streamed boundaries afterwards find their placeholders gone (`parentNode` of null, once per boundary). The page
still ends up complete, which is why nobody saw it: a visitor gets a flash and a late page, and the console gets a dozen
errors. A related open React bug (issue 37321) is hydration starting before the HTML parser has the whole shell.

**Why it comes and goes.** It needs the scripts in the browser's cache (so hydration starts early) and the HTML arriving in
several pieces (a 200 KB page with its data). A fast local connection never does it; the slower, busier runner of the CI
did in about one load in twenty; a throttled connection (1.5 Mbps, 20 ms) did it for **17 loads in 120** (events, an event, the
dashboard, the members) on Next.js 15.5.27. It is also hidden by anything that slows the page down (with the debugger attached, 120 runs of the
scripts were clean): do not conclude from "it passes on my machine" or "it passes with logging on".

**What we did.** Moved to **Next.js 16.4.1** (React `19.3.0-canary-278794d7-20261002`): **0 errors in 120 loads** of the same
pages under the same conditions, on the webpack image that we ship (and 0 in 100 on a Turbopack build). The move brought three changes, no more:
`middleware.ts` became `proxy.ts` (same code, Node.js runtime only), `eslint-config-next` 16 is a flat config of its own
(`eslint.config.mjs` no longer needs `FlatCompat`), and its React-hooks rules, now stricter, made four effects that set
state into something the React documentation prescribes (state that follows a prop while rendering, an external value
read with `useSyncExternalStore`, an event handler that owns a temporary address).

**The guard.** `e2e/hydration.mjs` (run by CI on the real image) loads the events pages, the dashboard and the members page
40 times each, the first load warming the cache and the others on a 1.5 Mbps, 20 ms connection, and fails on any page error.
It fails on Next.js 15.5.27 (about one load in seven) and passes on 16.4.1. A framework or React bump that brings the bug back
is found there. To hunt this kind of error, `HYDRATION_DEBUG=1` makes `e2e/watch-page.mjs` stop the page at the moment React
throws its internal #519 and write down the components being hydrated and the DOM it was given.

**Browser tests that fail now and then.** Never "retry until green", never "ignore the errors that come before a
navigation". `.github/workflows/e2e-stress.yml` (Actions → e2e stress → Run workflow; also run on a pull request that
touches it) plays each script 20 times (the actions script, whose round is ten minutes, 3 times), on three platforms at once, with the browser in a different time zone each round
(UTC, Auckland, Los Angeles, Kolkata: a page drawn differently by the server and the browser according to the time zone
would show), and keeps for each failure what `e2e/watch-page.mjs` collected: in which document the error was raised, by
which script, and the HTML the browser drew against the HTML the server sent. A script is trusted when it holds for all the
rounds. The races found this way in the scripts themselves: the settings script reloaded before the server had answered a
confirmed removal (the dialog closes at once), and `e2e/settings.mjs`/`events.mjs` take `LATENCY_MS`, `TIMEZONE` and
`CPU_THROTTLE` to reproduce a slow server, another time zone and a slow processor.

## Quality campaign (`qa/`, `.github/workflows/qa.yml`)

The platform is checked well beyond its unit tests before real BDEs rely on it. The campaign is a set of suites that all
start from the same three things, so that what one finds the others can replay.

- **Three levels of CI.** (1) Every pull request: `ci.yml`, fast and deterministic, what makes a change safe to merge.
  (2) `qa.yml`, every night and on demand (Actions → qa → Run workflow), and on a pull request that carries the label
  `full-qa`: the heavy suites, on the real image, a real PostgreSQL and the QA dataset. (3) A release: the last run of
  `qa.yml` on the commit to tag must be green. A suite goes in the level its duration allows: the budget of a pull request
  is a few minutes more, the rest is nightly. Never "retry until green" (see "Browser tests that fail now and then").
- **The personas** (`qa/personas.ts`): the nine profiles every suite plays — visitor, account waiting for approval,
  member, member who proposes, member who validates, member with a custom role, member with the Admin role, owner, and
  a removed member whose cookie is still valid. "Module disabled" is not somebody but a way of running the platform
  (`PLATFORM_VARIANTS`). `cookieHeaderFor` forges the session cookie of a persona with the platform's own secret, exactly
  as Auth.js writes it (the same technique as the `e2e/` scripts: nobody signs in through 42 in a test). A new suite uses
  these, it does not invent accounts.
- **The dataset** (`qa/dataset.ts`): about 300 members, 600 events over two school years — single events, series of
  every frequency, series cut in two, drafts, proposals, refusals, dates that were cancelled, edited, moved or reminded
  — and the audit trail of all of it, as SQL. **Deterministic** (a seeded generator: the same options give the same SQL, a
  failure can be replayed) and built with the real series engine (`repeat.ts`), so it is what the application would have
  written. `npx tsx qa/cli.ts load --database <url>` writes it, `sql` prints it. Only the persona `qa-owner` is an OWNER
  (the others would be demoted at the next start, `reconcileOwnerAccounts`).
- **The invariants** (`qa/invariants.sql`, `qa/invariants.ts`): what must be true of the database after any scenario —
  one default role, a member has a role and nobody else does, a rule is a rule, a series and its end come together, the
  school year is the one of the start, a refusal is a draft with its three fields, a cut series' first row exists, every
  date a cancellation, a date of its own or a reminder refers to is a date of its series (checked with the engine), no
  webhook address or key in the audit trail… An empty result is a healthy database. `npx tsx qa/cli.ts check` runs them. They
  are tested against corruption (`qa/dataset.test.ts`: each is broken on purpose and must be seen), and a suite that
  changes data (resilience, updates, long time) ends by running them. **When an invariant fails, the invariant is
  not the first suspect: a violation is a bug, or a wrong reading of the contract, and the second needs a note here**
  (example: `proposedAt` is never cleared, so "only a proposal has one" was wrong, "a proposal has one" is the rule).
- **The platform** (`qa/platform.sh`): `up` starts the production image against a PostgreSQL 17 container and installs
  a BDE by importing the settings from a configuration file (no browser needed), then loads the dataset; `down` removes
  everything; `env` prints `QA_BASE_URL`, `QA_AUTH_SECRET`, `QA_DATABASE_URL` for the suites. It takes about 10 seconds with the
  image built. The 42 API and the release API are pointed at an address that answers nothing: the platform must work
  without them. `--variant events-disabled` runs it without the module. **`--now <ISO date>` sets the clock of the application**
  (`qa/fake-clock.cjs`, loaded with `NODE_OPTIONS=--require`; tested by `fake-clock.test.ts`): from that moment the clock runs at the
  normal speed, so the dates to come, the day marked as today and the reminders are those of the dataset (built around
  2026-10-16T12:00:00Z) whenever the platform is made. Only `Date` is changed (a Proxy: `new Date()`, `Date.now()`, `Date()`; a date
  built from arguments is untouched and the objects stay real dates); the database keeps its own `now()`. QA tooling only: nothing of
  the application reads `BDE_QA_NOW`. The suites that need a stable "today" (visual references) use it, and so will the long-time
  suite. POSIX `sh`, like the scripts of `scripts/`.
- **The smoke test** (`qa/smoke.ts`): is the platform up, does it tell the personas apart, do the invariants hold. It is the
  first step of every run of `qa.yml`.
- **Run it by hand**: `docker build -t bde-network .`, then `sh qa/platform.sh up`, `eval "$(sh qa/platform.sh env)"`,
  `npx tsx qa/smoke.ts`, `sh qa/platform.sh down`. Docker is the only requirement besides Node. A suite that needs a
  database without the image uses `qa/test-database.ts` (a migrated database, thrown away), like the tests of the
  data migrations, and runs only when `MIGRATION_TEST_DATABASE_URL` is set (the `migrations` job of CI sets it).
- **The access matrix** (`qa/access/`; `matrix.ts`, `actions.ts`, `discover.ts`, `run.ts`, `actions-run.ts`,
  `coverage.test.ts`). Who may open what, written down on its own (`model.ts` does not import `lib/permissions`: it is the
  expectation, so when it disagrees with the code one of the two is wrong and finding which is the point), and played
  against the real image: **every page and API route** (`PAGES`, `API`: several probes for the routes that take an
  id, a token or a state: a published event, a draft, the proposal of somebody else, one's own, one that does not exist…)
  and **every server action** (`CASES`), as each of the nine personas, with the events module on and off. Rules of the
  matrix: (1) **"denied" is any answer that shows no content** (not found, or sent elsewhere), where the platform's
  rule is precise (a visitor goes to the login page, a pending account to the waiting page) the expectation says so;
  (2) **a refusal never carries somebody's data** (the addresses of the members, a feed link: looked for in the body);
  (3) **reading changes nothing** (a fingerprint of every table before and after the whole run; the reminder loop's claims, `EventReminder`, are left out: the platform writes them by itself when a date becomes due, and the first nightly run found it out); (4) a page that Next.js
  has already started to stream answers 200 and says the rest inside it (the not-found page marks itself `noindex` and
  `NEXT_HTTP_ERROR_FALLBACK`, a redirect is a `__next-page-redirect` meta refresh): the runner reads that, not the status.
  **Server actions** are called over HTTP the way a browser does (the id of the action in `Next-Action`, the arguments
  encoded by Next's own `encodeReply`), the ids and the list of what exists coming from the image's
  `server-reference-manifest.json` (73 entry points: 51 exported actions and 22 written inside components). Each case has
  the persona who is allowed, the arguments (a crafted request sends anything: valid ones, so that a missing gate would
  change something), and, for what is allowed, **the tables that must change** (the audit log among them): (a) every
  persona that must be refused changes nothing in the database (and, where the gate is the first thing the action does,
  `strictThrow`, it throws); (b) the least privileged persona that is allowed, and the owner, get through and change
  exactly what the case says (a gate that refuses everybody, or arguments that are wrong, would otherwise pass as
  "secure"). The database goes back to the dataset between cases (`qa/reset.ts`). An action written inside a component is
  an entry point of its own: `coverage.test.ts` fails unless each is declared (`INLINE_ACTIONS`) and only hands over to an
  exported action (never a query of its own). **A new page, route or action fails the CI of the pull request that adds it
  until it is in the matrix** (`coverage.test.ts` runs with the unit tests; the HTTP run is the `qa` workflow's, ~1 minute
  per variant). `npx tsx qa/access/run.ts --variant events-enabled` plays it on a platform made by `qa/platform.sh`.
- **Static security** (`.github/workflows/security.yml`, `codeql.yml`, the image scan of `ci.yml` and `qa.yml`; `qa-rules/`,
  `.gitleaks.toml`, `.trivyignore`, `scripts/sarif-gate.mjs`). Every pull request is read by: (1) **Semgrep with the rules of
  the project** (`qa-rules/`: a managed setting read from `process.env`, `eval`, a process started by the application,
  `Math.random()`, raw SQL built from a string, a link that does not go through the i18n `Link`, a cookie that is not
  `httpOnly`, a secret in a log, `dangerouslySetInnerHTML`, a `target="_blank"` without `rel`): the rules of this document
  that a reviewer would otherwise have to remember, each with a case it must find and a case it must leave alone
  (`semgrep --test qa-rules`; the cases are not formatted by Prettier, a comment applies to the line under it); (2) **gitleaks
  over the whole history** (the generic "looks like a key" rule is relaxed in test files, which write fake secrets, and
  only there: `qa-rules/gitleaks-selftest.sh` checks that a token of a known service is still found in a test file); (3) **Trivy**
  on the lockfile (production dependencies), on files (secrets) and on the Dockerfile; (4) the **dependency review** of
  what the pull request adds (a known vulnerability, a license outside the list of what the production dependencies have
  today); and (5) **CodeQL** on the code and on the workflows (`security-extended`), whose HIGH and CRITICAL alerts (and
  anything of level `error`) fail the job through `scripts/sarif-gate.mjs` instead of waiting in the Security tab; a false
  positive is dismissed there, by a person, with the reason. The **production image** is scanned for known vulnerabilities
  in the `docker image` job (a HIGH or CRITICAL one that has a fix fails) and every night in `qa.yml`. Every scanner runs from a
  pinned Docker image, so a new version never changes a result by itself (Dependabot proposes it). What is accepted is in
  `.trivyignore`, with the same reasons as `scripts/audit-allowlist.json`.
- **Attacks** (`qa/security/`, the `Attacks` step and the `zap` job of `qa.yml`; `npx tsx qa/security/run.ts [--only suite,…]`
  on a platform made by `qa/platform.sh`). What somebody who is not a member, or is and wants more, can try against the real
  image; each suite says, check by check, what it saw (`Report`: one line per failure, and a table by suite in the job
  summary). `headers`: every kind of answer against what a hardened interface sends (the policy is **written down in the
  suite**, not read from `security-headers.ts`: when the two disagree, one is wrong), what a cache may keep, no trace of
  the code in an error, HSTS only behind HTTPS, no CORS, the cookies of the sign-in. `sessions`: a cookie nobody issued
  (wrong secret, expired, cut, another salt, a login that does not exist, two with the same name, 8 kB of garbage) is a
  visitor and nothing more, with exactly the answer of the visitor with no cookie, on a page and on an API route. `csrf`: an
  action called from another site, from a sandbox (`null`), or through a plain form of another site, changes nothing,
  and the same call from the platform's own origin works (so that a refusal means something). `feeds`: 300 random links
  give one and the same bare 404; near misses and injections in the link too; a new link revokes the old one at once;
  neither kind of link opens the other's door; a draft never leaves through a feed that must not hold one; text typed
  into an event cannot add a line, a property or an event to the calendar file (every line must be a property the platform
  writes). `uploads`: what the logo accepts and refuses on its bytes (a script as SVG, a page named `.png`, a bomb that
  claims 100000 × 100000 pixels, a file just over 2 MB, a body of 4 MB), who may change it, and what the public route sends
  back for a polyglot (the type of the image, `nosniff`, a policy that forbids everything, no path built from the
  request). `injection`: one corpus of hostile text, stored in every field a page shows (events, roles, names, the audit
  log), put in the address of every page that reads one, and, for the database, in every address; the answers are read
  **as a browser would build them** (jsdom): no handler, no `javascript:` address, no frame or form that the text made,
  no tag as it was typed; nothing changes in the database; a forged `Host` or `X-Forwarded-Host` moves no link and no
  redirect; `callbackUrl` and addresses like `//evil.example` never leave the platform. `limits`: 300 requests at a time of
  each wrong kind, bodies of 1 and 20 MB, headers far too large: no server error, and the platform answers a member
  afterwards; **there is no rate limit** outside the installer (the reverse proxy of the BDE is the place, see
  `docs/en/deployment.md`) and the suite writes down what it accepted. `logs`, last: none of the secrets met during the
  run (the signing secret, the 42 secret, the database password, every calendar link and cookie) is in the logs, and no
  error is there that an attack should not have caused (the framework's own refusals are listed in `REFUSALS`). The
  detectors have unit tests (`detectors.test.ts`: what each must catch and what it must leave alone): a check that cannot
  fail proves nothing. **ZAP** (`zap.sh`, `zap-gate.mjs`, a pinned `ghcr.io/zaproxy/zaproxy`): every night the baseline then
  the active scan, on a pull request with the label the baseline only, signed in as the owner by a cookie the harness forges;
  an alert of medium level or above fails unless it is in `zap-accepted.json` **with its reason** (the unsafe-inline policy,
  documented above, and the forms of server actions, which the `csrf` suite plays), and an accepted entry that no longer
  shows up is reported. The first run of these suites found five defects, each fixed in its own pull request (a malformed
  address, the export's cache header, the logo's policy replaced by the pages', an unreadable `callbackUrl`, a log that
  shouted): see the CHANGELOG. **The attacks are mutation-checked on the image** (`qa/mutations/attacks.json`,
  `qa/mutate-image.mjs`: a guard is broken in a throwaway worktree, an image is built, the attacks must fail): one image build per
  mutation, so it runs in the `mutations` job of `qa.yml` (label `qa-mutations` on a pull request, or by hand), not on a computer. Like
  the other heavy tools (ZAP's active scan included), it is a CI job. A guard that two layers hold (the logo's `nosniff` is written by
  its route **and** by the headers of every address) cannot be broken from one layer: that mutation survives, and is replaced by
  one on the layer whose loss the image shows, the other being held by the unit tests of the route.
- **Browsers** (`qa/browsers/`, the `browsers` job of `qa.yml`: one job per engine; `npx playwright test -c qa/browsers
--project=chromium|firefox|webkit` on a platform made by `qa/platform.sh`). The journeys of the platform in Chromium, Firefox
  and WebKit (Safari's engine), written with Playwright (the older `e2e/` scripts stay on Puppeteer: Playwright is for the new
  suites only). Accounts are the personas, signed in with the forged cookie (`fixtures.ts`: `as('member')` gives a page of a fresh
  browser context); locators are by role and accessible name, so a page that loses an accessible name fails the suite. `public`
  (visitor, pending account, removed member), `member` (calendar buttons, list, filter, calendar file download, theme, phone
  menu, what a member is never shown), `circuit` (a proposer proposes a weekly event, a validator approves it, a member reads
  it; a refusal with a comment; the confirmation dialog's focus, trap and Escape), `calendar` (French, the + of a day, the
  keyboard), `owner` (every page of the board; the logo's file input, preview, upload and reset; a file that is not an image),
  and `watcher` (the watcher itself, see below). **No retry, ever**: a journey that fails now and then is a defect to find (see
  "Browser tests that fail now and then"); `workers: 1`, because the journeys change the one database, and each makes events of
  its own, named after its engine.
  - **Every journey ends by asking what its pages raised** (`fixtures.ts`, a fixture every test uses): an exception, an error
    written to the console, a **violation of the content policy** (the `securitypolicyviolation` event, the same in the three
    engines: Firefox also writes it to the console, Chromium does not), a request that failed otherwise than by being cancelled,
    a 5xx. `watcher.spec.ts` makes a page do each on purpose and checks it is seen: a watcher that sees nothing would let every
    journey pass. Found this way in its first runs: **every page violated the platform's own policy** (Zod's probe for `eval`:
    see "Security headers"), fixed in its own pull request.
  - **What is let through, and why it is narrow.** (1) `Failed to load resource` (Chromium's word for any failed request, which
    the network events say better). (2) How the engines word a fetch that a navigation cancelled (Next.js prefetches the pages
    a link leads to, and the click that comes next cancels the ones still on their way): an error worded like that is let
    through only if a request was really cancelled within 5 s of it, judged at the end of the journey because an engine can
    report the error before the request; and WebKit's rejection of an interrupted `_rsc` prefetch (`…_rsc=… due to access control
checks`), only that exact message, a known behaviour of Next.js's client in Safari that the router should catch. (3)
    Playwright's own tracer reads the images of the page again with `fetch`, which `connect-src 'self'` refuses for the `blob:`
    preview of a file just chosen: let through for that one directive and that one address (no violation without a trace:
    checked). Anything else is a failure. **Never widen these to "the errors that come before a navigation"** (see the
    hydration section).
  - **Traps met writing it.** Role queries skip what is `aria-hidden`, and a dialog hides the page behind it: after "Approve" the
    row vanishes from the tree while the dialog is open, so "the row is gone" is true at once; wait for the real page drawn again
    (rule 2 of "Navigation": the action loads the page, and the loading skeleton has no row either). Code run inside
    `page.evaluate` is exempt from the content policy (the debugging protocol lets evaluation through), so a violation meant to
    test the watcher is asked from a `setTimeout`. The focus of an open dialog passes through guards at its edges: it is polled,
    not read once. A phone starts on the list, not the calendar (no choice made: "the layout adapts to the screen").
  - **Browsers are installed where they run** (`npx playwright install --with-deps <engine>` in the job); the artefacts
    (`test-results/`, `playwright-report/`) are ignored by git, Prettier, ESLint, markdownlint and Docker. The suite compares no
    screenshot (phase 6).
  - **Accessibility** (phase 5: `a11y.spec.ts` and `keyboard.spec.ts`). **axe** (`@axe-core/playwright`, pinned) checks every page
    of the platform against WCAG 2.2 level AA, in **Chromium only** (what it reports is the page's, not the engine's; the
    project is the only one that runs the file, `testIgnore` in `playwright.config.ts`). The pages are **those of the access matrix**
    (`PAGES` in `qa/access/matrix.ts`): a page added to the matrix is checked with nothing to write. Each page is opened as two
    personas (the first who sees it and the one with the most rights, from the matrix's own expectations) in two combinations
    (English, light, computer; French, dark, phone), with the loading skeleton waited out, `<html lang>` and the theme asserted
    (a check on the wrong theme proves nothing) and a title of its own (WCAG 2.4.2). A violation fails with its elements, there
    is **no list of accepted ones**; an exception would be written in the file with its reason, next to the page. The first test
    gives the page what axe is for (a control with no name, pale text, an image with no alternative) and checks it is seen.
    **The keyboard** (all three engines, because they differ most there): the skip link (reached by Tab, or put under the focus
    in WebKit, whose default is not to stop on links), the menus (Enter, arrows, Escape, the focus given back), the phone's
    drawer, a form's first error (focus on the field, message linked), and **every control Tab reaches on six pages shows its
    focus** (outline or ring), plus the menu of the signed-in person. Two limits of the measure, both written in the probe: the
    focus inside a date and time field is drawn by the engine (the field is the active element but not the `:focus-visible` one),
    and WebKit does not stop on links with Tab.
  - **What the first runs found** (each its own pull request, the numbers are in the CHANGELOG): the facts of an event were an
    invalid description list; the button "Make default" was not named with its visible words (and a test now checks every
    control named by `x` / `xLabel`); tables that scroll sideways could not be scrolled by keyboard (`ScrollableTable`); the
    destructive red had 3.8–4:1 on its own tint (a test, `design-tokens.test.ts`, plays the contrast table of the design document
    on the real tokens); the chips of the calendar were 20 px high and a draft was faded below readable contrast; a `<select>` showed
    no focus in Safari (it ignores `box-shadow` there); and **the menu of the signed-in person crashed on opening, in every browser
    and every released version** (a Base UI menu label outside a group, which Base UI refuses only when the menu opens: no test
    opened the menu, nor did any script; `user-menu.test.tsx` and the journey "opens the menu of their name… and signs out" do).
    **A component that only does something when it is opened, hovered or focused is tested opened, hovered or focused.**
- **Visual regression** (`qa/browsers/visual.spec.ts`, the `visual` project of the Playwright config, the `visual` job of `qa.yml`, the
  workflow `qa-visual-references.yml`). 19 pages × a computer and a phone × the light and the dark theme, plus 4 pages in French
  (80 pictures), compared with `toHaveScreenshot` in **Chromium only** (`maxDiffPixelRatio` 0.2 %, animations off, the page
  waited out by `rest.ts`, which axe uses too), on a platform made with `--now 2026-10-16T12:00:00Z`: the page is the same today
  and in a month (checked: a second pass, then a platform made again from nothing, are 80/80 identical). A page of 300 rows is a
  picture of what the screen shows, not of the whole page. A change of look nobody meant is a picture that differs, with the
  reference, the page and the difference kept as an artifact; **a change that was meant is accepted by making the references
  again, which is a commit of pictures that a person reads.**
  - **The references live on the branch `qa/visual-baselines`**, which holds the pictures and a README and nothing else, so that
    pictures never weigh on main or its history. **They are made where they are compared**: `qa visual references` (run by hand, or
    by the label `visual-references` on a pull request of the project, before it is merged so that its own `visual` job passes)
    builds the image, starts the platform, takes the pictures with `--update-snapshots` and commits them with the identity of
    whoever started it. The same page is not drawn pixel for pixel the same by two systems (fonts, anti-aliasing): references made
    on a developer's computer would differ everywhere. The `visual` job fails, with the command to run, when the branch does not
    exist yet; it never passes by comparing with nothing.
  - **Locally**, `QA_VISUAL_DIR` is a folder of your own (default `qa/browsers/.visual-local`, ignored by git): make your own
    references there on your system to see a change of look before the pull request (`--update-snapshots`), then compare.
    They are not the ones of the branch and never will be.
  - **What a failure is**: a token, a class, or a library that draws a control another way, a page that gained or lost a block, a
    string that wraps differently. The question is "did we mean this look?": if yes, make the references again and read the
    pictures that changed in the commit; if no, it is a defect. A picture that differs by itself, run after run, is never
    "retried until it passes": it is a page that depends on something (a date, a random value, an animation) that must be
    fixed or masked in the test, with the reason written.
- **Performance and load** (`qa/perf/`, the `performance` job of `qa.yml`, `performance.spec.ts` of `qa/browsers`). Two tools that are not
  dependencies of the project (they bring hundreds of packages it never ships, so no lockfile, no audit noise), each pinned where it
  is run: **Lighthouse** (`lighthouse@13.5.0` through `npx`, driving the Chrome of Playwright) and **k6** (the image
  `grafana/k6:2.3.0`, on the network of the platform).
  - **Lighthouse** (`lighthouse.ts`, `lighthouse-report.ts`, `budgets.json`). Seven pages (login, dashboard, calendar, an event,
    the event form, the members, the settings), on a phone (Lighthouse's own slow network and processor: what the budgets are
    about) and, for four of them, on a computer; signed-in pages carry the cookie of a persona, written to a file of its own (a
    shell would take a command line apart). Each is held to a **budget**: the four scores (performance, accessibility, best
    practices, SEO), the largest contentful paint, the blocking time, the layout shift, the weight (transferred, scripts) and the
    number of requests. **Each page is run three times and the median run is judged** (`medianRun`: the run with the median performance
    score, whole; on a shared runner the blocking time of one page went from 468 to 712 ms between two runs of the same code, and the
    median of three is what Lighthouse's own continuous-integration tool takes). A budget is a written number: `budgets.json` has defaults (phone), those of the computer, and what a page
    says of its own (`members`, `members:desktop`). The report has no verdict of its own: the budgets are the verdict, and raising
    one is a pull request that says why. The pure parts (what is read of a report, the budgets, the verdict) are
    `lighthouse-report.ts`, unit-tested.
  - **k6** (`load.ts`, `report.ts`, `k6/browse.js`). 20 virtual people for 40 seconds (ramped), a mix weighted like a day of a BDE:
    the calendar and the dashboard most, the event, the list, the heavy pages (300 members, the audit log, the settings) less,
    the login page and the calendar feed that calendar applications fetch by themselves. **Who asks is the personas**, with their forged
    cookies (and the feed link of the member of the dataset). Thresholds are written in the script: almost no request fails
    (0.5 %), what answers is the page that was asked for (a check on the content, because an error page can answer 200), and each
    page has its own limit for 95 % of its answers (`p95`), which `load.ts` prints with the numbers. **The memory of the application
    is measured after the load** (`docker stats` before and after: a limit of 1 GiB, what a small server has to spare): in
    local runs it moved between 520 and 700 MiB over 2 500 requests and did not drift, which is what the limit assumes.
  - **What neither sees** is what a browser does of its own accord: `performance.spec.ts` counts, in Chromium, the prefetches
    Next.js makes (a header marks them). That is how the calendar's 110 prefetch requests (a rendering of an event page by the
    server for each, for a month of 100 events) were seen: Lighthouse showed 141 requests and 645 KiB for the calendar of a
    computer against 30 to 47 for every other page, the load test could not, and a count of prefetches now holds it.
  - **Numbers come from the CI**, not a developer's computer: the budgets and the limits were set from a run on a Windows machine
    with margin, and are meant to be read again against the first runs of the `performance` job (the summary of a run holds the
    table). A budget set tight on a fast machine would only fail on the shared runner.
- **Coverage** (`npm run test:coverage`, `coverage-thresholds.json`, `scripts/coverage-report.mjs`,
  `scripts/coverage-gaps.mjs`, `qa/coverage-plan.md`). The ubuntu job of `ci.yml` runs the unit tests through V8 coverage
  and **fails below a floor**: one for the whole project and one for each area that decides who may do what or what is
  written to the database (`lib/auth`, `permissions`, `roles`, `settings`, `setup`, `events`, `notifications`, `members`,
  `branding`, `updates`, `config`, `app/api`, `docker`), so a drop in one cannot hide behind the others. The floors are
  a **ratchet**: they go up when the tests do (the report in the job summary marks the ones with 2.5 points of room) and
  come down only in a pull request that says why. The measure covers `src/`, `docker/` and `scripts/`, not the
  generated shadcn components, the tools CI runs by itself, or the harness. A line count says what ran, not what was
  checked: the access rules, the series and the roles are also held by mutation checks (see "Conventions"), and
  `qa/coverage-plan.md` lists what the unit tests do not reach and which phase of the campaign does.
- **What a campaign finds** goes through the usual rules: a bug has its own pull request and a test that would have caught
  it; a suite that exposes a bug waits for that pull request or lists the case as an expected failure with its reason,
  never as a silent skip.

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
- **Every destructive or irreversible action asks through `ConfirmDialog`** (`src/components/confirm-dialog.tsx`,
  built on `ui/dialog.tsx`): a dialog centered over the page — never a `<details>`, a popover or a block
  that unfolds under the button (it ends up off screen). Title naming the action and its target, one
  sentence (not repeating the title), a destructive action button with a precise verb, and Cancel;
  `tone="default"` for a reversible change (a role change). The component guarantees focus on Cancel,
  a focus trap, Escape / click outside to cancel, focus returned to the origin (`returnFocusRef` when
  there is no trigger button), and a busy, non-repeatable confirm button while the action runs. From a
  Server Component, `onConfirm` is an inline `'use server'` action. A new module's delete / cancel /
  regenerate buttons use it; see "Confirmations" in `docs/design.md`.
- Every list/table that can be empty renders an empty state (icon-in-muted-circle + title +
  description [+ CTA]) — never a blank card. Every `(app)/` route ships a `loading.tsx` with
  `Skeleton`s shaped like its real content, not a generic spinner.
- Sidebar nav items are keyed by `NavItem['id']` mapped to a Lucide icon in `NAV_ICONS`
  (`src/components/layout/app-shell.tsx`) — a new top-level module extends that type and table,
  it doesn't inline an icon in JSX.

## Conventions

- **Conventional Commits**, atomic commits per logical change.
- **The documentation is part of the product, in two languages, and it is checked.** A user-visible change updates the
  FR and EN pages together (`docs/fr/`, `docs/en/`: same file names, same headings, same images, each page starting
  with a link to its twin). Words are the ones of the interface and of the glossary (`docs/*/glossary.md`): one word,
  one thing. **Every claim is verified against the code** (a doc that lies, even a little, destroys trust: the upgrade
  guide was tried for real from v1.0.0, and doing so found a real bug in `restore.sh`). Three gates, all in CI: the
  `docs` job (`npm run docs:check` = `scripts/check-docs.mjs`: internal links, anchors, images' alternative text, FR/EN
  twins; `npm run lint:md` = markdownlint on top of Prettier), required on `main`; and `.github/workflows/links.yml`,
  which checks the external links every week (a network error must not stop a pull request). The screenshots are
  taken from the real production image by `scripts/docs-screenshots.mjs` (demo data, light theme, both languages,
  installer included); redo them when the interface changes. `docs/architecture.md` and `docs/design.md` are the
  technical references and stay English only.
- **Every change goes through a branch and a pull request — never a push to `main`.** `main` is protected
  (the five checks `ci (ubuntu-latest)`, `ci (windows-latest)`, `docker image`, `migrations` and `docs` are required,
  no force push, no deletion, and it applies to administrators too). The routine: `git switch -c <type>/<topic>`,
  commit, `git push -u origin <branch>`, `gh pr create`, wait for the checks (`gh pr checks --watch`, **without**
  `--required`), then merge it once they are green (`gh pr merge --squash --delete-branch`: the author merges their own
  pull request) and bring the local `main` up to date (`git switch main && git pull`). Never `--force`,
  never `--admin`, never bypass a red check: fix it on the branch. **Wait for every job the pull request started, required or not**
  (the stress workflow `e2e-stress.yml` runs on a pull request that touches it, and its failures are real ones: a flaky
  browser script is found there, see "Browser tests that fail now and then"). "The required checks passed" is not "the pull
  request is green": `gh pr checks` must show nothing pending and nothing failed. Dependabot proposes minor and patch updates only (`ignore` in `.github/dependabot.yml`); a major
  version is a pull request of its own.
- **Mutation checks never touch the working tree.** Breaking a rule on purpose to see a test fail (what the "mutation-checked"
  tests of this document mean) runs in a **dedicated `git worktree`** (or a copy of the project) that is thrown away
  afterwards, never in the folder being worked in, and **never restores a file with `git checkout` or `git restore`**:
  those throw away every uncommitted change of the file, not only the mutation (it happened: a script that put a file back
  after each mutation also put back two fixes that were not committed yet). In the worktree the mutation is written,
  the tests run, and the worktree is removed or reset as a whole. `node qa/mutate.mjs qa/mutations/<list>.json` does exactly
  that (a list is `[name, file, text to break, replacement, [test files]]`; **commit first**: the worktree is made from
  `HEAD`), and the lists of the campaign are kept in `qa/mutations/` so that a "mutation-checked" claim can be played again.
- **No `any`** (`@typescript-eslint/no-explicit-any` is an error, not a warning).
- Cross-platform: no `&&`/`||`/`$VAR`/`rm -rf`/`cp` in npm scripts — use `cross-env`, `rimraf`,
  or plain Node. LF line endings are enforced by `.gitattributes`. The exception is the server-side
  operations scripts (`scripts/backup.sh`, `restore.sh`): the server only has Docker, so they are
  POSIX `sh` (kept `shellcheck -s sh` clean, run from Git Bash/WSL on Windows, `MSYS_NO_PATHCONV=1`
  inside because Git Bash rewrites `/app/...` arguments).
- All user-facing strings go through next-intl (`messages/fr.json` + `en.json`) — no hardcoded
  UI text in components.
- **Every page has its own title** (WCAG 2.4.2): `export const generateMetadata = pageTitle('namespace', 'key');`
  (`lib/page-title.ts`); the root layout adds " · BDE name". A new page without it shows only the BDE name.
- **A new module's key goes in `KNOWN_MODULE_KEYS`** (`src/config/schema.ts`), or `modules.enabled` warns about it
  at start-up (that warning is what catches a typo). Node ≥ 22 (`engines`); after touching `package-lock.json`
  check it with `npx -y npm@10 ci --dry-run` (CI runs npm 10).
- shadcn/ui components in `src/components/ui/` are excluded from ESLint/Prettier (generated
  code) — don't hand-edit; re-run `npx shadcn add <component>` instead.
- `docker-compose.dev.yml` installs with `npm install --no-save` (never `npm install`, which rewrites
  `package-lock.json` with the container's npm, and never `npm ci`, which deletes `node_modules`: a mount point
  there), then runs `prisma db push --accept-data-loss` on start (so the dev database gets neither
  the data conversions nor the CHECK / partial index of the migrations: `seed:demo` recreates the roles and
  demo accounts) (Prisma refuses to
  add a unique index to an existing table non-interactively); production applies the committed
  migrations with `prisma migrate deploy`. A new model therefore needs **both** the schema change and
  a migration (generate the SQL without touching a database via `prisma migrate diff
--from-schema <old> --to-schema prisma/schema.prisma --script`).
- Run `npm run lint`, `npm run typecheck`, `npm run format`, and `npm run test` before
  considering a change done; `npm run build` is the closest thing to a full integration check
  since most pages are `force-dynamic` and won't otherwise get exercised by `next dev` alone.
