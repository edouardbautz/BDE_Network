#!/bin/sh
# One shard of the browser tests of the `docker image` job of ci.yml: a platform of its own, made by the installer from the image
# `bde-network` (already built and loaded), and the scripts of e2e/ that belong to the shard. The shards are independent (each one
# installs its own platform, as e2e-stress.yml does for a script alone), so they run at the same time, each in a job of its own.
#
#   sh e2e/ci-browser.sh 1|2|3|4
#
# It needs a PostgreSQL on 127.0.0.1:5432 (user `bde`, password `ci-password`), Docker, Node and Chrome, as the job gives them.
# A script that is added to e2e/ goes in one of the shards below: the shards are balanced by the time each takes (about 2.5 minutes
# each), and `e2e/actions.mjs` scenarios that are not listed for the first shard run in the second (EXCEPT), so a new scenario is
# played without anybody having to place it.
set -eu

shard="${1:?usage: sh e2e/ci-browser.sh 1|2|3|4}"
temp="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
psql_installed="psql -h 127.0.0.1 -U bde -d bde_install"
export PGPASSWORD=ci-password

PGPASSWORD=ci-password psql -h 127.0.0.1 -U bde -d postgres -c 'CREATE DATABASE bde_install'
mkdir -p "$temp/e2e-deps"
npm install --prefix "$temp/e2e-deps" --no-audit --no-fund puppeteer-core@25.12.0 @auth/core@0.41.3
ln -s "$temp/e2e-deps/node_modules" e2e/node_modules
MOCK_LATEST_RELEASE=v99.0.0 node e2e/mock-fortytwo.mjs 4242 &
docker run -d --name installer --network host -e PORT=3003 \
  -e DATABASE_URL='postgresql://bde:ci-password@127.0.0.1:5432/bde_install?schema=public' \
  -e FORTYTWO_API_URL=http://127.0.0.1:4242 \
  -e RELEASES_API_URL=http://127.0.0.1:4242 \
  bde-network
code=""
for attempt in $(seq 1 45); do
  code="$(docker logs installer 2>&1 | grep -o 'Code : [A-Z0-9-]*' | tail -1 | sed 's/Code : //')"
  [ -n "$code" ] && break
  sleep 2
done
[ -n "$code" ] || { docker logs installer; exit 1; }
SHOTS="$temp/shots/install" node e2e/install.mjs http://127.0.0.1:3003 "$code"

# The platform the installer has just made: its owner ("alice") and a plain member get an account, and the scripts forge their
# sessions with the platform's own secret (nobody can sign in through 42 here); two events and two series for the scripts to work on.
$psql_installed -v ON_ERROR_STOP=1 \
  -c "INSERT INTO \"User\" (id, login, \"fullName\", email, campus, status, \"updatedAt\") VALUES ('e2e-alice', 'alice', 'Alice', 'alice@example.org', 'Nice', 'OWNER', now()) ON CONFLICT (login) DO UPDATE SET status = 'OWNER', \"roleId\" = NULL" \
  -c "INSERT INTO \"User\" (id, login, \"fullName\", email, campus, status, \"roleId\", \"updatedAt\") SELECT 'e2e-carol', 'carol', 'Carol', 'carol@example.org', 'Nice', 'MEMBER', id, now() FROM \"Role\" WHERE \"isDefault\"" \
  -c "INSERT INTO \"Event\" (id, title, description, location, \"categoryKey\", status, \"startsAt\", \"endsAt\", repeat, \"recurrenceUntil\", \"schoolYear\", \"authorLogin\", \"updatedAt\") VALUES ('e2e-weekly', 'E2E weekly', 'Test', 'Room', 'soiree', 'CONFIRMED', now() + interval '1 day', now() + interval '1 day 2 hours', jsonb_build_object('freq', 'WEEKLY', 'interval', 1), now() + interval '70 days', '2026-2027', 'alice', now())" \
  -c "INSERT INTO \"Event\" (id, title, description, location, \"categoryKey\", status, \"startsAt\", \"endsAt\", repeat, \"recurrenceUntil\", \"schoolYear\", \"authorLogin\", \"updatedAt\") SELECT 'e2e-series-' || lang, 'E2E series', 'Test', 'Room', 'soiree', 'CONFIRMED', now() + interval '2 days', now() + interval '2 days 2 hours', jsonb_build_object('freq', 'WEEKLY', 'interval', 1), now() + interval '38 days', '2026-2027', 'alice', now() FROM (VALUES ('fr'), ('en')) AS languages(lang)"

