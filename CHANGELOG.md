# Changelog

All notable changes to this project are written here, in English. Format based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Automatic backups.** The platform backs itself up **every night at 3:00 (BDE time)**, with nobody doing anything: one archive that holds the database, the keys to read it
  and the logo, in the folder `backups/auto` of the server (`BDE_BACKUP_DIR`), outside Docker's volumes, so that `docker compose down -v` does not remove it. Each backup is **read
  again before it is trusted** (the files against their SHA-256, the dump loaded into a scratch database, the encrypted settings opened with the keys of the archive). 7 daily, 4
  weekly and 6 monthly are kept. The Settings page shows the last one, the list, a **Back up now** button and a **Download** that encrypts the file with a passphrase the owner chooses
  (the format of `openssl enc`; a lost passphrase cannot be recovered, and the page says so). `scripts/restore.sh` learns `--auto`, the keys inside an archive, and the decryption of a
  downloaded file. The owners can be told (e-mail, Discord, Slack; two new customisable notifications, off until a channel is chosen) when the backup of the night fails and when none
  succeeded for two days. `docker-compose.yml` mounts the folder (the stack number goes to 3: an image that expects the mount refuses an older compose file) and no longer stops
  when a file system refuses to hand it over. New guide: [Automatic backups](docs/en/backups.md). A new nightly suite plays it all on a real stack, down to a new server.

- **Messages about publishing on the intra.** Five new notifications, in the table of Settings and in the customisation page (group "Publication on the intra"), shown only
  while the platform publishes on the intra, off until ticked: **publication requested**, **event changed on the intra** (the old and the new value), **event taken back**
  (back to draft, deleted, no date left: only for an event that was on the intra), for the staff; **published** and **refused** (with the reason), for the author and the BDE's
  room. The staff receives them by email (the members whose role lists "Publish on the intra", the owners when nobody does) and in **its own room**: the owners can give it a
  webhook of its own, which the BDE's room replaces when there is none. In the customisation of the messages for the staff, **`{@staff}`** pings the staff members who gave their
  Discord or Slack id on their profile, and nobody else. Customisable like every notification; the references of the older notifications do not change.

- **The school's staff publishes the events on the intra, from a page of its own.** Confirming an event now sends a **request** to the staff (one for a whole series,
  with the list of its dates). The new entry **To publish on the intra** of the menu counts what waits; the page of a request gives the event **in the order of the
  intra's form**, each field with a **Copy** button (dates as `DD/MM/YYYY`, times as `HH:mm`, in the BDE's time zone). The staff answers **Published on the intra**
  (with the address of the event there, if they want it) or **Refuse**, with a reason the author reads on the event; a refused request can be sent again. An event that
  is on the intra and then changes becomes **To update**: the page shows what the intra holds and what the event is now, and **Intra updated** closes it. Going back to
  draft, deleting the event or cancelling every date takes the request back. Events confirmed before can be asked for from their page. Needs the rights "Publish on the
  intra", "Follow the publications on the intra" and "Ask for a publication on the intra" (validating events already allows asking). A new migration adds the table; nothing
  existing changes. The privacy policy and the personal export say that the requests a person sent or answered are kept under their login.

- **Accounts for the school's staff.** Three new rights in the events module: **Publish on the intra** (answer the requests to publish events on the intra: it includes
  nothing, so a staff role sees that page and neither the calendar, nor the members, nor the settings), **Follow the publications on the intra** (read only) and **Ask for a
  publication on the intra**. The usual rules apply: nobody hands out a right they do not hold. Each person can give, on their profile, their **Discord id and/or Slack id**
  (optional, checked strictly: an id, never a name or a mention) so that the messages for the staff can mention them. The owners can give the staff **a room of its own** (a Discord
  and/or Slack webhook, with a test message) in Settings; without it, those messages go to the BDE's room. Only available once **Publish events on the 42 intra** is on.

- **The fields of the intra 42 on every event, and a description in Markdown.** An owner can turn on **Publish events on the 42 intra** (Settings, Events;
  off by default, nothing changes until then). The event form then asks for what the school's staff copies into the intra's form: the organizer's login (filled
  in with the author's), who it is available for (students, pisciners, both), the maximum number of people, the waiting list, the kind, the delay before
  unsubscribing is no longer possible, and keywords. They belong to the whole series. Events written before keep working; the form asks for the fields at their
  next edit and **no event is confirmed without them**. The description accepts the Markdown of the intra's form, with a preview in the form and on the page of the
  event (the text is kept as typed, ready to copy; nothing a member types can add a tag, a picture or a script to the page).

