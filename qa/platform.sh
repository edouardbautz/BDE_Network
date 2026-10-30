#!/bin/sh
# A platform for the quality suites: the real production image, a real PostgreSQL, an installed BDE (its settings are
# imported from files, so no browser is needed), and the QA dataset. The same script runs in the workflows and on a
# developer's machine; only Docker, Node (for `npm ci` and `tsx`) and `curl` are needed.
#
#   sh qa/platform.sh up   [--image bde-network] [--port 3100] [--variant events-enabled|events-disabled|events-intra]
#                          [--dataset full|club|large|small|none] [--keep-config] [--now 2026-10-16T12:00:00Z] [--stats]
#                          [--webhook https://qa-hang:8443/hook]
#   sh qa/platform.sh env  [--port 3100]     the variables the suites read (QA_BASE_URL, QA_AUTH_SECRET, QA_DATABASE_URL)
#   sh qa/platform.sh logs
#   sh qa/platform.sh down
#
# `--dataset club` is a BDE as they are (150 accounts, two school years); `--dataset large` is five school years and five times the
# members of `full` (qa/optim measures the platform on the three). `--stats`
# loads `pg_stat_statements` in PostgreSQL, to count the statements a page sends (qa/optim/measure.ts).
#
# `QA_APP_CPUS=1 QA_APP_MEMORY=1g` in the environment limits the container of the application (`QA_DATABASE_MEMORY=256m` that of
# PostgreSQL), to try the platform on the small server of a school (qa/optim measures it that way).
#
# `--now` sets the clock of the application to the moment of the dataset (qa/fake-clock.cjs, which runs from there at the normal
# speed): the dates to come, the day marked as today and the reminders are then the same whenever the platform is made.
#
# `QA_ACCENT=#E4572E` in the environment gives the platform that accent colour (default #0f766e): the pictures of a change of look are taken with several.
# `--webhook` sends the notifications of the events to that address as Discord messages, so that a suite can make the other
# side slow, deaf or absent (qa/resilience): the platform must not notice, except in its logs. The address must be https (the
# platform refuses any other) and the suite's stand-in has a certificate nobody signed, so the application of this platform
# alone does not verify certificates (NODE_TLS_REJECT_UNAUTHORIZED=0); nothing of a real installation does.
#
# The accounts are the personas of qa/personas.ts: the owner of the platform is `qa-owner`. Nothing here is reused by
# a real installation: the secrets are public, the 42 API and the release API are pointed at an address that answers
# nothing (the platform must work without them), and the ports listen on 127.0.0.1 only.

set -eu

NETWORK=qa-net
DATABASE_CONTAINER=qa-postgres
APP_CONTAINER=qa-app
DATABASE_PORT="${QA_DATABASE_PORT:-55432}"
AUTH_SECRET_VALUE='qa-only-secret-never-used-anywhere-else-0123456789abcdef'

IMAGE=bde-network
PORT=3100
VARIANT=events-enabled
DATASET=full
NOW=
WEBHOOK=
STATS=

command="${1:-}"
[ $# -gt 0 ] && shift
while [ $# -gt 0 ]; do
  case "$1" in
    --image) IMAGE="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --variant) VARIANT="$2"; shift 2 ;;
    --dataset) DATASET="$2"; shift 2 ;;
    --now) NOW="$2"; shift 2 ;;
    --webhook) WEBHOOK="$2"; shift 2 ;;
    --stats) STATS=1; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

database_url() {
  printf 'postgresql://bde:qa-password@127.0.0.1:%s/bde_network?schema=public' "$DATABASE_PORT"
}

# Git Bash on Windows rewrites /app/... arguments and gives Docker paths it cannot read.
export MSYS_NO_PATHCONV=1
host_path() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi
}

write_config() {
  case "$VARIANT" in
    events-enabled) modules='[events]'; intra=false ;;
    events-disabled) modules='[]'; intra=false ;;
    events-intra) modules='[events]'; intra=true ;;
    *) echo "unknown variant $VARIANT" >&2; exit 2 ;;
  esac
  channels='[]'
  [ -n "$WEBHOOK" ] && channels='[discord]'
  cat >"$1" <<EOF
bde:
  name: 'BDE QA'
  campus: 'Paris'
  timezone: 'Europe/Paris'
  defaultLocale: 'fr'
  accentColor: '${QA_ACCENT:-#0f766e}'
  logoPath: '/logo.svg'
auth:
  owners:
    - 'qa-owner'
  allowedCampuses: []
modules:
  enabled: $modules
events:
  categories:
    - { key: 'soiree', label: 'Soirée', color: '#db2777' }
    - { key: 'sport', label: 'Sport', color: '#16a34a' }
    - { key: 'wei', label: 'WEI', color: '#ea580c' }
    - { key: 'partenariat', label: 'Partenariat', color: '#2563eb' }
  reminderHour: 18
  intraPublication: $intra
notifications:
  memberPending: []
  memberApproved: []
  memberRemoved: []
  eventConfirmed: $channels
  eventReminder: $channels
  eventProposed: $channels
  eventApproved: $channels
  eventRefused: $channels
  intraRequested: $channels
  intraChanged: $channels
  intraCancelled: $channels
  intraPublished: $channels
  intraRefused: $channels
updates:
  check: false
EOF
}

wait_for() {
  # wait_for <seconds> <description> <command...>
  seconds="$1"; what="$2"; shift 2
  waited=0
  until "$@" >/dev/null 2>&1; do
    waited=$((waited + 2))
    if [ "$waited" -ge "$seconds" ]; then
      echo "timeout: $what" >&2
      docker logs "$APP_CONTAINER" 2>&1 | tail -30 >&2 || true
      exit 1
    fi
    sleep 2
  done
}

