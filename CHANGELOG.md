# Changelog

All notable changes to this project are written here, in English. Format based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Attacks on the real image, every night**: headers and policy of every kind of answer, forged and expired cookies, actions
  called from another site, calendar links (300 guesses, near misses, injections, revocation), trapped logo uploads (a script as
  SVG, a bomb that claims 100000 × 100000 pixels, a polyglot), a corpus of hostile text in every field and every address (read
  as a browser would build the page), forged `Host` headers and open redirects, floods and oversized bodies, and the logs
  afterwards (no secret, no error an attack should not cause); then OWASP ZAP signed in as the owner, baseline and active scan.
  What it found has its own entries under _Fixed_ and _Changed_; the platform has no rate limit of its own outside the installer
  (the reverse proxy is the place), which the suite writes down. Run it with `sh qa/platform.sh up` then
  `npx tsx qa/security/run.ts`.
- **Static security checks on every pull request**: the rules of the project as code (a setting read from the environment,
  an unsafe call, a link that does not go through the i18n link, a cookie that is not HttpOnly, a secret in a log…:
  Semgrep), the whole history read for secrets (gitleaks), known vulnerabilities of the lockfile and the Dockerfile
  (Trivy), what a pull request adds to the dependencies (dependency review), and CodeQL on the code and on the
  workflows, whose serious alerts stop the pull request. The production image is also scanned every night. Nothing
  changes for a platform that runs.
- **An exhaustive access matrix**, played against the real image every night: every page, API route and server action
  (all 73 entry points of the image) as each of nine profiles (visitor, account waiting for approval, member, proposer,
  validator, custom role, Admin, owner, removed member whose cookie is still valid), with the events module on and off:
  about 1,100 cells per variant. A refusal must show no content and carry no data of anybody, a refused action must change
  nothing in the database, and what is allowed must go through and change exactly what it should (the audit log
  included). A new page, route or action fails the tests until it is in the matrix. It changes nothing for a platform
  that runs.
- **Test coverage is measured, and its floors are enforced** in CI (`npm run test:coverage`): 94 % of the statements and 90 %
  of the branches today, with a floor of its own for every area that decides who may do what or what is written to the
  database, and a report in the summary of the job. Tests were added for what had none (the choice of the channel of a
  notification, the installation of the platform, the privacy policy and the waiting page, the arguments of a crafted
  request to the members' actions, the reminder loop when a tick is slow or fails, and the inspector of the logo on
  hostile files). Nothing changes for a platform that runs.