- **Every notification can be customised, with a live preview.** A new **Notifications** page (a bell in the menu) lets the owners, and
  the members whose role has the new **Customise notifications** right, change what the Discord cards, Slack messages and e-mails
  say and how they look: the small text, the title, the emoji, the colour, which facts are shown, in which order and under which name,
  free texts, the button (its words and an `https://` address of its own), the footer, and for e-mails the subject, the inbox line and a
  note. Words that vary (the title, the place, the name of a member…) are inserted from a list of **variables** shown in the language
  of the interface. A tab **All channels** and one per channel: a channel follows the common template until it is customised, and can go
  back to it. What the platform writes by itself is shown in every field and **only what was changed is kept**, so the rest keeps
  following the platform's improvements, and what a BDE wrote is never replaced.
- **Mentions that only the BDE can write.** The message above a card can mention `@everyone`, `@here` (and `@channel` on Slack) and the people,
  roles and groups of a list the BDE keeps for each platform. Only what is written in the template notifies: a title, a place or a name
  typed by a member never does, whatever it contains.
- **Safety nets.** A test message per channel, with the notification as it is on screen (saved or not), marked as a test, one every ten
  seconds, with the mentions written as plain names unless the person turns them on and confirms; a history of the last 50 versions of each
  tab with a restore; a way back to the platform's own message for a tab or for a whole notification; every change in the audit log
  (never the text); and, if a saved template cannot be used when a message goes out, **the platform's own message is sent instead** and
  the page says so.
- **Quality.** The new page and its 11 actions are in the access matrix, the attacks on the running image play hostile text through
  the stored templates, the previews of every channel and the action that writes a template called from another site, the update suite
  checks the new tables, the right and the page (and a template through backup and restore), and the quality dataset holds templates,
  mentions and their history, with the invariants and the erasure test over them.

- **Quality of the publication on the intra.** The attacks on the running image play hostile text through every field of the requests and the staff's pages, Markdown meant to
  become a script, a picture from elsewhere or a slow parse, ids that would ping everybody, links that are not the intra's and forged answers (a link that runs, a version that is not
  a hash, a page to come back to that is an address), with the control that the right answer works; the journeys in the three browsers play the circuit from the confirmation to the
  update of a published event, as the validator and as the staff, and check that the staff sees nothing else of the platform and that a phone does not scroll sideways; the update
  suite checks the new table is there and empty and that the pages do not exist until an owner turns the publication on. The glossary and the FAQ say what the staff, a request and
  "to update" are.

### Changed

- **One folder for every copy the platform makes.** The copies made before an update used to be in a Docker volume (`backups`), which `docker compose down -v` removes, next
  to the nightly backups in the folder `backups/auto/`: two places, only one of which survived. They now go to `backups/auto/pre-update/`, in the same folder of the server
  (`scripts/restore.sh --pre-update` reads it). **Nothing to do when updating**: at the first start the platform carries the copies of the old volume into the folder (nothing is
  deleted from the volume, mounted read only; `docker volume rm` it once the copies are seen in the folder). The compose file and the image belong together by a new number
  (stack 3 to 4): an old compose file with this image, or the reverse, is explained in the browser instead of starting. The update suite plays the carrying over from
  every version since 1.0.0, 1.5.0 included.

