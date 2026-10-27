🇬🇧 English · [🇫🇷 Français](../fr/quality.md)

# Quality: what is checked, how, and what it found

A BDE entrusts this platform with its members, its calendar and its sign-in. This page says what is done to deserve it:
what is checked, how often, what the checks found, and, as important, **what they do not cover**. Every sentence here
is backed by a test or a workflow of the repository; the technical detail is in the
[architecture](../architecture.md#quality-campaign-qa-githubworkflowsqayml).

It describes the project as of version 1.3.0 (see the [CHANGELOG](../../CHANGELOG.md)).

## What is checked, and when

| When                                   | What                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Every pull request** (a few minutes) | Types, lint, formatting; more than 3,000 unit tests, with a **minimum coverage** that only goes up (91 to 100 % for each area that decides who may do what or what is written to the database); every migration on a real PostgreSQL; the documentation (links, anchors, FR/EN twins); the image built, started and updated; static security (below). |
| **Every night**, and on demand         | The heavy suites below, on the real image, a real PostgreSQL and a dataset of about 300 members and 600 events over two school years.                                                                                                                                                                                                                 |
| **Before a release**                   | The last nightly run on the commit to tag must be green; the release workflow tests the image it is about to publish, on both architectures, before naming it.                                                                                                                                                                                        |

Nobody signs in through 42 in these tests: the session cookie of each profile is forged with the platform's own secret, the
way the platform writes it. The profiles are nine: visitor, account waiting for approval, member, member who proposes
events, member who validates them, member with a custom role, member with the Admin role, owner, and a removed member
whose cookie is still valid.

## What the nightly suites do

- **Who may do what.** Every page, every route of the API and every server action, as each of the nine profiles, with the
  events module on and off. A refusal must change nothing in the database and show nothing of anybody; what is allowed must
  really go through and write what it should (a gate that refuses everybody would otherwise look "secure"). A new page
  or action fails the tests of the pull request that adds it until it is in the list.
- **Attacks.** Headers and cache rules of every kind of answer; forged, expired and cut session cookies; an action called
  from another site; 300 guesses of a calendar link; hostile text typed into every field and read back as a browser would;
  trapped logo uploads; floods of wrong requests; and the logs, searched for any secret met during the run. OWASP ZAP scans
  the running platform, signed in as the owner. On demand, the attacks are themselves checked by breaking a guard on
  purpose and building the image, to see that they notice.
- **Backups.** A platform started with `docker compose up -d`, with the clock of the platform set to ten past three in the morning: it
  makes its backup by itself and reads it again; the owner downloads it with a passphrase; `docker compose down -v` removes every
  volume; on a new server `restore.sh` puts the backup back, then the downloaded file (a wrong passphrase touches nothing). The same rows,
  the same keys, the session of before still open. Then the database is stopped at the hour of the backup: the failure is written down, the
  previous backup is untouched, and the Settings page says what failed.
- **Browsers.** The journeys of the platform (a proposal approved, a refusal with its comment, the calendar, the settings, the
  keyboard) in **Chromium, Firefox and WebKit** (Safari's engine). Every journey fails if its pages raise an exception,
  write an error to the console, break their own content-security policy or get a server error.
- **Accessibility.** Every page checked against WCAG 2.2 level AA (axe), as two profiles each, in two combinations (English, light, computer;
  French, dark, phone); and the keyboard alone: the skip link, the menus, the drawer of a phone, a form that says
  what is wrong, and a visible focus on everything Tab reaches.
- **Look.** 80 pictures of the pages are compared with reference pictures, so a change of look nobody meant is seen.
- **Speed and load.** Lighthouse judges seven pages against written budgets (weight, requests, layout shift, scores); 20 people
  at once browse the platform with a limit per page and a check of the memory afterwards.
- **Resilience.** The database stopped, frozen and killed in the middle of writes; the application stopped and killed in the
  middle of writes; a webhook that accepts the connection and never answers. The platform must say it cannot, quickly, come
  back by itself, keep people signed in, and leave **no write half done**.
- **Updates.** A platform of **1.0.0, 1.1.0, 1.2.0, 1.3.0 or 1.4.0**, given the data of an old installation (roles, members, series
  of events of every repetition, a cancelled and a moved date; from 1.3.0, roles that propose, validate and manage the shared
  calendar, series with advanced rules, proposals, a refusal with its comment), is updated the way the [upgrading guide](upgrading.md) says. What the old
  version said about its own data (every date of its calendar files, its roles, its rows) is what the new one is held to; then
  a backup, its restore, and the way back to the old version.
- **Long time.** A year and a half of the reminder loop, played on a real database and compared with a calculation that does not
  use its code: every reminder sent exactly once, on time, across the two changes of clock; and the school year at every
  first of September to 2032.
- **A walk through the interface.** As each profile, on a computer and on a phone, every link is followed and every menu and
  dialog opened, looking for a dead link, a page with no heading, a page that scrolls sideways, a picture that does not load, a
  menu that breaks the page.
- **Privacy.** Every column of the database that can hold a person is read from the schema and classified: where the
  export of one's data finds it, and that an account can always be deleted. On a real database with the QA dataset, removing an
  account must leave **no e-mail address, full name, picture or personal calendar link anywhere**, and the login only where the
  privacy policy page of the platform (`/privacy`) says (the audit log, the events written, the people in charge); the rows of that
  history are kept. These run in every pull request, not only at night.
- **The tests of the rules are tested.** A mutation tester changes the code of the rules that decide who may do what (permissions,
  roles, the proposal circuit, what a session holds, who becomes an owner, what the logo may be) one operator at a time, and the
  tests must fail for each change; the job fails below 95 % (97.6 % at the last measure).

Every pull request is also read by static analysis: the project's own rules (Semgrep: no setting read around the settings, no
raw SQL built from text, no link that skips the language router…), a search for secrets in the whole history (gitleaks), CodeQL on
the code and on the workflows, Trivy on the dependencies, the files and the image, and a review of the dependencies it adds. The
actions of the workflows are pinned to a commit.

## What it found

Since version 1.2.0, the campaign has found and fixed **23 defects**, each in a pull request of its own with a test that would
have caught it. The details are in the [CHANGELOG](../../CHANGELOG.md) (sections "Fixed" and "Security" of the unreleased
changes).

| Kind                  | Count | Examples                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does not work         | 1     | **The menu of the signed-in person (profile, sign out) crashed when opened**, in every released version: no test had ever opened it.                                                                                                                                                                                                                                                                                                              |
| Operations            | 3     | Going back to the previous version with `restore.sh` did not work in the order the guide gave; a frozen database held every page for as long as it lasted; a webhook or mail server that never answers held a connection for minutes.                                                                                                                                                                                                             |
| Security and privacy  | 10    | The export of one's own data could be kept by a cache, and it left out four kinds of data the platform holds about the person (dates in charge of, dates cancelled, proposals refused, what was done to the account); the logo's strict policy was replaced by the pages'; a malformed address or an unreadable `callbackUrl` gave a server error; every page violated the platform's own content policy; the workflows' actions were not pinned. |
| Accessibility and use | 7     | Menus and tables unreachable or unreadable with the keyboard or a screen reader, text too pale on red buttons, calendar events too small to hit, a list with no visible focus in Safari, three pages with no heading.                                                                                                                                                                                                                             |
| Speed                 | 2     | The calendar made the server draw the page of every event of the month in advance (110 requests, against 13 to 18 for the other pages); a long page jumped sideways when it finished loading.                                                                                                                                                                                                                                                     |

Nothing is claimed beyond that. In particular, **the suites looked for and did not find**: a path where a profile could do what it
may not (the access matrix and the attacks), a write left half done when the database or the application is killed, an e-mail address, a name, a picture or a calendar link left behind by the removal of an account, a session lost
by an outage, a date, an hour, a right or a row changed by an update from 1.0.0, 1.1.0, 1.2.0, 1.3.0 or 1.4.0, a reminder sent twice or not
sent over a year and a half, and a dead link in the interface.

## Speed and resources: the numbers

A BDE often hosts the platform on a small server that nobody watches. An optimisation campaign therefore starts from
**measures**, taken the same way before and after each change, and a change that does not show a measured gain is not
made. `qa/optim` takes them on the production image and the quality dataset (`npx tsx qa/optim/measure.ts`); the
`measures` workflow does it every night on the CI's machine (4 CPUs, 16 GiB, bigger than a school's server), on three
datasets: two school years with 300 members, a BDE as they are (150 accounts) and five years with 1,500 members. The
numbers in bytes and in statements do not depend on the machine; the durations only compare with other measures taken
on the same one. The raw measures of the starting point are in `qa/optim/baselines/`.