base=http://127.0.0.1:3003
secret() { docker exec installer cat /secrets/auth_secret; }

# What every action of the platform shows afterwards, 3 plays of each, with no reload ("Actions that stay on the page" in
# docs/architecture.md). The first shard plays the scenarios of the pages of the owner; the second all the others.
FIRST_SHARD_SCENARIOS='members:|roles:|settings:|profile:|shared calendar:'

case "$shard" in
  1)
    AUTH_SECRET="$(secret)" OWNER=alice OWNER_CANDIDATE=bob PSQL="$psql_installed" ONLY="$FIRST_SHARD_SCENARIOS" SHOTS="$temp/shots/actions" node e2e/actions.mjs "$base"
    # The settings page, with the platform as the installer left it.
    AUTH_SECRET="$(secret)" SHOTS="$temp/shots/settings" node e2e/settings.mjs "$base"
    # The sign-in with 42 (the stand-in plays 42, and refuses a code like the real one when the redirect_uri of the exchange is
    # not the one of the authorization). The image listens on 0.0.0.0, which is what Next.js puts in every request URL: the
    # registered address (this computer is written localhost) must be what 42 is given.
    SHOTS="$temp/shots/signin" node e2e/signin.mjs http://localhost:3003 http://127.0.0.1:4242 "$base"
    ;;
  2)
    AUTH_SECRET="$(secret)" OWNER=alice OWNER_CANDIDATE=bob PSQL="$psql_installed" EXCEPT="$FIRST_SHARD_SCENARIOS" SHOTS="$temp/shots/actions" node e2e/actions.mjs "$base"
    # The dialogs of a series (one date, or this date and the following: edit, draft, confirm, cancel, delete), clicked for real, in
    # both languages: a series is cut in two rows, and the page after the action must be the one that holds the date.
    AUTH_SECRET="$(secret)" SHOTS="$temp/shots/series" node e2e/series.mjs "$base"
    ;;
  3)
    # Pages hydrated on a slow connection, with their scripts in the browser's cache ("A hydration error on a slow connection" in
    # docs/architecture.md).
    AUTH_SECRET="$(secret)" LOADS=20 PAGES=/en/events,/en/dashboard SHOTS="$temp/shots/hydration" node e2e/hydration.mjs "$base"
    # The repeat rules, in both languages: a usual choice and a custom rule worded and previewed by the form before they are saved,
    # a first date that moves to the first one that fits, the limit of an event, a series cut in two and the rule of a series edited.
    AUTH_SECRET="$(secret)" OWNER=alice PSQL="$psql_installed" SHOTS="$temp/shots/repeat" node e2e/repeat.mjs "$base"
    ;;
  4)
    # The buttons of the events page (month, calendar or list, a day, one date of a series, the menu), clicked for real on a
    # computer-sized and a phone-sized screen, in both languages ("Navigation" in docs/architecture.md).
    AUTH_SECRET="$(secret)" SHOTS="$temp/shots/events" node e2e/events.mjs "$base"
    # The proposal circuit, in both languages: somebody whose role only proposes creates an event, a validator finds it counted in
    # the menu and approves it or refuses it with a comment, and what a proposer or a member may not see or do.
    AUTH_SECRET="$(secret)" OWNER=alice MEMBER=carol PSQL="$psql_installed" SHOTS="$temp/shots/review" node e2e/review.mjs "$base"
    ;;
  *)
    echo "unknown shard $shard: 1, 2, 3 or 4" >&2
    exit 2
    ;;
esac

# Nothing secret in the log of the platform nor in clear in its database, and the platform never restarted by itself.
! docker logs installer 2>&1 | grep -q 's-s4t2ud-e2e-test-secret'
[ "$($psql_installed -tAc 'SELECT secrets LIKE $$%e2e-test-secret%$$ FROM "PlatformSettings"')" = f ]
[ "$(docker inspect -f '{{.State.Running}} {{.RestartCount}}' installer)" = "true 0" ]
docker rm -f installer
rm e2e/node_modules