- **Lighter, faster, and a platform that can be left alone.** Measured on the production image and the quality dataset (see [Quality](docs/en/quality.md#speed-and-resources-the-numbers)): the image is 247 MiB instead of 318, the platform restarts in 1.1 s instead of 2.6, a page sends 2 to 5 statements to the database instead of 10 to 12 (relations are read with a join, the session with one statement), the scripts every page loads first lose about 36 KiB (Zod and the toasts are no longer in them), and under the load of 20 people the application peaks at 450 MiB instead of 1,105 and answers 95 % of the requests in 0.8 to 1.4 s instead of 1.6 s. Docker now cuts the logs (three files of 10 MB per service) and each service has a ceiling for its memory (`APP_MEMORY`, `DB_MEMORY`); the deployment guide says what size of server holds a BDE (1 CPU and 1 GiB are enough). The checks of a pull request run as parallel jobs (5 minutes instead of 12 to 17), and **budgets** (`qa/optim/budgets.json`) fail a pull request that makes the image, the scripts, the HTML or the statements of a page grow.

- Development only: the SQL injection checks of the quality campaign attack every server action of the platform (every string, number and boolean of its arguments and every field of a form it reads, the list coming from the source and from the access matrix, so that a new action is attacked as soon as it has a case), and the nightly ZAP scan accepts its SQL injection rule only on the pages and fields those checks attacked: an alert anywhere else fails the job. The scan's active scan, which had never finished, now has an end (25 minutes), and the budget of the size of the image counts what the image holds instead of the sum of its layers, which the runners of the CI report differently since they changed their image store.
- Development only: the tests of the browser watcher no longer depend on the noise of a real page (Chromium on the real image aborts requests of its own, which excused the error the test wanted reported).
- Development only: a test of the notification editor no longer fails now and then (it clicked Save again while the button still said it was saving).
- Development only: the performance test of the calendar no longer depends on the day it runs on (it counted the prefetches of the events of today), nor on how many events the day it looks at has (the prefetches of events are counted apart from those of the menu).
- Development only: the WebKit browser journeys no longer fail now and then. The watcher excuses the engine's word for an aborted fetch when the page leaves its
  document right after it, cleanups wait for the page before they ask what it shows, and a new `browsers stress` workflow plays the journeys many times in one engine.
- Development only: the tests now pass on a computer in any time zone (one of the migration tests read dates in the zone of the machine and failed anywhere but in UTC), and CI plays them again in two other zones.
- The cards, Slack messages and e-mails of the notifications are written down as reference files (every kind, both languages, a complete
  case, a bare one, one longer than any limit, a hostile one) that the tests hold to the byte: **without a template the messages are exactly the
  same as before.**
- The privacy policy says that the notification templates a person edited, their versions and the people they added to the list of mentions
  keep their login as plain text, like the audit log. The personal export lists them (never what the templates say).
- A new migration adds the tables of the templates, the versions and the mentions; a copy of the database is therefore made before the update,
  from every version, as for any migration.

### Fixed

- **Automatic backups on a rootless Docker whose disk refuses the change of owner (a network disk, the computers of the school).** The step that prepares the folder of the
  nightly backups chained the change of owner and the opening of the rights: when the file system refused the first, the folder stayed private to the host user and the
  platform could not even list it ("the backups folder cannot be read"). It now opens the folder to every user of the server with the sticky bit when the owner cannot be
  changed (the archives stay `600`), and says so in the logs. The Settings page and the logs name the folder that was checked (on the platform and on the server), its owner
  and rights, what is wrong (missing, not a folder, cannot be read, cannot be written, inside the container instead of on the server) and what to do. The guide says where each kind
  of copy is kept and which survive `docker compose down -v`. The backups suite plays the case (a file system that refuses the owner) and the folder that cannot be used.

- **A broken apostrophe in the window "Customise Discord?" of the notification editor.** The French text of the window that offers to customise a channel showed the code of the
  apostrophe stuck inside a word instead of the apostrophe (two messages: the window and its variant with unsaved changes). Nothing else was damaged: every message, e-mail, card, default
  template, reference file, error page, page of documentation and note of this changelog was searched for such leftovers of a character code, with the accented letters, quotes, dashes,
  spaces and the ellipsis. A test (`src/i18n/broken-escapes.test.ts`) now fails when one comes back in a catalog, a page of documentation, a reference of the notifications or a source,
  and the rule is written in the architecture notes: texts are written with their characters, never with codes.
- **The platform's address accepts IP addresses, and the mail server field accepts the underscore.** The public address of the installer and of Settings takes an IPv4 or an IPv6 address
  (between brackets with a port, `[2001:db8::1]:3000`), useful before a domain name exists; the sign-in with 42 sends and receives that same address, played by the sign-in test with an
  IPv4 and an IPv6 address. A name with no dot (`bde`) is still refused, now with a message that says why (42 and the sign-in cookies). The mail server accepts `mail_server`, the way
  Docker names its services.
- **The mail server field accepts any valid host name.** The installer and Settings → Notifications → E-mail refused a name with no dot such as `mailpit` or `postfix`, which is
  what a self-hosted mail server is often called on a Docker or school network. The field now takes any host name of RFC 1123 (a single word included), `localhost`, and IPv4 and IPv6
  addresses (with or without brackets), and still refuses a scheme (`smtp://`), a path, a port stuck to the name and spaces, with a message that says what to remove.

- **The resilience check of the webhook no longer depends on the time of day.** Run after the reminder hour, the platform found the reminders of the next day due and sent
  them one after the other to the webhook that never answers, so a connection was always open and "gives up within a minute" failed. The platform of that job is made at the
  clock of the dataset, like the visual references.

- **A mutation that cannot be applied is now a failing test.** Ten mutations of the quality campaign had lost the text they break (the code had moved on) and were only reported at the end of a job that runs for an hour. `qa/mutations/anchors.test.ts` checks every list on every pull request, and the ten are re-anchored and played again: none survives.

## [1.5.0] - 2026-10-23

### Added

- **A notification can go through several channels at once.** Each type of notification (an access request, a confirmed event, a
  reminder, a proposal…) now has a **list** of channels among Discord, Slack and e-mail, instead of one: Discord **and** e-mail for the
  access requests, only Slack for the reminders, nothing for the rest. In **Settings** and in the installer, the _Notifications_ form is
  a panel per channel (what it needs, a "Set up" badge, its own test, a removal) and a **table of boxes**: a row per notification, a
  column per channel, shortcuts to tick or clear a whole column, a box that can only be ticked when its channel is set up, no e-mail box
  for a member who was removed, and on a phone a list of blocks that does not scroll sideways. A notification with no box ticked sends
  nothing.
- **The channels are independent.** A message goes out on every channel ticked at the same time: a Discord channel that is down no longer
  holds back the e-mails or the Slack message, and a card that cannot be built leaves only its own channel with the plain message. None of
  it blocks the action that caused the notification, and the logs name the channel that failed.
- **The test message tests one channel, and shows what it will look like.** One test per channel, through what is typed in its panel
  (saved or not), sends the **real card or e-mail** with an invented event marked "Test message", with the BDE's name, color and logo.
- **The update suite starts from 1.3.0 and 1.4.0 too**, with the data of a board that has used what they brought: roles that only propose, that
  validate and that manage the shared calendar; series with advanced rules (every two weeks on Monday and Wednesday ten times across the change of
  clock, the second Saturday, the last day of the month, every year); a series cut in two with a cancelled date and a moved one; a proposal, the
  proposal of a series, a refusal with its comment, drafts, and a draft series with one date confirmed alone. Each is updated to the code of the
  branch, held to what the old version said (every row, every line of its four calendar files, the rights), backed up, restored and taken back.
  Development tooling only: nothing of the platform changes.

### Changed

- **Notifications look like the platform.** The e-mails use the grounds, inks and rounded corners of the interface (light and dark), the
  button is a pill in the **color of the BDE** worked out as on the platform (the bar keeps the color of what the message is about),
  and the cards of a request, an approval and a removal take the warning, success and danger colors of the interface. The pictures of the
  documentation show them.
- The wording of an access request is one word everywhere: it is **approved** (or refused), no longer sometimes "validated" or "declined".
- The plain text of a member removal now says who removed them ("… was removed from the BDE by Paula Martin."), as the card already did.
- `notifications.<type>` of `bde.config.yml` and of the stored settings is a list (`[discord, email]`; `[]` for nothing). **The old
  form is still read**: `"discord"` is `[discord]`, `"none"` and a missing key are `[]`. Nothing is migrated or rewritten by the update
  (the update suite checks that each notification keeps its channel, from 1.0.0 to 1.4.0); the lists are written the next time the
  settings page is saved. `bde.config.example.yml` documents the lists.
- The e-mail of an approved member is now its own message next to the team's card, with its own subject, when both channels are ticked.
- Update suite: the QA configuration names a different channel for each notification (as every version before 1.5.0 wrote it), and the
  settings page of the version under test must tick exactly those boxes.

## [1.4.0] - 2026-10-22

### Changed

- **A new look for the whole platform, the "Galets" direction.** Cards without borders on three levels of background, titles in bold Manrope over calm text,
  round buttons and fields, generous nested corners, one filled accent "moment" per screen (the next event on the dashboard, the selected day of the calendar, the
  main action of a form). The navigation is a column of captioned icons on the left (a floating bar at the bottom of a phone, with a round Create button and a
  "More" sheet); the account menu, at the foot of the column, now holds the profile, the theme, the language and sign-out. The dashboard is rebuilt around the next
  event, the ones after it, shortcuts and the account. Under 640 px every table (members, roles, audit log) is a list: nothing scrolls sideways on a phone, and every
  button is 44 px high there. Light and dark themes, `prefers-reduced-motion` and a visible keyboard focus everywhere (a ring in the ink of the accent; a test now
  forbids `outline-none` on anything focusable).
- **The accent colour is worked out for every theme.** The colour of the BDE is kept as it is whenever white or dark text reads at 4.5:1 on it (an orange or a
  green takes dark text); otherwise it is darkened until white does, and the link or icon colour is pushed toward black or white until it reads 4.6:1 on its own tint,
  in the light and in the dark theme. The settings page and the installer show a preview of the colour, light and dark, and say when it was adjusted. **New
  installations start with `#2F5BEA`** (the installer, the example configuration and the schema); a platform that has a colour keeps it.
- **The font is Manrope, served by the platform itself**: the file is fetched when the image is built, and no page asks Google (or anybody) for anything when it runs
  (a test reads the source, a browser test watches what a page loads). Geist is gone; code and links to copy use the system's monospace.
- The red of a confirmation button is a little darker in the dark theme (`#D34247`): white text on the specification's `#E5484D` was 3.9:1, under the 4.5:1 of WCAG AA.
- Development tooling: `qa/design-preview.ts` takes pictures of a screen (light, dark, computer, tablet, phone, menus and sheets open), `QA_ACCENT` gives `qa/platform.sh` an
  accent colour, the unused `select` and `tabs` primitives were removed, and `docs/design.md` is rewritten (tokens, accent algorithm, every component, what differs from the
  original specification). The documentation and its screenshots follow the new interface.
- **Worktrees of the quality tooling are made and removed by one script, which cannot reach what they borrow.** The mutation checks
  and the update suite work in a throwaway git worktree that links the project's `node_modules` into it; on Windows removing such
  a worktree with git followed the link and emptied the real `node_modules` (twice). `qa/worktree.mjs` removes every link as a
  link first, refuses anything that is not a worktree of the repository, and is the only code allowed to create or remove one (a
  test checks it, and that the files a link points to survive). Development tooling only: nothing of the platform changes.
- **A repetition starts on the first day that fits it, and the interval is counted from that day.** "Every 2 weeks on Monday and
  Wednesday, 10 times" typed on Friday 23 October used to start on Monday 2 November (the weeks were counted from the week of the
  Friday, which skipped the Monday after); it now starts on **Monday 26 October** and gives the 26th and 28th, then the 9th and
  11th of November… The same goes for "every 2 months on the 15th" typed on the 20th (the months are counted from November) and
  "every 2 years" on a day already past this year. A series whose first date already is a day of its rule keeps every date it
  had: the series that exist are not changed (checked against the previous counting, on the demonstration data and on the golden
  test of the series that existed before the rules).
- **The form says where a series will start in a visible notice.** It was a line of small grey text in the preview ("The first date
  becomes…"). It is now an information notice of the design system above the preview: "October 23 does not match this rule: the
  series will start on Monday, October 26.", with a button "Start on October 26" that changes the start date for you, keeping its
  time and its duration.
- **Dependencies updated** (Next.js 16.4.2, React 19.3.1, Prisma 7.10.1, nodemailer 10.1.7, js-yaml 5.5.0, Zod 4.6.7, Vite 8.3.5, markdown-it 15.0.3, and the rest of
  the weekly group). All the Dependabot alerts that were open are fixed but one (KaTeX, a development tool of the documentation lint, low severity), and the exceptions of
  `scripts/audit-allowlist.json` and `.trivyignore` are gone because what they covered is fixed (`mysql2`, `deepmerge-ts`, the `postcss` copy of Next.js). The
  dependency review also accepts the `PSF-2.0` license (the same as `Python-2.0`, which was already accepted).

## [1.3.0] - 2026-10-22

### Added

- **What the privacy policy promises is checked against the database.** Every column that can hold a person is read from the schema
  and has to say where the export of one's data finds it; and removing an account, on a real database with 300 members and 600
  events, must leave no e-mail address, full name, picture or personal calendar link anywhere, and the login only where the policy
  says, with the history (events written, dates cancelled) kept. It found the export was missing four kinds of data (see "Fixed")
  and nothing left behind by a removal.
- **The tests of the rules that decide who may do what are tested, every night.** A mutation tester changes the code of those rules
  one operator at a time and the tests must fail for each change. Its first run found the tests of who becomes an owner after
  signing in did not exist (every test of the sign-in replaces that code by a stand-in), and the exact limits of the logo
  checker (2 MiB, 64 px, 4096 px, the bytes of a WebP) were not held; both are now, and the score went from 87.4 % to 97.6 %.
  The job fails below 95 %. No defect of the product was found: the tests were missing.
- **A page of the documentation says what is checked, how, and what it found** ([Quality](docs/en/quality.md), in English and in
  French): the checks of every pull request and of the nightly run, what the suites do, the 22 defects the campaign has found and
  fixed since 1.2.0 by kind, what it looked for and did not find, and, as clearly, what it does not cover (no rate limit in the
  platform, the real 42 and chat services replaced by stand-ins…). The deployment guide now says that the platform does not limit
  requests and that the reverse proxy is the place to do it.
- **A walk through the interface is played as every kind of member, on a computer and on a phone, every night.** From the first
  page and from every page the person is shown, it follows every link, opens every menu and dialog, and fails on what a person
  would notice: a link to a page that does not exist or that sends a signed-in person to the login page, a page with no heading or
  no title of its own, a page that scrolls sideways on a phone, a picture that does not load, a menu that breaks the page when it
  opens. It found that the login page, the "sign-in refused" page and the waiting page had no heading (see "Fixed").
- **A year and a half of the reminder loop is played every night.** The loop is called with each of the ~2400 instants it would
  look at, on a real database with the QA dataset, and what it did is compared with a calculation that does not use its code: every
  confirmed date is reminded exactly once, at the first look after the evening before (across the two changes of clock), nothing
  is reminded for a cancelled date, a draft or a date back to draft, a confirmation announced after the reminder was due, or a date
  that has started; six loops looking at the same moment claim each reminder once; and three weeks without a loop lose only what
  started meanwhile. The school year of an instant is checked at the first of September of every year to 2032 in five time zones. It
  found nothing.
- **The updates an operator makes are played, from every released version, every night.** A platform of 1.0.0, 1.1.0 or 1.2.0 is
  given the data of an old installation (roles, members, events of every kind of repetition, a cancelled and a moved date, calendar
  links), the folder is moved to the version under test and `docker compose up -d` is run, as the guide of upgrading says. What the
  old version said about its own data (every date of its calendar files, its roles, its rows) is what the new one is held to; then
  a backup and its restore, and the way back to the old version, are played. It found that going back with `restore.sh` did not
  work as written (see "Fixed"), and nothing else: no date, right or row changed in any of the three updates.
- **What the platform does when what it stands on goes away is played every night.** A suite stops, freezes and kills the
  database while the platform serves signed-in people, stops and kills the application in the middle of a batch of writes, and
  puts a webhook that accepts the connection and never answers behind the notifications. It checks that the platform says the
  service is unavailable instead of failing, in seconds; that it comes back by itself and that the same sessions still sign people
  in; that every write that happened is whole (the event and its audit entry, or neither) and the invariants of the database
  hold; that the application stops cleanly in about a second; and that the address of the webhook is never in the logs. Its first
  run found the two defects fixed under "Fixed" (a frozen database holding every page, a channel that never answers holding a
  connection for minutes).
- **How fast the pages are, and what the platform does under load, are measured every night.** Lighthouse judges seven pages, on
  a phone with a slow network and on a computer, against written budgets (the four scores, how soon the page is drawn, the
  layout shift, the weight and the number of requests); k6 plays a mix of what members, validators and owners open, with 20 people
  at once for 40 seconds, against a limit per page and a limit of failures, and the memory of the application is checked after
  it. The numbers are in the summary of each run. The first measures found that the calendar made 110 requests of its own
  (see _Fixed_). Run them with `sh qa/platform.sh up`, then `npx tsx qa/perf/lighthouse.ts` and `npx tsx qa/perf/load.ts`.
- **A change in how the pages look is seen before it is merged.** Every night, 80 pictures (19 pages, on a computer and a phone, in
  the light and the dark theme, and 4 pages in French) are compared with their reference, in Chromium; a page that looks different
  is shown with the difference drawn. The references are on a branch of their own (`qa/visual-baselines`), made by a workflow where
  they are compared, and a look that was meant to change is accepted by making them again and reading the pictures that changed.
  For that, the platform of the quality campaign can now run with another clock (`sh qa/platform.sh up --now <date>`), so that
  the dates to come and the day marked as today are those of its data, whatever day it is run.
- **Accessibility is checked on every page, and with the keyboard, every night.** axe checks each page of the platform against
  WCAG 2.2 level AA (both languages, both themes, computer and phone, as the people who can see it); the keyboard is played in
  Chromium, Firefox and WebKit: the skip link, the menus, the phone's drawer, the message of a form that is not valid, the
  focus of every control a Tab reaches, and the menu of the signed-in person. What the first runs found is under _Fixed_ (a
  description list, the name of a button, tables that cannot be scrolled with the keyboard, the contrast of the destructive
  red, the size of the calendar's events, the focus of a drop-down list in Safari, and the menu of the signed-in person that
  failed when it opened).
- **The journeys of the platform in the three engines people use**, played every night: Chromium, Firefox and WebKit (Safari's),
  against the real image and the QA dataset. A visitor, an account waiting for approval and a removed member; a member (the
  calendar's month, list and filter buttons, a calendar file download, the theme, the menu on a phone, and what a member is
  never shown); a proposer who proposes a weekly event, a validator who approves it or refuses it with a comment, and a member
  who reads it; the confirmation dialog's focus and keyboard; the calendar in French and its + on a day; the owner's every
  page, and the logo's upload, preview and reset. Every journey fails if one of its pages raises an exception, writes an error
  to the console, violates the content policy or gets a server error; the first runs found that every page did (see
  _Fixed_). Run it with `sh qa/platform.sh up`, then `npx playwright test -c qa/browsers --project=firefox`.
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

- **Opening the calendar no longer makes the server draw the page of every event of the month.** On a computer, each event of a
  day is a link, and the browser prefetches the links it can see: a month of 100 events was 110 extra requests, each one a
  full rendering of an event page by the server, for a person who opens one of them (the list and the dashboard make 13 to
  18). The events of the calendar are not prefetched now (the page of an event loads when it is clicked, as it did before).
  Found by the performance checks of the quality campaign.
- **The menu of the signed-in person (My profile, Sign out) opens.** Clicking one's name at the bottom of the menu showed the
  "Something went wrong" page instead of the menu, in every browser, with the mouse or the keyboard: the library that draws
  menus (Base UI) refuses a menu label that is not inside a group, and it says so when the menu opens, not when the page is
  drawn, so nothing had caught it. The signed-in person's name, login and role are now the label of a group. Found by the
  browser tests of the quality campaign, which opened it in Safari's engine first.
- **Going back to the previous version with `restore.sh` now works in the order the guide gives.** Putting the database back
  with `./scripts/restore.sh` ended by starting the application of the folder, which was still at the version being left: it
  applied its migrations again to the database that had just been put back, and the previous version, started right after
  (`git checkout`, `docker compose up -d`), refused it ("the database is newer than this version"). The restore of a copy
  made before an update (`--pre-update`) now leaves the application stopped, and `--no-start` does the same for any backup; the
  guide of upgrading says to use it when going back. Found by the update suite of the quality campaign, which rolled back for
  real.
- **The facts of an event (when, repeats, where, in charge, description) are a valid description list.** The markup nested
  each term and its description one level too deep, so a screen reader did not announce them as a list of terms and
  descriptions (WCAG 1.3.1). The look is the same. Found by the accessibility checks of the quality campaign.
- **The login page, the "sign-in refused" page and the waiting page have a heading.** Their title was a plain block of text, so
  a screen reader found no heading to start from on the three pages every visitor sees first (the other pages had one). The
  title is now announced as a heading of level 1; nothing changes on screen. Found by the walk through the interface of the
  quality campaign, which checks that every page has a heading.
- **A database that stops answering no longer holds every page for as long as it stays frozen.** The application gave up on a
  database that did not accept a connection after 3 seconds, but not on one that accepted it and then said nothing (a stalled
  disk, a paused virtual machine): every page waited, with no end, until the database came back. A query is now given up after
  15 seconds, the visitor sees the error page, and the platform works again by itself when the database does. Found by the
  resilience suite of the quality campaign.
- **"Download my data" gives everything the platform holds about the person.** The page promises "a copy of everything we hold
  about you", and the export left out four things: the dates of a series a person is in charge of on their own, the dates they
  cancelled, the proposals they refused (with the comment they wrote), and what was done to their account (approved, given a
  role…, without saying by whom: that is somebody else's data). They are in the file now. A test reads the columns that can hold a
  person from the database schema and fails until each new one says where the export finds it. Found by the privacy check of the
  quality campaign.
- **A long page no longer jumps sideways when it finishes loading.** A page is short while its loading skeleton shows and long once
  it is drawn (the members, the list of events). With a classic scrollbar (Windows, Linux, and so most computers), the bar
  appears at that moment and moved the whole content sideways by half its width, in front of everybody's eyes: a layout shift of
  0.78 on the members page (0.1 is the limit of "good"). The place of the scrollbar is now kept, whether the page needs one
  or not. Found by the performance checks of the quality campaign.
- **The export of one's own data is never kept by a cache** (`Cache-Control: private, no-store`, on the answer and on the
  refusal): it holds all the personal data of a member, and a proxy in front of the platform could otherwise keep it.
  Found by the attacks of the quality campaign.
- **A Discord, Slack or mail server that accepts the connection and never answers no longer holds a socket and a task for
  minutes.** The notifications are sent after the response, so nobody waited, but the call had no limit of its own: five minutes
  for a webhook, ten for the mail library, and the reminder loop sends its messages one after the other. A webhook now has 10
  seconds to answer, and a mail server 10 seconds to accept and greet and 30 seconds of silence. Found by the resilience suite of
  the quality campaign.
- **An address whose percent-encoding is malformed (`%ff`, a lone `%`, and `%25` followed by something that is no longer valid
  once decoded, like `/fr/x%25y`) is answered with a 400** instead of a 500 and an error in the logs: Next.js fails while it
  reads the parameters of the route, for a request that is simply wrong (a page is decoded twice, an API route once).
  Found by the attacks of the quality campaign; nothing was ever disclosed.
- **The events of the calendar are easier to hit and to read.** On a computer, each event of a day of the calendar was a
  button 20 pixels high, stacked with others a few pixels away: hard to hit with a finger or a tremor (WCAG 2.5.8, the
  guideline asks for 24); they are 24 pixels high now. An event that is not confirmed (a draft, a proposal) was faded to
  80 %, which brought its time below the contrast that is readable (3.2:1, it needs 4.5:1): it keeps its dashed border and
  its italics, and is no longer faded. Found by the accessibility checks of the quality campaign.
- **The logo is served with the strict policy its route writes** (`default-src 'none'; sandbox`). The policy of the pages,
  set for every address by `next.config.ts`, replaced it, so the logo (a file anybody can open, whose bytes were uploaded)
  was sent with a policy that lets scripts run. Nothing could be exploited (the type is the image's, and `nosniff` keeps a
  browser from taking it for a page), but the second line of defence that was written did not exist. The policy of the pages
  now leaves `/api/logo` out. Found by the attacks of the quality campaign.
- **The button "Make default" of the roles page is named with the words it shows.** Its accessible name was "Make _Admin_
  the default role" (and in French "Définir _Admin_ comme rôle par défaut"), which does not contain the visible text, so
  somebody who speaks to their computer ("click Make default") was not understood (WCAG 2.5.3). The name now starts with
  the visible words ("Make default: Admin"). A test checks every control named this way, in both languages. Found by the
  accessibility checks of the quality campaign.
- **No page violates the platform's own content policy any more.** The validation library (Zod) tried to compile its schemas
  with `new Function` to find out whether it may, which the policy forbids (no `'unsafe-eval'`, on purpose): every page load
  was a `script-src` violation, written to the console of Firefox and Safari's developer tools and sent to any report address
  a BDE would add. Nothing broke (the library falls back on its plain path), and nothing is slower in practice. Found by the
  browser tests of the quality campaign.
- **A drop-down list (category, role, language…) shows where the keyboard focus is in Safari.** Safari draws such a list with
  the system's look and ignores the focus ring the other controls use, so somebody who moved through a form with Tab saw
  nothing on the list (WCAG 2.4.7). Its focus is now an outline of the same colour and width. Found by the accessibility
  checks of the quality campaign, which play the keyboard in Chromium, Firefox and WebKit.
- **The refusal of the logo route (404) carries the same strict policy and `nosniff`** as the logo itself: leaving the policy
  of the pages out of that route had left its refusals without any policy. Nothing could be exploited (the body is empty), but
  every answer is meant to carry one. Found by the attacks of the quality campaign.
- **The tables of the audit log, the members and the roles can be scrolled with the keyboard.** On a narrow screen a table
  scrolls sideways, and a box that scrolls but cannot take the focus cannot be scrolled with the keyboard (WCAG 2.1.1). The
  scrolling box of each table is now a named region reached with Tab, which shows the focus like every control. Found by the
  accessibility checks of the quality campaign.
- **A sign-in address with a `callbackUrl` that Auth.js cannot read (`javascript:…`) is no longer a server error.** On
  `/api/auth/callback/42-school` it answered a 500 and logged an error for a request that is simply wrong; the unreadable
  value is now dropped, as if the visitor had not given one. Where a readable one leads is unchanged (Auth.js only follows an
  address of the platform). Found by the attacks of the quality campaign.
- **The text of a destructive button (Remove, Refuse, Regenerate the link…) is readable on its tinted background.** In the
  light theme the red was 3.8 to 4:1 against its own pale red (it needs 4.5:1, WCAG 1.4.3), which is hard to read for
  people with low vision; it is darker now (the same hue; the dark theme is unchanged). A test now plays the contrast
  table of the design document on the real colours of both themes. Found by the accessibility checks of the quality
  campaign.

### Security

- **Two places that show a value of the request or of the network are closed.** Nothing could be exploited (the language of the
  page shown at a startup problem was always one of two words and the page has a policy that allows no script; the notes of a
  release are shown as text), but the code said so only implicitly, and the scanner of the code (CodeQL) rightly asked. The
  language is now one of two constants; the summary of a release's notes keeps no angle bracket, even when removing a tag would
  make another. A test of each states what must hold.
- **The automation of the project is pinned and limited.** The actions that are not GitHub's own (Docker's build and publish
  actions, the link checker, the SBOM generator) are used by the commit they were published at, not by a tag that their owner can
  move to other code that would run with the project's token; Dependabot keeps the commits up to date. The main workflow of
  the project (`ci.yml`) now says that its token only reads the code, instead of taking the repository's default. A test of the
  workflows fails if an action is used by a tag again, or a workflow forgets its permissions. Nothing changes for a platform
  that runs.
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

[Unreleased]: https://github.com/edouardbautz/BDE_Network/compare/v1.5.0...HEAD
[1.5.0]: https://github.com/edouardbautz/BDE_Network/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/edouardbautz/BDE_Network/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/edouardbautz/BDE_Network/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/edouardbautz/BDE_Network/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/edouardbautz/BDE_Network/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/edouardbautz/BDE_Network/compare/v0.2.0...v1.0.0
[0.2.0]: https://github.com/edouardbautz/BDE_Network/releases/tag/v0.2.0