- **A quality harness (`qa/`)** for the campaign that checks the platform before real BDEs rely on it: nine personas (visitor,
  pending account, member, proposer, validator, custom role, Admin, owner, removed member), a deterministic dataset of two
  school years (about 300 members, 600 events), the invariants every database must satisfy (tested against corruption), a
  script that starts the production image with all of this, and a `qa` workflow (nightly, on demand, or on a pull request
  labelled `full-qa`). It changes nothing for a platform that runs; see the
  [contributor guide](docs/en/contributing.md#the-quality-campaign).
- **Repeat rules, like a calendar's.** An event can now repeat **every day, every weekday, every week, every month or
  every year**, and the **Custom…** choice builds the rest: every N days, weeks, months or years, on the days of the week
  you tick (_every 2 weeks on Monday and Wednesday_), on a day of the month (_the 10th_, _the 2nd Saturday_, _the last
  Friday_, _the last day of the month_). A series ends **on a date** or **after a number of times** (up to 400 dates for
  one event). The usual choices are worded from the start date typed, and under the fields a **preview** says the rule in
  one sentence, lists the next three dates and counts them before anything is saved; if the first date does not fit the
  rule (a Saturday, repeated on Mondays), it moves to the first one that does, and the preview says so. A day a month
  lacks is its last day, the hour does not move at a change of clock, and weeks start on Monday. The same sentence is on the
  page of the event, in the proposals to validate and in the notifications. Cutting a series ("this one and the following")
  shares a series that ends after N dates between its two parts, and the form of a later date says how many are left. See
  the [events guide](docs/en/events.md#events-that-repeat).
- **`e2e/repeat.mjs`**, run by CI and by the stress workflow: a usual choice, a custom rule (every 2 weeks on Monday and
  Wednesday, 10 times), the preview, a first date that moves, the limit of an event, a series cut in two and the rule of a
  series edited, in both languages.
- **Proposing and validating events.** Some roles (an "Events team") can now **propose** events without being able to
  publish them; other roles **validate**. A proposal is an event with a new status, **Awaiting validation**, which only
  its author and those who validate can see. Validators get a **To validate** page, counted in the menu, where they
  **approve** (the event is published and the members are notified, as when confirming) or **refuse** with a required
  **comment**; the author reads the comment on the event and proposes it again after editing it. A proposer edits and
  deletes only their own events that are **not published**, and never a published one: the page explains why instead of
  offering **Edit**, so a published event never leaves the calendar without a validator doing it. Three notifications
  (`eventProposed`, `eventApproved`, `eventRefused`, off by default, with the same cards on Discord and Slack and the
  same designed e-mail as the others) tell the validators of a proposal and the author of the answer, with the comment of
  a refusal. Every proposal, withdrawal, approval and refusal is in the audit log. The rights of roles follow the usual
  escalation rules: somebody who only proposes cannot hand out the right to validate. See the
  [events guide](docs/en/events.md#proposing-and-validating-events).
- **`e2e/review.mjs`**, run by CI and by the stress workflow: a proposer proposes, a validator finds the proposal counted
  in the menu, approves one and refuses another with a comment that its author reads, in both languages, and what a
  proposer and a member cannot see or do.
- **`ConfirmDialog` can ask for a text** (the comment of a refusal), and a menu entry can show a counter.
- **Create an event from the calendar.** On a computer, a **+** appears in the corner of a day when it is hovered or
  reached with the keyboard (always shown on a touch screen); on a phone, tapping a day shows its events as before, with
  an **Add on this day** button. Both open the creation form on that day, from 6 pm to 8 pm in the BDE's time zone
  (**Cancel** comes back to that day). Only those who can create events see them, and the form and the action check it
  again on the server. The new browser test clicks them on a computer-sized and a phone-sized screen, in both languages,
  and checks that a member is offered nothing.

### Fixed

- **The export of one's own data is never kept by a cache** (`Cache-Control: private, no-store`, on the answer and on the
  refusal): it holds all the personal data of a member, and a proxy in front of the platform could otherwise keep it.
  Found by the attacks of the quality campaign.
- **An address whose percent-encoding is malformed (`%ff`, a lone `%`, and `%25` followed by something that is no longer valid
  once decoded, like `/fr/x%25y`) is answered with a 400** instead of a 500 and an error in the logs: Next.js fails while it
  reads the parameters of the route, for a request that is simply wrong (a page is decoded twice, an API route once).
  Found by the attacks of the quality campaign; nothing was ever disclosed.
- **The logo is served with the strict policy its route writes** (`default-src 'none'; sandbox`). The policy of the pages,
  set for every address by `next.config.ts`, replaced it, so the logo (a file anybody can open, whose bytes were uploaded)
  was sent with a policy that lets scripts run. Nothing could be exploited (the type is the image's, and `nosniff` keeps a
  browser from taking it for a page), but the second line of defence that was written did not exist. The policy of the pages
  now leaves `/api/logo` out. Found by the attacks of the quality campaign.
- **The refusal of the logo route (404) carries the same strict policy and `nosniff`** as the logo itself: leaving the policy
  of the pages out of that route had left its refusals without any policy. Nothing could be exploited (the body is empty), but
  every answer is meant to carry one. Found by the attacks of the quality campaign.
- **A sign-in address with a `callbackUrl` that Auth.js cannot read (`javascript:…`) is no longer a server error.** On
  `/api/auth/callback/42-school` it answered a 500 and logged an error for a request that is simply wrong; the unreadable
  value is now dropped, as if the visitor had not given one. Where a readable one leads is unchanged (Auth.js only follows an
  address of the platform). Found by the attacks of the quality campaign.

### Security

- **The image applies the security updates of its operating system when it is built** (`apk upgrade`), and CI scans the image
  for known vulnerabilities (Trivy: HIGH and CRITICAL with a fix available fail the build; the two that are accepted, in
  development tools of Prisma that the platform never runs, are in `.trivyignore` with their reason). The scan found that the
  image shipped OpenSSL 3.5.7 of Alpine, which has a fix for CVE-2026-14456 (a denial of service of a QUIC server, which
  nothing in the platform runs: no member could reach it, but a fix that exists must be in the image).

### Changed

- **A refused sign-in request is one line in the logs, not an error with a stack trace.** Auth.js wrote an error for every
  cookie it could not read (expired, forged, or signed with a secret that has since changed: every member's old cookie),
  every form without its CSRF token and every callback address it could not parse, so a script could fill the logs and a
  change of secret made them shout. Those five kinds are now a `[auth] <kind>: request refused` warning; every other error
  (42 failing, the database, a callback that throws) keeps its complete report. Found by the attacks of the quality
  campaign (359 stack traces for one run).

- **A series is a rule, stored in one column (`Event.repeat`)** instead of one of three words and a day kept apart
  (`recurrence`, `monthlyDay`, which are dropped with their type). The update converts every series by itself, and
  **no date moves**: the identifier of every date in the calendar files stays the same (checked to the millisecond on
  thousands of series, and on a real PostgreSQL), the update makes its safety copy first like any update that changes the
  database. **An event now holds 400 dates at most** (it was 200: a series that long is cut in two). A fork that reads
  `Event.recurrence` or `Event.monthlyDay` in its own code must read `Event.repeat`.
- The **Repeats** line of the e-mails, the Discord and Slack cards and the reminders now says the whole rule (_Every 2
  weeks on Monday and Wednesday, 10 times_) instead of a frequency and an end date.
- The demo data has two series that use the new rules: a basketball training (every 2 weeks on Monday and Wednesday, 10
  times) and a monthly café (the 2nd Tuesday, 6 times).
- **The right to manage events is split in two: `events.propose` and `events.validate`** (`events.manage` no longer
  exists). The update converts the roles by itself: every role that could manage events can now validate them, which
  includes proposing and viewing, so nobody loses anything. The converted roles are listed in an audit log entry
  (`role.migrate`), and the update makes its safety copy first like any update that changes the database. A role that
  only had to view events is unchanged. A fork that checks `events.manage` in its own code must check `events.validate`.
- The day-before reminder falls back, when nobody is in charge, on the owners and the members who can **validate** events
  (it was those who could manage them).
- The demo data has an **Events team** role, an account that only proposes (`demo-member3`), and two events it proposed:
  one waits for validation, one was refused.

## [1.2.0] - 2026-10-15

### Changed

- **Next.js 16.4.1** (it was 15.5.27), webpack kept as the bundler. Next.js 15.5 carries a React with a hydration bug:
  on a slow connection, about one page load in seven (17 in 120 in our measure) made the browser throw the server's HTML
  away and draw the page again, with a dozen errors in the console; the page still came out complete, after a flash. It
  is fixed in the React of Next.js 16 (0 in 120 under the same conditions) and will not be fixed in 15.5. The move changes
  no behavior: `src/middleware.ts` is now `src/proxy.ts` (Next.js 16's name for it), and four effects of the interface
  were rewritten the way the new React rules ask (the choice of a dialog, the logo's preview, the address the browser is
  on, the new-version banner).

### Added

- **`e2e/hydration.mjs`**, run by CI: two pages are loaded 20 times each on a slow connection, and any page error fails.
  It fails on Next.js 15.5 and passes on 16.
- **An `e2e stress` workflow** (Actions → e2e stress): each browser script is played 20 times on three platforms, with
  the browser in a different time zone each round, and the evidence of every failure is kept (in which document the
  error came, from which script, the HTML the browser drew against the HTML the server sent).
- **A banner tells the owners when a new version is published.** On the dashboard and on the Settings page, owners (and
  only owners) see the new version, what it is about, a link to its notes and the two commands that update it
  (`git pull`, then `docker compose up -d`), which they can copy; **Hide until the next version** hides it in that
  browser. Nothing is updated by itself: the application has no control over Docker. The platform learns it by asking
  GitHub for the project's latest release (a plain request that carries nothing about the BDE or its members, made
  after the page is shown, answered from a cache of six hours, never slowing a page down), and only reads a published
  release of the project. The **New versions** section of Settings (`updates.check` in the configuration, on by
  default, audited) turns it off, and then the platform asks nobody. The documentation says what leaves the server.

## [1.1.0] - 2026-10-15

### Added

- **Browser installation.** `docker compose up`, open the address, and a page guides you step by step to the end, in
  English or French, with a progress bar and a Back button: name, color, language, public address, 42 OAuth
  application (step by step, redirect address to copy, **credentials checked right away with the 42 API**),
  **campuses chosen from the list of 42 with a search**, **owners checked** with 42, Events module, notifications
  with a **test message** (Discord, Slack, email), summary. No configuration file, no `.env`. The secrets entered
  never go back to the browser and are encrypted in the database.
- **Installer protection**: as long as the platform is not installed, the page only opens with a **one-time code**
  (`K7QM-4XPD`) that the server writes to its logs, in a box that is easy to see in the `docker compose up`
  terminal. New at every start, a progressive lock after 5 wrong tries, a 2-hour session (`HttpOnly`,
  `SameSite=Strict` cookie). The rest of the site answers "not installed" and **the installer disappears for good**
  once finished.
- **The platform's settings live in its database** (`PlatformSettings`), instead of two files read at start. At
  the first start after the update, `bde.config.yml` and `.env`, if they are complete, are **copied into the
  database** (nothing to do): the secrets (the 42 application's key, the SMTP password, webhooks) are **encrypted**
  there (AES-256-GCM) with a key that is not in the database. From then on the database is the source of truth;
  `BDE_REIMPORT=1` replaces the settings with the content of the files (files-driven deployments).
- **`secrets` Docker volume**: the session key, the encryption key and the PostgreSQL password are **generated by
  themselves** once. `docker compose up` **no longer needs a `.env`** (an existing installation keeps its
  `AUTH_SECRET` and `POSTGRES_PASSWORD`, taken into the volume). **It must be backed up**: `scripts/backup.sh` now
  makes two archives (`bde-backup-*` for the database, `bde-secrets-*` for the keys, to keep in two different
  places) and `scripts/restore.sh --secrets` puts the keys back; without them, the secrets of a database restored
  on another server can no longer be decrypted.
- **"Settings" page** (owners only): everything the installer asks (name, color, message language, address, 42
  application, campuses, owners, modules, notifications with a test message) can be changed from the platform,
  section by section. Each save is validated, written with its **audit log** entry in a single transaction, then
  applied **at once** (no restart, no rebuild); secrets never go back to the browser and the log only says
  "changed". The 42 application is checked with 42 **before** being saved. **Owners are managed here**
  (confirmation, never oneself, never zero owners, login checked on the intra): they no longer come only from
  `bde.config.yml`. The Events module's reminders start and stop with the module. A reminder to back up the
  `secrets` volume stays visible at the top of the page. When 42 refuses the application, the sign-in page asks to
  warn an owner, and a signed-in owner sees a banner with a link to the page. `BDE_REIMPORT=settings` puts only the
  values of `.env` back into the settings if nobody can sign in any more.
- **Logo uploaded from Settings.** An owner uploads the BDE's image (PNG, JPEG, GIF or WebP, 2 MB at most, 64 to
  4096 pixels; **no SVG**): the format is read from the file's bytes, never from its name. It is kept in a new
  `uploads` Docker volume, served by `/api/logo` (public, `nosniff`, a content policy that forbids everything) and
  used at once in the menu, on the sign-in page and in Discord, Slack and email messages. A new logo has a new
  address: nothing shows the old one. A button goes back to the logo that ships with the platform.
  `scripts/backup.sh` and `scripts/restore.sh` back up and restore the logo with the database archive.
- **Event categories and the reminder hour can be edited in Settings** (Events module on): rename, recolor, add,
  remove. A category that events still use is only removed by choosing the one to move them to (done in the same
  transaction, written to the audit log with the number of events); at least one always stays. The reminder hour
  applies at the loop's next pass, with no restart.
- **Contact address** (privacy page): asked by the installer (optional) and editable in Settings.
- **FR/EN language switcher** in the platform's menu and on public pages (sign-in, privacy, waiting, error): the page
  stays the same and the choice is remembered.
- **Complete, bilingual documentation** in `docs/en/` and `docs/fr/` (the same pages in both languages), with an
  index by type of reader (non-technical BDE president, person who installs, contributor): a glossary, a FAQ, a
  troubleshooting page, and an **upgrade guide** (backup, command, checks, rolling back) that was tried for real from
  version 1.0.0. The contributor guide has Mermaid diagrams of the architecture and of the sign-in. All screenshots
  were retaken from the real application (production image, demo data, light theme, in both languages, installer and
  Settings included): `docs/images/{en,fr}/`.
- **`README.md` / `README.fr.md`, `CONTRIBUTING.md` / `CONTRIBUTING.fr.md` and `CODE_OF_CONDUCT.md` /
  `CODE_OF_CONDUCT.fr.md`**: in English and in French, linked to each other.
- **CI for the documentation**: a `docs` job, required on `main` (internal links and anchors, images' alternative
  text, French and English pages that are twins, markdownlint on top of Prettier), and a weekly check of external
  links (`.github/workflows/links.yml`, which opens an issue when a link breaks).
- **Published images, and an update in two commands.** Each version is now published as an image
  (`ghcr.io/edouardbautz/bde_network:X.Y.Z`, for amd64 and arm64), built and tested by a workflow that starts it on a
  real PostgreSQL before naming it. `docker-compose.yml` names the image of one version, so installing is
  `docker compose up` (a download of a minute or two instead of a build of several) and updating is `git pull`, then
  `docker compose up -d`, the same for everybody. Going back to an older version of the folder goes back to its image.
  The image carries its provenance and its SBOM. `BDE_VERSION` in `.env` pins a version.
- **`docker-compose.build.yml`** builds the image from the folder instead (contributors, a modified fork, and a
  platform driven by files that has not been copied into its database yet: the published image holds the template
  `bde.config.yml`, not yours). The messages and pages that told files-driven operators to rebuild name this command.
- **The platform keeps a copy of its database before applying an update, and puts it back if the update fails.** When a
  new version has migrations to apply, the start-up command first dumps the database to the new `backups` volume
  (`pre-update_<date>_v<version>.sql.gz`: the 5 most recent kept, nothing older than 90 days, the newest never deleted;
  none when nothing is applied). If a migration fails, the copy is put back (the schema is replaced, in one transaction),
  the result is checked (same migrations, same tables), the platform stays stopped and its page says so, in French and in
  English, with the name of the copy and the way back. If the copy cannot be made the update is not applied, and the page
  says how to go on (`BDE_SKIP_BACKUP=1`). `./scripts/restore.sh --pre-update` restores a copy by hand.
- **A mismatch is explained, not looped on.** The page now says: an image older than `docker-compose.yml` (what an old
  image kept after a `git pull` gave: "Connection url is empty", in a loop), a compose file older than the image, a
  database newer than the image, a database left half-updated by an earlier failure, a database address that cannot
  be built, and a database that has accounts but no saved settings (the installer is never opened over it: it would
  replace them). `docker-compose.yml` tells the image which stack it belongs to (`BDE_STACK`).
- The version of the platform is shown on the Settings page (written into the image when it is built).
- **A browser test of what every action shows afterwards** (`e2e/actions.mjs`, run by CI on the real image): members
  (approve, refuse, remove, change a role), roles (default, delete, create, edit), settings (identity, owners, logo,
  modules), profile, shared calendar and language. A test (`src/lib/server-actions-coverage.test.ts`) fails until every
  new server action is played by such a scenario or listed with the reason it needs none.
- `scripts/docs-screenshots.mjs` takes the documentation's screenshots again; `SEED_LOCALE=en` writes the demo data
  in English.
- **Series of events: act on one date, or on this date and the following.** On a date of a series, every action (edit,
  confirm, put back to draft, delete) opens a dialog with two choices, **Only this one** (selected first) and **This
  one and the following** (on the first date: the whole series), and tells how many dates it concerns. **Only this
  one** gives the date its own values (hour, day, place, description, category, members in charge, status): only what
  you changed, the rest keeps following the series; deleting it is still the cancellation you can restore. **This one and
  the following** cuts the series in two at that date: the first part stops before it, the second carries your change
  (and can change the frequency and the end date). What the following dates had of their own is replaced for the fields
  you changed and kept for the others; confirming the following also confirms the dates that were drafts, and the
  dialog counts them. Changing only the hour keeps the dates edited on their own, the cancelled ones and the reminders
  already sent, day by day (across daylight saving changes); changing the day or the frequency drops them, and the
  audit log counts them. Existing series are untouched: the migration only adds tables and columns.
- **Notifications and reminders follow the dates.** Confirming the following sends **one** message for the whole
  confirmed part (one calendar file with every date to come); confirming one date alone announces that date, once.
  A reminder is sent once per date, with that date's time, place and members in charge, whatever happens to the series
  afterwards; a date put back to draft or cancelled is not reminded.
- **Calendar feeds follow the dates**: a date edited or moved is the same entry for every subscriber, updated and
  never doubled (even after the series was cut in two, which changes no identifier); a date put back to draft disappears
  from the BDE feed.
- The audit log says, for every action on an event that repeats, whether it was for **one date** or for **this date and
  the following**, which date, and what a cut did to the dates edited on their own.

### Changed

- **The upgrading, deployment and troubleshooting guides** (English and French) describe the two-command update, the
  choice of a version, building the image yourself, and what to do when the image cannot be downloaded (`manifest
unknown`, `unauthorized`, a firewall). Versions before 1.1.0 were never published as images: going back to 1.0.0
  means building it.
- **Discord cards that are airier and easier to read**, the same for every type (confirmation, reminders, access
  request, member approved or removed): the essentials as large headings with an icon in front of each (📅 when, 📍
  where, the description as a quote; 🪪 login and 🏫 campus for a member), blank lines between blocks, the secondary
  details as small fields side by side (🏷️ category, 👥 in charge, 🔁 repeats, 🎭 role, 🤝 / 🚪 who acted), an icon
  per type in the title, the BDE's name and logo above the title and the logo as the thumbnail of events (the 42
  photo for a member). An access request ends with an "Approve or decline" link. Neutralized mentions, size limits,
  Discord dates and the fallback without a public logo are unchanged.
- **The build no longer reads `bde.config.yml`**: a missing or broken file no longer prevents rebuilding the image
  (it is now only the template for the first start's import). Auth.js's configuration is built at every request, to
  follow the settings.
- The "The database refuses the connection" page now talks about the `secrets` volume.
- The architecture and conventions reference is now **`docs/architecture.md`** (it was in a file at the root of the
  repository); all links lead there. The documentation moved to `docs/en/` and `docs/fr/`, and
  `docs/design.md` is now in English.
- Texts of the interface that still sent owners to `bde.config.yml` (the Members page note, the role error for an
  owner, the dashboard's empty state) now point to **Settings**, as does the 42 refusal warning of the start-up log.

### Fixed

- **The shared calendar page did not show the result of its buttons** (turn the BDE link on, regenerate it, turn it
  off): the action was done and written to the audit log, the page kept the old state until a reload, in 14 plays out
  of 15 on the production image. The three actions now answer an address that the browser loads, like the date actions
  of events; so does the "replace the shared link" prompt of the Members page, and the regeneration of one's personal
  calendar link (seen stale once in 45 plays). Every other action of the platform was measured the same way (members,
  roles, settings, language: 0 stale in 15 plays of each) and was not affected.
- **Confirming, putting back to draft, cancelling or restoring a date did not always show on the page** (the action was done and
  written to the audit log, the page kept the old state, until a reload). In the production build, Next.js 15 does
  not always show the page it fetched after an action that stays on the page you are on (the same family of bug as the
  month buttons below), in about half of the clicks measured on the real image. These actions now answer with an address
  that the browser loads (`src/lib/action-target.ts`), and the CI clicks them for real (`e2e/series.mjs`).
- **Events page: the previous / next month buttons and, on a computer, the switch from calendar to list did nothing.**
  In the production build, Next.js 15's router accepts a click on a link that only changes the query of the page you
  are on (`/events` → `/events?view=list`), loads the page, then never shows it, with no message; `next dev` does not
  do it, which is why it had not been seen. A link to the current page is now a plain link that reloads the page
  (`src/i18n/link.tsx`), which also fixes choosing a day in the calendar, choosing a date of a series, and the
  "Events" menu entry when you are already on the page. CI clicks these buttons for real, on a computer-sized and a
  phone-sized screen, in French and in English (`e2e/events.mjs`).
- **"Sign in with 42" failed after a fresh installation** (`invalid_grant`, "does not match the redirection URI",
  then a redirection to `http://0.0.0.0:3000/...`). In the production image the server listens on `0.0.0.0` and
  Next.js then builds every `request.url` from that address: on the way back from 42, Auth.js gave
  `http://0.0.0.0:3000/api/auth/callback/42-school` as the `redirect_uri` to exchange the code, while the
  authorization had been asked with `http://localhost:3000/...`. Every address the platform sends (the
  `redirect_uri` on the way out **and** on the way back, the error page's redirects, the links of notifications and
  of Discord, Slack and email cards) now comes from **one function**, which starts from the address registered in
  the settings (`src/lib/public-address.ts`); failing that, from the address the browser used, never the one the
  server listens on. `127.0.0.1` is written `localhost` everywhere (Next.js does it by itself: without that, the way
  out and the way back would have had two spellings). Regression test: a real server listening on `0.0.0.0`, the
  real NextAuth routers, and a fake 42 that refuses a code whose `redirect_uri` is not the authorization's; CI also
  replays the complete sign-in in a browser against the image.
- **`0.0.0.0` is never proposed nor accepted as an address any more**: the installer and the Settings page refuse it
  with an explanation, the default proposed address is `localhost` when the browser is on `0.0.0.0`, and a `0.0.0.0`
  address already saved by a previous version is ignored (a warning at start) instead of blocking sign-in. The
  terminal no longer shows `Network: http://0.0.0.0:3000`: it shows the address to open (`http://localhost:3000`,
  or the port of `APP_PORT`).
- **Installation: a warning when the address typed is not the browser's.** 42 sends the visitor back to the
  registered address; from another name or port, signing in cannot succeed. The message does not block
  (installing from another computer is legitimate); it also shows in Settings.
- **A rescue when the registered address is wrong** (nobody can sign in to fix it): `APP_URL=<address>` and
  `BDE_REIMPORT=settings` in `.env`, then `docker compose up -d` (see `docs/en/troubleshooting.md`). The address is now
  checked as in the installer, and the log says the old and the new value.
- **`scripts/restore.sh` did not replace the database, it completed it.** A backup only drops what it contains, so
  restoring a backup made before an update left the tables added since (for example `PlatformSettings`), and the
  platform then failed to start ("relation already exists"). Found by trying the rollback of the upgrade guide for
  real. The restore now starts from an empty schema.
- The demo data (`npm run seed:demo`) read the configuration files even on an installed platform: it now reads the
  saved settings, so the demo events use the BDE's real categories.
- **A startup problem the operator can fix is now shown in the browser, instead of a silent restart loop**
  (`restart: unless-stopped` + an explanation only in `docker compose logs`, partly in English). A small supervisor
  (`docker/start.mjs`) replaces the `sh -c "migrate && server"` command: unusable `.env` or `bde.config.yml`,
  refused database password (`POSTGRES_PASSWORD` changed afterwards), a database that does not answer, a failing
  migration. It stays alive and serves a **503 page in French or English** (according to the browser, in the
  platform's style) that names the problem and gives the commands; `/api/health` answers 503 (the container shows as
  "unhealthy"). A database that is not there yet is waited for, and the platform starts by itself as soon as it
  answers. **No secret appears in it** (fixed sentences, variable names, a Prisma code; Prisma's output is stripped
  of secrets in the logs). A real crash of the application still stops the container.
- **A PostgreSQL password containing `@`, `/`, `:`, `?` or `#` broke the database address** (built without encoding
  by `docker-compose.yml`) and Prisma printed pieces of it in the logs. The address is now built by the container,
  encoded.
- **An expired or regenerated 42 secret was only visible as "Sign-in failed. Please try again."** The platform now
  asks 42 (the application's token, with no member): the sign-in page explains that the application is refused and
  disables the button, the sign-in error page too, and a warning is written at start. Auth.js's "Configuration"
  error gets a clear text.
- **The application looped with "bde.config.yml not found" although the file existed**, on computers where Docker
  runs without administrator rights (rootless) or whose home folder is on a network share. The cause:
  `bde.config.yml` was **mounted** into the container; the mount is made by the Docker daemon, which did not see
  the folder or whose container user was not allowed to read the file (a `chmod 644` changed nothing), and the
  message said "not found" in every case. The file is now **copied into the image at build time** (the Docker client
  sends it with its own rights) and nothing is mounted any more: changing `bde.config.yml` takes
  `docker compose up -d --build` instead of `restart`.
- The error message now tells apart **missing file, folder in place of the file, unreadable file (with the error
  code), empty file and invalid file**, with the exact path checked and what to do; an unusable configuration makes
  the image **build** fail, instead of a start-up loop.

## [1.0.0] - 2026-10-06

First stable version of BDE_Network: a free, self-hosted platform for the Bureaux Des Étudiants of the 42 network
schools. Each BDE deploys its own instance, with its own database, its own `bde.config.yml` and its own 42 OAuth
application. This version brings the **Events** module (calendar, repetition, synced calendar, reminders), **custom
roles** safe from any privilege escalation, polished **notifications** on Discord, Slack and by email, Docker
installation with backup and restore, and documentation in French and English. The Finances and Meetings modules
come next.

### Added

- **README in English (`README.md`) and in French (`README.fr.md`)**, which describe the platform as it is: Events
  module, custom roles, synced calendar, notifications; Finances and Meetings only in a short roadmap. **Real
  screenshots** (dashboard, calendar, event, roles, mobile; light theme, interface in the README's language) taken
  on the demo data, as WebP in `docs/images/{en,fr}/`.
- **Installation in two paths** (`docs/installation.md`): "For the board" (what the BDE decides and writes in
  `bde.config.yml`, with no technical notion, then the roles in the interface) and "For the technical person"
  (server, Docker, domain, HTTPS). A step by step to create the OAuth application on the 42 intra (exact redirect
  URL, `public` scope, where to find the UID and the secret, the `redirect_uri_mismatch` error, **the secret's
  expiry**) and a "Common problems" section.
- **`SECURITY.md`** (private reporting through GitHub), issue templates (bug, feature) and a pull request template,
  Code of Conduct contact (Discord).
- `APP_PORT` to publish the application on a port other than 3000.
- **Confirming an event** asks for confirmation (a dialog in the normal, non-destructive style) and says whether
  members will be notified: by email, in the Discord or Slack channel, or not at all if no notification is set up —
  or if they already were (the notification is only sent once).
- **A title per page** ("Members · BDE Exemple"), a "Skip to the content" link, and the site's description
  translated.
- **Completed privacy page**: emails and notifications (Discord and Slack included), personal calendar link, the
  exact cookies (session, sign-in security, language). A new optional key `bde.contactEmail` shows a real contact
  address.
- A warning at start when `modules.enabled` contains a module that does not exist (a typo).
- `engines` (`node >= 22`) in `package.json`.
- Backup and restore on Windows: instructions (Git Bash, PowerShell, WSL), tested.
- **A single confirmation dialog** (`ConfirmDialog`) for every destructive or irreversible action: a dialog centered
  over the page, with a clear title, a sentence of explanation, an action button in destructive style and
  **Cancel**. Focus starts on Cancel and stays trapped in the dialog; Escape and a click outside cancel; focus
  returns to the button it came from; while sending, the button is busy and cannot be pressed twice. It replaces the
  blocks that unfolded under the element (which you had to scroll to see) for: rejecting a request, removing a
  member, deleting a role, deleting an event or its whole series, canceling a date, regenerating or turning off the
  BDE calendar link, regenerating your personal link. **Changing a member's role** now asks for confirmation too
  (showing the old and the new role). Documented in `docs/design.md` and `docs/architecture.md` for future modules.
- **Notifications about members** (`memberPending`, `memberApproved`, `memberRemoved`), which did nothing until
  now: a new access request notifies the owners and the roles that have "Manage members" (email) or the channel
  (Discord / Slack); an approval notifies the member by email (or the channel); a removal writes in the channel
  only, **never an email to the removed person**. Sent after the action: a failed send is logged and blocks
  nothing. A channel not set up in `.env` gives a warning at start, not an error.
- **Error pages in French and English**, in the platform's style: page not found (including for an unknown address),
  page error with "Try again" and "Back to the dashboard" (only the error's reference is shown, never its message),
  and a last-resort page if the site's very structure fails.
- **Confirmation before "Reject"** on an access request, as for "Remove from BDE".
- **Custom roles**: each BDE creates its roles (President, Treasurer, Secretary, Events lead…) from the new
  **Roles** page and ticks the exact rights of each (manage members, manage roles, view / manage each module that is
  on, manage the shared calendar). A member has **one role**, chosen in a menu of the _Members_ page, where you
  also choose the role when approving a request. Two editable roles exist from the installation: **Admin** (all
  rights except the audit log, including those of future modules) and **Membre**. The owner (OWNER, defined in
  `bde.config.yml`) keeps every right; the audit log stays reserved for the owner. See
  [docs/en/roles.md](docs/en/roles.md).
- **Anti privilege-escalation rules**, checked on the server in the transaction that writes: nobody gives a right
  they do not have, edits their own role or a role above theirs, changes the role of an owner or of a more powerful
  member; a role that is still given or is the default cannot be deleted. Every creation, edit, deletion and
  assignment of a role is written to the audit log (`role.*`, `member.*`). The rules are checked by over 130 tests
  and by mutation.
- Removing a member: confirmation before deleting, and clearly explained refusals (translated messages) when an
  action is forbidden.
- CI: a `migrations` job replays the roles migration on PostgreSQL and checks there is no drift with
  `schema.prisma`.
- **`.env` check at start**, with messages in French a non-developer can understand: `AUTH_SECRET` (32 characters at
  least), 42 credentials, `DATABASE_URL`, and the SMTP / webhook variables of the Events module's notifications that
  are really used. A clear warning flags the login "votre-login-42" still in `auth.owners`, or an `http://`
  `APP_URL` on a public address.
- **"Service temporarily unavailable" page** (FR/EN) when the database does not answer: it reassures, and brings
  back to the platform by itself as soon as the service is back. A new `/api/health` route and a Docker
  `HEALTHCHECK`.
- **HTTP security headers**: Content-Security-Policy, X-Frame-Options, nosniff, Referrer-Policy,
  Permissions-Policy, HSTS (only behind an HTTPS proxy). `X-Powered-By` is no longer sent.
- **Backup and restore without Node.js** (`scripts/backup.sh`, `scripts/restore.sh`): a single archive with the
  database **and the uploaded files**, rotation (`--keep`), restore with an explicit confirmation, an automatic
  safety copy and a rollback if the database restore fails.
- CI: a "docker image" job (builds the image, starts it on PostgreSQL, checks health and headers).

### Changed

- **Discord notifications as cards (embeds)** (`docs/notifications.md`): a color bar (the category's for an event;
  amber / green / red for a request / an approval / a removal), a clickable title with no duplicate preview card,
  fields in columns (When, Where, Category, Members in charge), Discord-format dates (`<t:…:F>` and `<t:…:R>`: each
  reader's time zone and a countdown), a sender under the BDE's name with its logo, 42 photo, role and **author of
  the action** ("Approved by", "Removed by") for members, a discreet card footer. The reminder says "today" when it
  goes out on the same day (catching up after an outage), "tomorrow" otherwise (also in Slack and email). Mentions
  neutralized in every text of the card, Discord's size limits respected (text cut with "…"; an event's description
  limited to 350 characters). Slack and email unchanged.
- **Slack notifications as cards (Block Kit)** (`docs/notifications.md`): a color bar (the category's; amber / green
  / red for members, as on Discord), a header title, fields in columns (When, Where, Category, Members in charge,
  Repeats), a "View the event" / "Approve or refuse" button, Slack-format dates (`<!date^…>`, in each reader's time
  zone, with a fallback text), a footer with the BDE's logo (the name alone if it is not public) and
  `BDE_Network`, 42 photo, role and "Approved by" / "Removed by" for members, "today" / "tomorrow" for reminders. The
  summary for phone notifications is the attachment's `fallback` field: the message has **no** top-level `text`,
  which Slack would show in the channel above the card (everything would be said twice). Mentions neutralized
  everywhere (`@here`, `@channel`, `@everyone`, `<!channel>`, `<@U…>`, links), texts cut cleanly at Slack's limits.
- **Slack application manifest and pre-filled link** (`docs/slack-app-manifest.yml`): name `BDE_Network`, incoming
  webhooks, no other permission; a test checks that the documentation's link is exactly this manifest. The
  documentation says Discord remains the simplest option.
- **Formatted HTML emails** (`docs/notifications.md`), with a fallback text version: the BDE's logo and name, a bar
  and a button in the category's color, When / Repeats / Where / Category / Members in charge lines, a button to the
  page concerned, a preview text (preheader), a discreet footer. Tables and inline styles (Gmail, Outlook including
  on Windows with a VML button, Apple Mail, mobile), dark mode. Event confirmation: an attached `.ics` file ("Add to
  calendar"). "Today" / "tomorrow" reminder. Access request (with the 42 photo) and approval, with the same care;
  FR / EN according to `bde.defaultLocale`; every text typed by a member is escaped.
- A short "Repeats" line ("Every week, until December 17, 2026") in emails and Discord cards; in dark mode, a thin
  light outline surrounds the email logo.
- **Mailpit in `docker-compose.dev.yml`**, wired by default (`SMTP_HOST=mailpit`): development emails are read at
  <http://localhost:8025> with no real server (`DEV_SMTP_*` to use one).
- **`public/logo.png`**: a neutral logo is provided, used as the Discord avatar when `bde.logoPath` is not a
  PNG/JPEG/GIF/WebP image (Discord does not accept SVG); without a public address (`APP_URL`), the message goes
  out with no avatar.
- **The `notifications` section of `bde.config.yml` is optional**: without it, every notification is off (the three
  member notifications were required, which made the image build fail for a BDE that had nothing to put there).
  Found by following the installation guide from a fresh clone.
- **PostgreSQL no longer publishes a port** in the production `docker-compose.yml`: only the application, on the
  Docker network, can talk to it (`docker-compose.dev.yml` keeps the port for `npm run dev`).
- `AUTH_SECRET` is generated with Docker (`docker run --rm alpine sh -c "head -c 32 /dev/urandom | base64"`), a
  command that works on Windows, Linux and macOS without Node.js: the docs, `.env.example` and the start-up message
  give it.
- User guide up to date (sidebar, roles, confirmation dialogs, sign out) and the dashboard's empty message: the
  Events module is no longer presented as "future".
- Card header (dashboard, members, profile): the title and the action are finally on one line (the `flex` class
  was missing).
- **Fewer SQL queries**: the session is resolved **once per request** (`React.cache`), instead of once per component
  that asks for it. Measured on the database: dashboard 13 → 7 queries, members 9 → 6, roles 7 → 4, profile 7 → 4,
  events 16 → 13.
- **Grouped emails**: a single SMTP connection for all the recipients of a send (instead of one per recipient); a
  refused address does not stop the others.
- **Event reminder with nobody in charge**: it goes to the owners and the members whose role allows managing events,
  instead of going to nobody.
- **One email can serve two accounts** (migration `user_email_not_unique`): the login is the identity. Before, an
  address already used by another account prevented signing in. A simultaneous double first sign-in no longer
  causes an error.
- `dashboard` and `profile` check by themselves that the account is approved (`requireApprovedSession`).
- `bde.defaultLocale` is documented for what it does: the language of the messages sent.
- `@types/node` moves to version 22 (the runtime's).
- **Expected cases in actions**: deleting or changing the status of an already deleted event, canceling a date that
  no longer exists, approving an already handled request… bring back to the list with a clear message instead of a
  500 error, and the list updates.
- **Discord and Slack messages neutralize mentions** (`@everyone`, `@here`, `@channel`, `<!channel>`, `<@…>`,
  `<url|text>` links): a name or an event title can no longer notify a whole server. The Discord webhook sends
  `allowed_mentions: { parse: [] }`.
- The default values of the member notifications in `bde.config.yml` and in the example are `"none"`.
- **Upgrading from a previous version**: the `custom_roles` migration converts the accounts with no loss and without
  depending on `bde.config.yml` — ADMINs become the "Admin" role, MEMBERs the "Membre" role (which always gets
  `events.view`), and a member who had a module's permission gets a "Membre + `module`" role; a `role.migrate` audit
  log entry keeps track of the old state. An ADMIN now also has the rights to manage events and the shared calendar
  ("Admin" role: all rights). In development (`docker-compose.dev.yml`, `db push`), the database is recreated: run
  `npm run seed:demo` again.
- The development role simulation offers "Pending" and each of the BDE's roles; simulated rights also apply to
  actions (and the audit log says so).
- **Production Docker image reduced from 2.15 GB to 465 MB**: `standalone` Next.js build, Prisma CLI installed
  separately and slimmed down, sharp and TypeScript removed, neither npm nor yarn in the final image.
- Port 3000 is only published on `127.0.0.1` by default (`APP_BIND` to open it): only the HTTPS reverse proxy exposes
  the application. The no-proxy case is documented.
- Database connection timeout limited to 3 seconds (instead of waiting indefinitely).
- `bde.config.local.yml`, `.audit/` and `.env*` are no longer copied into the Docker image.

### Removed

- **The public `/api/files/…` route and all the file storage code** (local adapter, `uploads` volume, `storage/`
  folder): nothing wrote to it, and serving files without authentication would have been a flaw as soon as the first
  upload existed. `backup.sh` only backs up the database; `restore.sh` still reads old archives (their files folder
  is ignored). Storage will be rebuilt with a real upload feature.
- Duplicates: the initials computation (4 copies → 1), the role simulation metadata, the `db:seed` script (identical
  to `seed:demo`), the `common` message namespace and the unused key `roles.page.membersLink`.
- The fixed `ADMIN` role (replaced by a custom "Admin" role) and the `ModulePermission` table (a module's rights are
  now carried by roles); the `permission.grant` / `permission.revoke` audit actions are replaced by `role.*` and
  `member.role_change`.
- `npm run db:backup` and `npm run db:restore` (replaced by `scripts/backup.sh` and `scripts/restore.sh`, which only
  need Docker).

### Fixed

- **The Docker development environment no longer rewrites `package-lock.json`**: the container ran `npm install`,
  whose npm reclassified a lockfile field at every start and dirtied the repository. It now runs
  `npm install --no-save`, which installs what the lockfile says and never writes it.
- A member removed from the BDE loses access immediately: their still-valid session cookie no longer gives any right
  (reading drafts, creating or editing events, data export). Role and permission checks now refuse any missing or
  unknown identifier or role.

## [0.2.0] - 2026-10-05

First business module: **Events**.

### Added

- **Events** module (`modules.enabled: [events]`, off by default): the board's internal calendar to plan and organize
  the BDE's events. See `docs/events.md`.
  - Title, start, end, location, description, category and members in charge; **title, dates, location, description
    and category are required** (Zod validation on the server and in the form, FR/EN messages under each field).
    Incomplete events created before this rule can still be displayed and are only blocked at their next edit.
  - Categories and colors defined by each BDE in `bde.config.yml` (`events` section).
  - Draft status (only visible to members with the permission) or confirmed (visible to every member); storage in
    UTC, display in the BDE's time zone; school year (September–August) computed automatically.
  - Repeating series (every week, every 2 weeks, every month) with a required end date, editing of the whole
    series, canceling a single date.
  - Monthly calendar view (colored dots on mobile with the day's detail), list view (default on mobile), detail
    page, filters (category, member in charge, school year), empty states and loading skeletons.
  - An "Upcoming events" block on the dashboard.
  - `.ics` export of an event and a **personal subscription link** (a secret token per member, regenerable from _My
    profile_, visibility recomputed at every request).
  - **BDE-wide subscription link** (`/api/calendar/bde/<token>.ics`): a single link to paste into the board's shared
    calendar, confirmed events only (never a draft), managed by OWNER/ADMIN (show, copy, regenerate, turn off, all
    logged without ever writing the token), with a regeneration offer when a member is removed.
  - Confirmation notification (once per event) and **day-before reminder** through an internal scheduler (no cron,
    no external service; Windows, Linux, macOS; never sent twice, even after a restart). A failed send never blocks
    saving nor the other recipients.
  - Audit log (`event.*`, `calendar_feed.*`), demo data, tests (recurrence, time zones, `.ics`, rights, reminders,
    rendering).
- Granting a module's permission to a member from the _Members_ panel (audit `permission.grant` /
  `permission.revoke`).
- _My profile_ page.
- `eventConfirmed` and `eventReminder` notification keys (optional, `"none"` by default) and the optional `APP_URL`
  variable for links in notifications.
- Personal, unversioned configuration: `bde.config.local.yml` (ignored by Git) replaces `bde.config.yml` if it
  exists.
- Navigation sidebar (a drawer on mobile), the `/auth-error` sign-in denied page, and role simulation for local
  testing (`ENABLE_DEV_IMPERSONATION`, development only). Design system specification in `docs/design.md`.

### Changed

- `auth.allowedCampuses` may be empty (no campus filter).
- The personal data export (GDPR) includes events created or in the member's charge (never the calendar token); the
  privacy policy mentions them.
- Docker development environment: the schema is applied with `prisma db push --accept-data-loss` and the demo
  accounts and events are created at start.
- `Button` deduces `nativeButton` from its `render` prop (no more Base UI warning for a link).

## [0.1.0] - 2026-08-05

Initial version (never tagged): the platform's foundation.

### Added

- Project setup: Next.js 15, strict TypeScript, Tailwind CSS v4, shadcn/ui, Prisma 7.
- 42 OAuth authentication (NextAuth v5), no password.
- Data model: `User`, `Role`, `ModulePermission`, `AuditLog`.
- OWNER / ADMIN / MEMBER / PENDING roles, per-module permissions, a read-only audit log (OWNER only).
- Versioned configuration (`bde.config.yml`, validated with Zod) and secrets (`.env`) kept apart.
- Internationalization (next-intl), French by default, English available.
- Dashboard, sign-in page, waiting page, member management, audit log, privacy policy, export of one's own data
  (GDPR).
- A notification abstraction (email, Discord, Slack) — not yet wired to any use case.
- A file storage abstraction (local adapter, interface ready for S3).
- PostgreSQL backup / restore scripts, demo seed.
- Docker Compose (production and development with hot reload), Dockerfile.
- GitHub Actions CI (lint, format, typecheck, build, test) on ubuntu-latest and windows-latest.

[Unreleased]: https://github.com/edouardbautz/BDE_Network/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/edouardbautz/BDE_Network/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/edouardbautz/BDE_Network/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/edouardbautz/BDE_Network/compare/v0.2.0...v1.0.0
[0.2.0]: https://github.com/edouardbautz/BDE_Network/releases/tag/v0.2.0