case "$command" in
  up)
    # (`sh`, not the file itself: it is not executable in git, and "Permission denied" hidden here left the first platform in place)
    sh "$0" down >/dev/null 2>&1 || true
    docker network create "$NETWORK" >/dev/null
    # The options of PostgreSQL go after the image name; none unless a suite asks for them.
    set --
    [ -n "$STATS" ] && set -- -c shared_preload_libraries=pg_stat_statements -c pg_stat_statements.track=all
    docker run -d --name "$DATABASE_CONTAINER" --network "$NETWORK" \
      -e POSTGRES_USER=bde -e POSTGRES_PASSWORD=qa-password -e POSTGRES_DB=bde_network \
      -p "127.0.0.1:$DATABASE_PORT:5432" ${QA_DATABASE_MEMORY:+--memory "$QA_DATABASE_MEMORY"} postgres:17-alpine "$@" >/dev/null
    wait_for 60 'PostgreSQL did not start' docker exec "$DATABASE_CONTAINER" pg_isready -U bde -d bde_network
    if [ -n "$STATS" ]; then
      wait_for 30 'pg_stat_statements did not load' docker exec "$DATABASE_CONTAINER" psql -U bde -d bde_network -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'
    fi

    # The options of the clock go in the argument list (not in a string: a path may hold a space).
    set --
    # What the image sets, kept: `-e NODE_OPTIONS=...` replaces it, and the platform would then run without the ceiling for its memory
    # that the image gives it (the first measures of the CI did, and showed 1,169 MiB under load).
    image_options="$(docker image inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$IMAGE" | sed -n 's/^NODE_OPTIONS=//p')"
    node_options="$image_options ${QA_APP_NODE_OPTIONS:-}"
    if [ -n "$NOW" ]; then
      clock_file="$(cd "$(dirname "$0")" && pwd)/fake-clock.cjs"
      set -- -v "$(host_path "$clock_file"):/qa/fake-clock.cjs:ro" -e "BDE_QA_NOW=$NOW"
      node_options="--require=/qa/fake-clock.cjs $node_options"
    fi
    # QA_APP_NODE_OPTIONS=--max-old-space-size=256 tries the options of Node.js that the image could set.
    [ -n "$node_options" ] && set -- "$@" -e "NODE_OPTIONS=$node_options"

    if [ -n "$WEBHOOK" ]; then
      set -- "$@" -e "DISCORD_WEBHOOK_URL=$WEBHOOK" -e NODE_TLS_REJECT_UNAUTHORIZED=0
    fi

    config_dir="$(mktemp -d)"
    write_config "$config_dir/bde.config.yml"
    chmod 644 "$config_dir/bde.config.yml"
    # The limits of the application's container, when a suite asks for them (see the top of this file).
    limits=""
    [ -n "${QA_APP_CPUS:-}" ] && limits="$limits --cpus $QA_APP_CPUS"
    [ -n "${QA_APP_MEMORY:-}" ] && limits="$limits --memory $QA_APP_MEMORY --memory-swap $QA_APP_MEMORY"
    # shellcheck disable=SC2086
    docker run -d --name "$APP_CONTAINER" --network "$NETWORK" -p "127.0.0.1:$PORT:3000" $limits \
      -v "$(host_path "$config_dir/bde.config.yml"):/app/bde.config.yml:ro" \
      -v qa-auto-backups:/auto-backups \
      -e DATABASE_URL='postgresql://bde:qa-password@qa-postgres:5432/bde_network?schema=public' \
      -e AUTH_SECRET="$AUTH_SECRET_VALUE" \
      -e APP_URL="http://localhost:$PORT" \
      -e FORTYTWO_CLIENT_ID=qa-client -e FORTYTWO_CLIENT_SECRET=qa-client-secret \
      -e FORTYTWO_API_URL=http://127.0.0.1:9 -e RELEASES_API_URL=http://127.0.0.1:9 \
      "$@" \
      "$IMAGE" >/dev/null
    wait_for 180 'the platform did not answer /api/health' curl -sf "http://127.0.0.1:$PORT/api/health"

    case "$DATASET" in
      none) ;;
      full) npx tsx qa/cli.ts load --database "$(database_url)" ;;
      club) npx tsx qa/cli.ts load --database "$(database_url)" --members 139 --events-per-year 80 ;;
      large) npx tsx qa/cli.ts load --database "$(database_url)" --members 1500 --events-per-year 300 --school-years 5 ;;
      small) npx tsx qa/cli.ts load --database "$(database_url)" --members 40 --events-per-year 40 ;;
      *) echo "unknown dataset $DATASET" >&2; exit 2 ;;
    esac
    echo "platform up: http://127.0.0.1:$PORT ($VARIANT, dataset $DATASET)"
    ;;
  env)
    printf 'export QA_BASE_URL=http://127.0.0.1:%s\n' "$PORT"
    printf "export QA_AUTH_SECRET='%s'\n" "$AUTH_SECRET_VALUE"
    printf "export QA_DATABASE_URL='%s'\n" "$(database_url)"
    ;;
  logs)
    docker logs "$APP_CONTAINER" 2>&1
    ;;
  down)
    docker rm -f "$APP_CONTAINER" "$DATABASE_CONTAINER" qa-hang >/dev/null 2>&1 || true
    docker network rm "$NETWORK" >/dev/null 2>&1 || true
    docker volume rm -f qa-auto-backups >/dev/null 2>&1 || true
    ;;
  *)
    echo "usage: sh qa/platform.sh up|env|logs|down [options]" >&2
    exit 2
    ;;
esac