| What                                                           | Before (2026-10-27)         | Objective                          | Now                                                 |
| -------------------------------------------------------------- | --------------------------- | ---------------------------------- | --------------------------------------------------- |
| Docker image                                                   | 318 MiB                     | 250 MiB or less                    | 246.7 MiB                                           |
| Scripts loaded at once: sign-in, dashboard, an event           | 211, 217 and 242 KiB        | 200 KiB or less                    | 175, 181 and 205 KiB                                |
| Largest contentful paint on a phone, slow network: dashboard   | 4.2 s (an event: 4.3 s)     | 3.5 s or less                      | **3.7 s** (an event: 4.2 s)                         |
| Statements sent to the database: dashboard, calendar, an event | 10, 12 and 10               | 8 or fewer                         | 2, 4 and 2                                          |
| Memory of the application under the load of 20 people          | 1,105 MiB (103 MiB at rest) | 450 MiB or less, same throughput   | 450 MiB (340 to 476 in earlier runs)                |
| 95 % of the answers under that load                            | 1.56 s                      | 30 % less                          | 0.8 s (**49 % less**; 1.2 to 1.4 s in earlier runs) |
| Restart until the platform answers                             | 2.6 s                       | 1.6 s or less                      | 1.1 s                                               |
| The smallest server that holds the load                        | not tried                   | 1 CPU and 1 GiB, no request failed | 1 CPU, 1 GiB: no request failed                     |
| Docker logs                                                    | no limit                    | 30 MiB at most                     | 30 MiB at most per service                          |
| Duration of the checks of a pull request                       | 12 to 17 minutes            | 9 minutes or less, same checks     | 5.4 minutes                                         |

