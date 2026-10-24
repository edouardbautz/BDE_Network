#!/bin/sh
# A platform for the quality suites: the real production image, a real PostgreSQL, an installed BDE (its settings are
# imported from files, so no browser is needed), and the QA dataset. The same script runs in the workflows and on a
# developer's machine; only Docker, Node (for `npm ci` and `tsx`) and `curl` are needed.
#
#   sh qa/platform.sh up   [--image bde-network] [--port 3100] [--variant events-enabled|events-disabled|events-intra]
#                          [--dataset full|small|none] [--keep-config] [--now 2026-10-16T12:00:00Z]
#                          [--webhook https://qa-hang:8443/hook]
#   sh qa/platform.sh env  [--port 3100]     the variables the suites read (QA_BASE_URL, QA_AUTH_SECRET, QA_DATABASE_URL)
#   sh qa/platform.sh logs
#   sh qa/platform.sh down
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
    "$0" down >/dev/null 2>&1 || true
    docker network create "$NETWORK" >/dev/null
    docker run -d --name "$DATABASE_CONTAINER" --network "$NETWORK" \
      -e POSTGRES_USER=bde -e POSTGRES_PASSWORD=qa-password -e POSTGRES_DB=bde_network \
      -p "127.0.0.1:$DATABASE_PORT:5432" postgres:17-alpine >/dev/null
    wait_for 60 'PostgreSQL did not start' docker exec "$DATABASE_CONTAINER" pg_isready -U bde -d bde_network

    # The options of the clock go in the argument list (not in a string: a path may hold a space).
    set --
    if [ -n "$NOW" ]; then
      clock_file="$(cd "$(dirname "$0")" && pwd)/fake-clock.cjs"
      set -- -v "$(host_path "$clock_file"):/qa/fake-clock.cjs:ro" -e "BDE_QA_NOW=$NOW" -e NODE_OPTIONS=--require=/qa/fake-clock.cjs
    fi

    if [ -n "$WEBHOOK" ]; then
      set -- "$@" -e "DISCORD_WEBHOOK_URL=$WEBHOOK" -e NODE_TLS_REJECT_UNAUTHORIZED=0
    fi

    config_dir="$(mktemp -d)"
    write_config "$config_dir/bde.config.yml"
    chmod 644 "$config_dir/bde.config.yml"
    docker run -d --name "$APP_CONTAINER" --network "$NETWORK" -p "127.0.0.1:$PORT:3000" \
      -v "$(host_path "$config_dir/bde.config.yml"):/app/bde.config.yml:ro" \
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
    ;;
  *)
    echo "usage: sh qa/platform.sh up|env|logs|down [options]" >&2
    exit 2
    ;;
esac
