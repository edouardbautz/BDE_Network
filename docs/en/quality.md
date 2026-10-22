🇬🇧 English · [🇫🇷 Français](../fr/quality.md)

# Quality: what is checked, how, and what it found

A BDE entrusts this platform with its members, its calendar and its sign-in. This page says what is done to deserve it:
what is checked, how often, what the checks found, and, as important, **what they do not cover**. Every sentence here
is backed by a test or a workflow of the repository; the technical detail is in the
[architecture](../architecture.md#quality-campaign-qa-githubworkflowsqayml).

It describes the project as of version 1.2.0 plus the changes since (see the [CHANGELOG](../../CHANGELOG.md)).

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
- **Updates.** A platform of **1.0.0, 1.1.0 or 1.2.0**, given the data of an old installation (roles, members, series of events
  of every repetition, a cancelled and a moved date), is updated the way the [upgrading guide](upgrading.md) says. What the old
  version said about its own data (every date of its calendar files, its roles, its rows) is what the new one is held to; then
  a backup, its restore, and the way back to the old version.
- **Long time.** A year and a half of the reminder loop, played on a real database and compared with a calculation that does not
  use its code: every reminder sent exactly once, on time, across the two changes of clock; and the school year at every
  first of September to 2032.
- **A walk through the interface.** As each profile, on a computer and on a phone, every link is followed and every menu and
  dialog opened, looking for a dead link, a page with no heading, a page that scrolls sideways, a picture that does not load, a
  menu that breaks the page.

Every pull request is also read by static analysis: the project's own rules (Semgrep: no setting read around the settings, no
raw SQL built from text, no link that skips the language router…), a search for secrets in the whole history (gitleaks), CodeQL on
the code and on the workflows, Trivy on the dependencies, the files and the image, and a review of the dependencies it adds. The
actions of the workflows are pinned to a commit.

## What it found

Since version 1.2.0, the campaign has found and fixed **22 defects**, each in a pull request of its own with a test that would
have caught it. The details are in the [CHANGELOG](../../CHANGELOG.md) (sections "Fixed" and "Security" of the unreleased
changes).

| Kind                  | Count | Examples                                                                                                                                                                                                                                                                           |
| --------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does not work         | 1     | **The menu of the signed-in person (profile, sign out) crashed when opened**, in every released version: no test had ever opened it.                                                                                                                                               |
| Operations            | 3     | Going back to the previous version with `restore.sh` did not work in the order the guide gave; a frozen database held every page for as long as it lasted; a webhook or mail server that never answers held a connection for minutes.                                              |
| Security and privacy  | 9     | The export of one's own data could be kept by a cache; the logo's strict policy was replaced by the pages'; a malformed address or an unreadable `callbackUrl` gave a server error; every page violated the platform's own content policy; the workflows' actions were not pinned. |
| Accessibility and use | 7     | Menus and tables unreachable or unreadable with the keyboard or a screen reader, text too pale on red buttons, calendar events too small to hit, a list with no visible focus in Safari, three pages with no heading.                                                              |
| Speed                 | 2     | The calendar made the server draw the page of every event of the month in advance (110 requests, against 13 to 18 for the other pages); a long page jumped sideways when it finished loading.                                                                                      |

Nothing is claimed beyond that. In particular, **the suites looked for and did not find**: a path where a profile could do what it
may not (the access matrix and the attacks), a write left half done when the database or the application is killed, a session lost
by an outage, a date, an hour, a right or a row changed by an update from 1.0.0, 1.1.0 or 1.2.0, a reminder sent twice or not
sent over a year and a half, and a dead link in the interface.

## What is not covered

Being clear about this matters as much as the rest.

- **There is no rate limit in the platform**, except on the installer's code. Signing in goes through 42 (there is no password to
  guess), but nothing stops somebody from flooding the site: if that matters to you, limit it in your reverse proxy
  ([Deployment](deployment.md#3-https-reverse-proxy)). The tests write down what the platform accepts.
- **42 and the chat services are stood in for.** Signing in through the real 42, and delivering to a real Discord, Slack or mail
  server, are not tested; a stand-in plays their part, including one that never answers.
- **The mail server** is tested against a silent server and by unit tests, not by a platform that sends real mail.
- **An update from a platform installed with the web installer** is not played (it needs a browser); the update suite starts
  from the settings files of 1.0.0, 1.1.0 and 1.2.0, then imports them. An update that fails in the middle is covered by the
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