**Steps done.** (The first reading of the scripts counted the polyfills of the `nomodule` tag, about 39 KiB, which no browser that matters downloads: the figures above are recounted.) The sign-in, the dashboard and an event load 175, 181 and 205 KiB of scripts first: Zod, which two lines of the code of the languages brought into every page, is gone, and the code that draws the toasts is fetched once the page is interactive. The blocking time of the dashboard on a phone falls from 236 to 165 ms and its largest contentful paint from 4.1 to 3.9 s (same machine, five runs each): that paint is bound by the processor, which runs the scripts four times slower in this test, so only less script lowers it, and 3.5 s would take a different way of building the pages. The checks of a pull request run as parallel jobs on an image built once (5.4 minutes, from the run of the pull
request itself). A page reads its relations with a join and the session with one statement, which cut the statements of the
dashboard, the calendar and an event to 2, 4 and 2; on 1 CPU and 1 GiB with the load of 20 people, the platform answers 7.3 to
7.4 requests a second instead of 6.3 to 6.6, and 95 % of the answers come under 2.9 to 3.2 s instead of 3.3 to 3.8 s. The image is Alpine plus the binary of Node.js, and the Prisma tool is pruned of what it never loads (318 → 246 MiB on the CI); Node.js is told to keep its heap under 384 MiB (1,123 MiB without, for the same throughput: 12.7 to 14.0 requests a second with, 13.9 without, runs of the same CI runner differ by that much); the Prisma command is not started when the database is current (restart 2.6 → 1.4-1.6 s). The 30 % on the answers under load is reached in the last measure (0.8 s against 1.56 s) and not in the two before (1.2 to 1.4 s): a runner varies by 10 % from one run to the next.

What the measures say, which decides where the effort goes: the database is not the bottleneck (no page sends a statement
five times or more, none sends more than 12, and a page spends 0.1 to 7 ms in the database even with five years of data);
the Node.js process is, in memory and in processor. The data grows slowly: the audit log writes about 300 bytes a line and
holds 1,319 lines after two school years, and the whole database weighs 10 MiB (12.6 MiB with five years and 1,500 members),
so no purge is planned. An empty database already weighs 8.2 MiB, so the data of a BDE grows by about 1 MiB a year (five years and 1,500 accounts: 4.4 MiB), and a backup of it is a few MiB. The logs are the other thing that grows on a server nobody watches: Docker now cuts them (three files of 10 MB at most per service), and each service has a ceiling for its memory (`APP_MEMORY`, `DB_MEMORY`).

