# Architecture and conventions

Reference document for working on BDE_Network: how the project is organised, the rules that hold it
together and the pitfalls already met. Read it before making structural changes. The contributor
guide (`docs/contributing-guide.md`) covers setting up a development environment.

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
      me/export/route.ts                 self-service RGPD data export
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
    theme-provider.tsx, theme-toggle.tsx
  config/                  bde.config.yml loader + Zod schema (src/config/index.ts, schema.ts)
  i18n/                    next-intl routing/navigation/request config
  lib/
    auth/                  NextAuth config + 42 OAuth provider
    notifications/         NotificationAdapter + email/discord/slack/none adapters
    events/                events module domain: time, recurrence, ics, access, queries, actions
                           helpers, notifications, reminders, scheduler (see "Events module")
    permissions/           registry (the list of permissions) + resolution and `can()`
    roles/                 escalation rules (guards), input validation, transactional operations, `execute`
    settings/              the platform's settings in the database: runtime cache, sealing (AES-GCM), store + import
    roles/view.ts          what pages need to show the right choices (actor from a session, role facts) — display only
    audit-log.ts, account-label.ts, health.ts, prisma.ts, color.ts, utils.ts
  types/next-auth.d.ts     Session/User/JWT module augmentation
  test/                    session fixtures, in-memory roles database, migration tests
  middleware.ts             next-intl locale routing, Node.js runtime (not Edge — see below)
prisma/
  schema.prisma, seed.ts (+ seed-events.ts), migrations/ (20261005180000_custom_roles converts the old roles)
scripts/
  backup.sh, restore.sh     POSIX sh, need only Docker on the server (no Node): one tar.gz with the database dump
  audit-prod.mjs            CI gate on production dependency advisories (+ audit-allowlist.json)
setup/                      the interactive setup assistant (see "Setup assistant"): its own Dockerfile, image and tests
docker-compose.setup.yml    the one command that runs it
docker/
  prisma.config.mjs         Prisma config used by the production image to run `migrate deploy`
  master-secrets.mjs        the keys of the `secrets` volume (session secret, settings key), created once
  start.mjs                 the image's command: migrations, then the application, and the explanation page
                            when either cannot start (see "A startup problem is shown, not looped")
  startup-problems.mjs      its pure parts: Prisma failure classifier, redaction, database address, the page
messages/
  fr.json, en.json          next-intl message catalogs
docs/                        installation (two paths: the board / the technical person), configuration, user guide, notifications,
                             roles, events, contributing, deployment, design; images/{en,fr}/ = README screenshots (WebP)
README.md / README.fr.md     the storefront, in English and French: keep them in step, promise nothing that does not exist
SECURITY.md                  private vulnerability reporting; .github/ has issue forms and the PR template
```

## Data model (Prisma)

`User`, `UserStatus` (enum), `Role`, `AuditLog`, `PlatformSettings` (see "Settings in the database"), plus the events module's `Event`,
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
- **`signIn` callback** (`signInCallback` in `src/lib/auth/callbacks.ts`, wired in `index.ts`): rejects if the user's primary 42 campus isn't
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
'nodejs' }`), stable since Next.js 15.5. It doesn't read `bde.config.yml`: the interface
  language comes from the URL (`/fr`, `/en`; the default `"fr"` is hardcoded in `i18n/routing.ts`, which
  client code imports and so cannot read the config). `bde.defaultLocale` is **the language of outgoing
  notifications**, nothing else — wiring it into routing was judged not worth a config read in the
  middleware for a visitor whose browser language is neither French nor English.

## Notifications

- `src/lib/notifications/`: `NotificationAdapter` interface, adapters for email (nodemailer/SMTP),
  Discord webhook, Slack webhook, and a no-op `none`. `notify(event, message)` picks the adapter
  from the channel configured per event in `bde.config.yml`'s `notifications` section. The events
  module sends `eventConfirmed` / `eventReminder`; `src/lib/members/notifications.ts` sends
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
- **Discord cards** (`docs/notifications.md`). On the `discord` channel a notification is an _embed_, built
  next to what it says (`events/discord-embed.ts`, `members/discord-embed.ts`) on the Discord-specific parts
  in `notifications/discord-embed.ts` (colours, `<t:…>` date markup, `fitEmbed` = every limit of Discord:
  256/4096/1024/25 fields/6000 in total, cut with “…”). `withDiscordCard` (`discord-card.ts`) adds the card to
  a message **only when the event's channel is Discord** — email and Slack never build one and keep their
  plain `subject`/`body`, which Discord also falls back to. The adapter neutralizes **every text of the card**
  (`neutralizeEmbedForDiscord`) and always sends `allowed_mentions: { parse: [] }`. The sender (`sender.ts`)
  is `bde.name` + an avatar Discord must be able to fetch: `bde.logoPath` if it is a PNG/JPEG/GIF/WebP, else
  `public/logo.png`, only when `APP_URL` is a public address (not localhost / a private range) **and** a HEAD
  request shows an image (cached 10 min); otherwise name only, never a broken picture. A new notification
  that should be a card gets a builder + a `withDiscordCard` call; who did an action is passed by the action
  (`ctx.actor.login`), the row being deleted before the message goes out.
