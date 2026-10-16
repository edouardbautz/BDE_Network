# Coverage: where we are, and how the gaps are closed

What the unit tests cover, what they do not, and why. Regenerate the numbers with `npm run test:coverage`, then
`node scripts/coverage-gaps.mjs` (the gaps, worst first) and `node scripts/coverage-report.mjs` (each area against its
floor in `coverage-thresholds.json`).

## Where we are

The V8 coverage of the unit tests, over `src/`, `docker/`, `scripts/` (the gates that CI runs by themselves, the generated components and the harness are left
out: `check-docs`, `audit-prod`, `docs-screenshots`):

|            | before the campaign | now    | floor (CI fails below) |
| ---------- | ------------------- | ------ | ---------------------- |
| statements | 88.0 %              | 94.2 % | 93                     |
| branches   | 87.7 %              | 90.5 % | 89                     |
| functions  | 86.5 %              | 90.5 % | 89                     |
| lines      | 88.9 %              | 95.1 % | 94                     |

The areas that decide who may do what, and what is written to the database, are all above 95 % of their statements:
permissions 100, roles 99.5, notifications 100, members 100, `app/api` 100, events 97.7, auth 97.2, settings 96.6,
setup 96. Each has a floor of its own, so a drop in one cannot hide behind the others.

The floors are a **ratchet**: a number goes up when the tests do (the report marks the floors that have 2.5 points or
more of room), and goes down only in a pull request that says why.

## What was added to get there

Tests for what had none: the choice of the channel of a notification (and that a failing adapter does not stop the
others), the queries of the proposals and of the members that can be put in charge, the installation of the platform
(secrets sealed apart, the loser of a race changes nothing), the waiting page, the privacy policy and the page of a
database that is down (with the real French messages, so a missing key shows), the arguments a crafted request can
send to the members' actions, the overlap and failure of a reminder tick, and the inspector of the logo, on hostile
files (progressive JPEG, tables that look like a frame, padding, segments that lie, a WebP of an unknown kind, and 4 000
random files that only start like an image: it never throws and never claims a size that is not a whole number).

## What is still not covered, and the plan

Ordered by what a mistake would cost. "Phase" is a phase of the quality campaign (`docs/architecture.md`).

| Risk     | Where                                                                                                                           | Not covered                                                                                  | Why it is not a unit test, and what covers it                                                                                                                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| critical | `docker/start.mjs` (31 statements)                                                                                              | the part that starts the real processes (`migrate deploy`, the server, the explanation page) | needs a container and a PostgreSQL: `e2e/safe-update.sh` and the CI steps that start broken platforms play it. **Phase 8** (resilience) kills the database and the container in the middle of it.                                                                                                   |
| critical | `settings/actions.ts`, `settings/update.ts`, `setup/actions.ts`, `settings/store.ts`, `setup/fortytwo.ts`                       | about 40 statements and the error branches of the validation of what the browser sends       | each answers a code for a crafted request. **Phase 2** (access matrix: every action × every profile) and **phase 3** (injections in every field) call every one of them with what a hostile browser sends; the numbers are read again afterwards.                                                   |
| critical | `events/actions.ts`, `members/actions.ts`                                                                                       | the logging of a notification that failed, the notice of a conflict                          | best-effort paths, never allowed to break the action. **Phase 8** and **10** (a webhook that is down, a tick that fails for months).                                                                                                                                                                |
| high     | `events/series-operations.ts`, `events/notifications.ts`                                                                        | 11 statements                                                                                | series that become ordinary events, an announcement that finds its event gone. **Phase 10** (months of series, cuts, clock changes).                                                                                                                                                                |
| medium   | `events/[id]/page.tsx` (68 %), `events/review/page.tsx`, `shared-calendar/page.tsx`                                             | the less usual states of the page of an event                                                | **Phase 5 and 6** open every state of every page (accessibility, visual regression).                                                                                                                                                                                                                |
| medium   | `layout.tsx`, `profile/page.tsx`, `user-menu.tsx`, `theme-toggle.tsx`, `copy-field.tsx`, `upcoming-events-card.tsx` (0 to 36 %) | rendering                                                                                    | played by the browser scripts of `e2e/`, which this measure does not see. **Phase 5** renders each of them in every language and theme; when that is in place a unit render test costs nothing more and raises the floor of `src/app` and `src/components`, which only have the global floor today. |
| low      | `scripts/release.mjs`                                                                                                           | the error paths of the release check                                                         | run by the release workflow itself.                                                                                                                                                                                                                                                                 |

`src/app` (88.8 %) and `src/components` (91 %) have no floor of their own yet: they are mostly rendering, which the
browser suites of the later phases judge better than a line count. When those exist, their floors are set from the
measure.