**The objectives that were not reached.** The largest contentful paint of a phone on a slow network is 3.7 s for the dashboard and 4.2 s for an event, against 3.5 s: it is bound by the processor, which runs the scripts four times slower in this test, so only less script lowers it. The scripts of an event are 205 KiB against 200. The memory under load is 450 MiB, on the line. The answers under load are 49 % faster in the last measure of the CI and 10 to 25 % faster in the earlier ones: a shared runner varies by about 10 % from one run to the next, so the `measures` workflow keeps the raw numbers and the budgets below are set with room.

**What was looked at and left alone.** The code was searched for dead code, duplication and dependencies that nothing uses: 0.06 % of the lines are duplicated, the two packages that nothing uses (`@eslint/eslintrc`, `cross-env`) take two packages out of 1,109 of the lock and nothing out of the image, and the unused exports are types and helpers that cost no byte at run time. None of it gives a measurable gain, so none of it was changed. Two other ideas were tried and not kept: precompiling the messages (no gain on the largest contentful paint, and the precompiler of next-intl is experimental and fails on four of our messages) and loading only the messages a page uses (the same, for 24 KiB).

**Budgets.** The gains do not stay by themselves. `qa/optim/budgets.json` holds the numbers a change must not go over, and the `budgets` job of every pull request fails above them: the size of the image (260 MiB), and for each page the statements it sends to the database, the scripts it loads at once and its HTML. A new page fails until it has its numbers. Every night the `measures` workflow adds the server: restart (2 s), memory at rest (160 MiB), peak memory under load (600 MiB) and no failed request. Going over a budget is a pull request that raises it and says why.

**A known limit.** The members page lists every account at once, with no pagination: a BDE has tens of accounts (the
board and the staff), and the page is built for that. With 150 accounts, more than a BDE has, it takes 109 ms to build and
weighs 64 KiB of HTML, with 7 statements and 0.6 ms in the database. With 1,511 accounts it takes 628 ms to build and weighs 272 KiB of
HTML (89 KiB with 311 accounts, where the largest contentful paint on a phone is already 4.6 s). Past a few hundred accounts,
paginate it before relying on it.

## What is not covered

Being clear about this matters as much as the rest.

- **There is no rate limit in the platform**, except on the installer's code. Signing in goes through 42 (there is no password to
  guess), but nothing stops somebody from flooding the site: if that matters to you, limit it in your reverse proxy
  ([Deployment](deployment.md#3-https-reverse-proxy)). The tests write down what the platform accepts.
- **42 and the chat services are stood in for.** Signing in through the real 42, and delivering to a real Discord, Slack or mail
  server, are not tested; a stand-in plays their part, including one that never answers.
- **A rootless Docker** is not played against a real rootless daemon: the folder of the backups that the application cannot write is played
  as a failure with its reason, and the stack starts anyway; what the daemon does with the owner of a folder is Docker's.
- **The mail server** is tested against a silent server and by unit tests, not by a platform that sends real mail.
- **An update from a platform installed with the web installer** is not played (it needs a browser); the update suite starts
  from the settings files of 1.0.0 to 1.4.0, then imports them. An update that fails in the middle is covered by the
  [safe update](deployment.md#automatic-copy-before-an-update) script, not by this suite.
- **The load** is 20 people at once, which is a BDE, not a school's whole intranet.
- **The visual and accessibility checks** run in Chromium (the keyboard and the journeys run in the three engines); a screen
  reader is not part of the tests: axe finds a part of what is wrong, a person finds the rest.
- **Forms are looked at, not filled** by the walk through the interface; the journeys and the access matrix submit them.

If you find something these checks missed, please report it (see [Security](../../SECURITY.md) for a vulnerability, an issue
otherwise): a defect found is a test written.

## Run it yourself

With Docker and Node, from the project folder (see also the [contributor guide](contributing.md#the-quality-campaign)):

```text
docker build -t bde-network .
sh qa/platform.sh up
eval "$(sh qa/platform.sh env)"
npx tsx qa/smoke.ts                 # is it up, do the profiles differ, does the database hold its invariants
npx tsx qa/access/run.ts --variant events-enabled   # who may open what
npx tsx qa/security/run.ts          # the attacks
sh qa/platform.sh down
```

The other suites have their own commands, written with each one in the architecture. The heavy ones are meant for the
nightly run: the numbers that count are those of the CI, not of a computer.