- **Slack cards** (`docs/notifications.md`, Block Kit). Built like the Discord ones (`events/slack-blocks.ts`,
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
- **Designed e-mails** (`docs/notifications.md`). On the `email` channel a notification carries an
  `EmailContent` (`html` + `text` + optional `.ics`) next to its plain `subject`/`body`: built by
  `events/email.ts` / `members/email.ts` from the one layout `notifications/email-layout.ts` (`renderEmail`, a
  pure function of a model) and added by `withEmailContent` **only when the event's channel is e-mail**. The
  layout is for the worst clients, not browsers: tables, inline styles, `bgcolor`, a VML button for desktop
  Outlook, a hidden preheader, a `<style>` only for dark mode / narrow screens. **Everything inserted goes
  through `escapeHtml` / `httpUrl` / `normalizeHex` in that file** (never concatenate a member's text into the
  HTML elsewhere). The logo is `resolveLogoUrl(…, { requirePublic: false })` (a mail client loads it itself).
  A confirmation attaches the `.ics` through nodemailer's `icalEvent` (every occurrence to come, same UIDs as the
  feeds); a reminder does not. `memberRemoved` never sends an e-mail. In development `docker-compose.dev.yml`
  points `SMTP_*` at Mailpit (http://localhost:8025) unless `DEV_SMTP_*` say otherwise.
- **There is no file storage.** A local-disk adapter and a public `/api/files/[...key]` route existed
  with nothing writing to them (it would have been a stored XSS the day an upload existed: no
  authentication, SVG served without `nosniff`); both were removed, with the `uploads` volume, rather
  than left as dead code. The day a feature needs uploads, build it with the feature: authenticated
  access, a type allow-list, `nosniff`, a size limit, an entry in `scripts/backup.sh`.

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

## Setup assistant (`setup/`)

An interactive questionnaire that lets a non-technical BDE install the platform **with Docker as the only
prerequisite**: `docker compose -f docker-compose.setup.yml run --rm --build setup`, identical on Windows,
Linux and macOS. It writes `.env` and `bde.config.yml`, and offers to start the platform. Guide for users:
`docs/installation.md`.

- **Its own image** (`setup/Dockerfile`, `node:22-alpine` + the Docker CLI and compose plugin), run by tsx.
  It installs only zod, js-yaml, nodemailer and tsx, **at the versions of the platform's `package-lock.json`**
  (`setup/image.test.ts` keeps them equal), and copies the platform's own `src/config/schema.ts`: what it writes
  is validated with the schema the platform uses at start-up (`renderConfig`), so it can never write a
  configuration the platform refuses. `setup/Dockerfile.dockerignore` lets only what it copies into the build.
- **Everything is collected in memory and written once, at the end**, after the summary is confirmed
  (`writeFiles`: previous files copied to `.setup-backups/<date>/`, new ones written to temporary names then
  renamed, owner of the project folder restored on Linux). A Ctrl+C or a closed input therefore never leaves a
  half-written file. `.setup-backups/` holds secrets and is ignored by git and by the platform image.
- **Re-runnable**: `readExisting` + `defaultsFrom` turn the current `.env` and `bde.config.yml` into the defaults of
  every question; the shipped template (owner `votre-login-42`) counts as "nothing decided". `renderEnv` changes
  the lines of the keys it manages in place and leaves every other line; `renderConfig` carries over what it
  does not ask (logo, contact address, other modules, event categories). The session secret and the database
  password are **kept** (changing the password would lock the existing database out).
- **Testable by construction**: the questions go through a `LineReader` (a terminal in production, a script in the
  tests), the network through an injected `fetch`, mail through an injected transport, Docker through an injected
  `Runner`. `setup/test-helpers.ts` has the scripted reader and a pretend 42 API. Messages are in `messages.ts`,
  French and English with the same keys (a test checks it, and that none is unused).
- **No secret on screen or in a log**: secrets are typed with echo muted (the default is never shown), the summary
  shows none, errors describe a failure by its code and strip URLs and the secrets they might hold (`describe` in
  `notify-test.ts`), the 42 secret only travels in the body of the token request.
- **The 42 API** (`fortytwo.ts`): client-credentials token to verify the application, `/v2/campus` for the list
  (and the time zone of the campus), `/v2/users/<login>` to check an owner; 2 requests a second are respected,
  a 429 is waited out. Without access, the assistant says so and goes on by hand.
- **Starting the platform from inside the assistant** (`docker.ts`): the container uses the host's Docker through
  the socket and starts `docker compose up --build -d` from a **sibling container of the same image that mounts
  the project at its host path** (the compose file mounts `./bde.config.yml`, and the daemon reads host paths;
  `C:\...` becomes `/c/...`). The platform's compose project is the folder's name (or `COMPOSE_PROJECT_NAME` of
  `.env`); the assistant has a project of its own (`name:` in `docker-compose.setup.yml`) so that compose does not
  call the platform's containers orphans. It is optional: if anything is missing, the assistant prints the command.
- Tested for real from a fresh clone on Windows (PowerShell) and in Linux (WSL), with the real 42 API; a PTY run
  checks the masking of secrets and Ctrl+C. The CI builds the image and starts it with no answer.

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
- **bde.config.yml is never bind-mounted; it is the seed of an import.** `docker-compose.yml` has no volume for
  it: a file mount is resolved by the Docker **daemon**, on its side, with the rights of the container's user. On a
  rootless daemon, a remote one, or a home on a network/FUSE share, the file is either not visible (the daemon
  creates an empty directory) or visible but unreadable by the app's uid 1001 (a `chmod 644` changes nothing), and
  the app used to report "introuvable" for every one of those. The file now travels in the **build context**, which
  the docker client sends itself with the user's own rights, through the `builder` stage (`COPY --from=builder`); a
  missing file is replaced there by `bde.config.example.yml` (the template: "nothing decided"). **The build does not
  read it** (`next.config.ts` no longer validates it: a broken file must not stop a rebuild once the database is the
  source), and **the build output must never depend on the configuration** (the only prerendered page,
  `/_not-found`, holds none: keep it so). At runtime the file is read only by an installation that has not been
  imported yet (`src/config/index.ts`: `describeReadFailure` tells a missing file, a directory in its place, an
  unreadable file, an empty one and an invalid one apart, with the exact path checked). Reproduced and fixed against
  a rootless Docker-in-Docker (`docker:dind-rootless`, project mounted from a client container so the daemon cannot
  see it). The commands that read what the container sees are under "Problèmes fréquents" in
  `docs/installation.md`.
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
  reaches it unless the operator opts out (`APP_BIND=0.0.0.0`, documented in `docs/deployment.md`). **PostgreSQL
  publishes no port** (only the app, on the compose network, reaches it); `docker-compose.dev.yml` still
  publishes 5432 on 127.0.0.1 for `npm run dev` outside Docker.
- **Security headers** (`src/lib/security-headers.ts`, wired in `next.config.ts`): CSP (production
  only; `'unsafe-inline'` is needed by Next hydration and next-themes; no `upgrade-insecure-requests`
  so an instance without an HTTPS proxy still works; profile pictures from `cdn.intra.42.fr`),
  nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, and HSTS only when the request came
  with `X-Forwarded-Proto: https`. A new external image/script host must be added to the CSP.
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
- **Every change goes through a branch and a pull request — never a push to `main`.** `main` is protected
  (the four checks `ci (ubuntu-latest)`, `ci (windows-latest)`, `docker image` and `migrations` are required,
  no force push, no deletion, and it applies to administrators too). The routine: `git switch -c <type>/<topic>`,
  commit, `git push -u origin <branch>`, `gh pr create`, wait for the checks (`gh pr checks --watch`),
  then merge it once they are green (`gh pr merge --squash --delete-branch`: the author merges their own
  pull request) and bring the local `main` up to date (`git switch main && git pull`). Never `--force`,
  never `--admin`, never bypass a red check: fix it on the branch. Dependabot proposes minor and patch updates only (`ignore` in `.github/dependabot.yml`); a major
  version is a pull request of its own.
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
