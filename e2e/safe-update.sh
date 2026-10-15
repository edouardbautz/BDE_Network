#!/bin/sh
# The safe update, against the real image and a real PostgreSQL: what the start-up command does when migrations are
# pending, when one fails, and when the stack does not fit (docker/start.mjs, docker/safe-update.mjs).
#
#   ./e2e/safe-update.sh <image>          (default: bde-network)
#
# Needs Docker, curl. Everything it creates is named `bdeupd-*` and removed at the end, whatever happens.
# The CI runs it after building the image; run it by hand after touching docker/ or prisma/migrations.
set -eu

export MSYS_NO_PATHCONV=1
IMAGE="${1:-bde-network}"
NET=bdeupd-net
DB=bdeupd-db
PASSWORD=bdeupd-password
PORT="${BDEUPD_PORT:-3107}"
URL="postgresql://bde:${PASSWORD}@${DB}:5432/bde?schema=public"

fail() {
  echo "✗ $*" >&2
  docker logs bdeupd-app 2>&1 | tail -40 >&2 || true
  exit 1
}
ok() { echo "✓ $*"; }

cleanup() {
  docker rm -f bdeupd-app "$DB" >/dev/null 2>&1 || true
  docker volume rm -f bdeupd-backups >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
cleanup

sql() { docker exec -i "$DB" psql -U bde -d bde -v ON_ERROR_STOP=1 -tA -q "$@"; }

wait_for() { # <seconds> <description> <command...>
  seconds="$1"
  description="$2"
  shift 2
  i=0
  while [ "$i" -lt "$seconds" ]; do
    if "$@" >/dev/null 2>&1; then return 0; fi
    i=$((i + 1))
    sleep 1
  done
  fail "timed out waiting for $description"
}

docker network create "$NET" >/dev/null
docker run -d --name "$DB" --network "$NET" -e POSTGRES_USER=bde -e POSTGRES_PASSWORD="$PASSWORD" -e POSTGRES_DB=bde \
  postgres:17-alpine >/dev/null
wait_for 60 "the database" sh -c "docker exec $DB pg_isready -U bde -d bde"

# One run of the image. Extra arguments go to `docker run` (before the image); what is in $SCRIPT runs first.
app() { # <script-before> [docker run options...]
  script="$1"
  shift
  docker rm -f bdeupd-app >/dev/null 2>&1 || true
  docker run -d --name bdeupd-app --network "$NET" -p "127.0.0.1:${PORT}:3000" \
    -v bdeupd-backups:/backups -e DATABASE_URL="$URL" -e BDE_STACK=2 "$@" \
    --entrypoint sh "$IMAGE" -c "$script exec node /opt/start/start.mjs" >/dev/null
}
page() { curl -s -H "Accept-Language: $1" "http://127.0.0.1:${PORT}/" | sed "s/&#39;/'/g"; }
health() { curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/api/health" 2>/dev/null || true; }
serving() { code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/" 2>/dev/null || true)"; [ "$code" != "000" ] && [ -n "$code" ]; }
backups() { docker run --rm -v bdeupd-backups:/backups --entrypoint ls "$IMAGE" -1 /backups 2>/dev/null | grep '^pre-update_' || true; }

# ---- 1. an installation one version behind: the migrations that are missing are applied after a copy ------------------------
# The database is brought to the state of the PREVIOUS version: every migration of the image but the newest.
docker run --rm --network "$NET" -e DATABASE_URL="$URL" --entrypoint sh "$IMAGE" -c '
  newest="$(ls -d /app/prisma/migrations/2* | sort | tail -n 1)"
  mkdir /tmp/m && cp -r /app/prisma/migrations/. /tmp/m/ && rm -rf "/tmp/m/$(basename "$newest")"
  printf "%s" "import { defineConfig } from \"prisma/config\"; export default defineConfig({ schema: \"/app/prisma/schema.prisma\", migrations: { path: \"/tmp/m\" }, datasource: { url: process.env.DATABASE_URL } });" > /opt/migrate/older.config.mjs
  node /opt/migrate/node_modules/prisma/build/index.js migrate deploy --config /opt/migrate/older.config.mjs
' >/dev/null 2>&1 || fail "could not bring the database to the previous version"
APPLIED_BEFORE="$(sql -c 'SELECT count(*) FROM _prisma_migrations')"
# The data to find again afterwards: roles (accounts would make the platform an existing one, which refuses the installer).
sql -c "INSERT INTO \"Role\" (id, name, permissions, \"allPermissions\", \"isDefault\", \"updatedAt\") VALUES ('r1', 'Roleone', ARRAY[]::text[], false, false, now())" >/dev/null
ok "a database one version behind, with data in it ($APPLIED_BEFORE migrations applied)"

app ''
wait_for 90 "the platform to answer" serving
wait_for 60 "a healthy platform" sh -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${PORT}/api/health)\" = 200 ]"
COPIES="$(backups)"
[ "$(printf '%s\n' "$COPIES" | grep -c .)" = 1 ] || fail "expected one copy before the update, found: $COPIES"
printf '%s\n' "$COPIES" | grep -Eq '^pre-update_[0-9]{8}T[0-9]{6}Z_v[0-9]' || fail "unexpected name for the copy: $COPIES"
APPLIED_AFTER="$(sql -c 'SELECT count(*) FROM _prisma_migrations')"
[ "$APPLIED_AFTER" -gt "$APPLIED_BEFORE" ] || fail "the pending migration was not applied"
[ "$(sql -c "SELECT count(*) FROM \"Role\" WHERE name = 'Roleone'")" = 1 ] || fail "the data did not survive the update"
docker logs bdeupd-app 2>&1 | grep -q "copie de sécurité" || fail "the log does not say a copy was made"
ok "migrations pending: a copy was made first ($COPIES), they were applied, the data is there"

# the copy really is a copy of the database as it was (loadable, with the old data and without the new tables)
docker run --rm -v bdeupd-backups:/backups --entrypoint sh "$IMAGE" -c "gzip -dc /backups/$COPIES" >/tmp/bdeupd-copy.sql
grep -q "PostgreSQL database dump complete" /tmp/bdeupd-copy.sql || fail "the copy is incomplete"
grep -q 'Roleone' /tmp/bdeupd-copy.sql || fail "the copy does not hold the data"
! grep -q 'EventOccurrence' /tmp/bdeupd-copy.sql || fail "the copy already holds what the update adds"
rm -f /tmp/bdeupd-copy.sql
ok "the copy is complete, holds the data, and none of what the update added"

# ---- 2. a restart with nothing to apply makes no new copy ------------------------------------------------------------
app ''
wait_for 90 "the platform to answer again" serving
wait_for 60 "a healthy platform" sh -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${PORT}/api/health)\" = 200 ]"
[ "$(backups | grep -c .)" = 1 ] || fail "a restart with nothing to apply made a copy"
ok "a restart with nothing to apply makes no copy"

# ---- 3. a migration that fails: the copy is put back, the platform stays stopped and says so ----------------------------
# Back to the previous version again (drop everything, apply all but the newest), then a migration that cannot work.
docker rm -f bdeupd-app >/dev/null 2>&1
sql -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' >/dev/null
docker run --rm --network "$NET" -e DATABASE_URL="$URL" --entrypoint sh "$IMAGE" -c '
  newest="$(ls -d /app/prisma/migrations/2* | sort | tail -n 1)"
  mkdir /tmp/m && cp -r /app/prisma/migrations/. /tmp/m/ && rm -rf "/tmp/m/$(basename "$newest")"
  printf "%s" "import { defineConfig } from \"prisma/config\"; export default defineConfig({ schema: \"/app/prisma/schema.prisma\", migrations: { path: \"/tmp/m\" }, datasource: { url: process.env.DATABASE_URL } });" > /opt/migrate/older.config.mjs
  node /opt/migrate/node_modules/prisma/build/index.js migrate deploy --config /opt/migrate/older.config.mjs
' >/dev/null 2>&1 || fail "could not bring the database back to the previous version"
sql -c "INSERT INTO \"Role\" (id, name, permissions, \"allPermissions\", \"isDefault\", \"updatedAt\") VALUES ('r2', 'Roletwo', ARRAY[]::text[], false, false, now())" >/dev/null
BEFORE_HASH="$(sql -c "SELECT md5(string_agg(migration_name, ',' ORDER BY migration_name)) FROM _prisma_migrations")"
BEFORE_TABLES="$(sql -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")"

app 'mkdir /app/prisma/migrations/29990101000000_boom && printf "%s" "CREATE TABLE boom_table (id int); SELECT 1/0;" > /app/prisma/migrations/29990101000000_boom/migration.sql;'
wait_for 90 "the explanation page" serving
sleep 3
[ "$(health)" = 503 ] || fail "the platform should be stopped (503), health says $(health)"
FR="$(page fr)"
EN="$(page en)"
printf '%s' "$FR" | grep -q 'votre base a été remise comme avant' || fail "the French page does not say the database was put back"
printf '%s' "$EN" | grep -q 'your database was put back as it was' || fail "the English page does not say the database was put back"
printf '%s' "$FR" | grep -Eq 'pre-update_[0-9]{8}T[0-9]{6}Z_v' || fail "the page does not name the copy"
ok "a failing migration: the platform stays stopped and the page explains it, in both languages"

[ "$(sql -c "SELECT md5(string_agg(migration_name, ',' ORDER BY migration_name)) FROM _prisma_migrations")" = "$BEFORE_HASH" ] \
  || fail "the list of applied migrations is not what it was"
[ "$(sql -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")" = "$BEFORE_TABLES" ] \
  || fail "the database does not have the tables it had"
[ "$(sql -c "SELECT to_regclass('public.boom_table') IS NULL")" = t ] || fail "what the failed migration created is still there"
[ "$(sql -c "SELECT count(*) FROM \"Role\" WHERE name IN ('Roleone', 'Roletwo')")" = 1 ] || fail "the data is not intact"
# (Roleone was in the first database, which step 3 replaced: only the second marker is expected)
ok "...and the database is exactly as it was before: same migrations, same tables, same data"

# ---- 4. a database newer than the image -------------------------------------------------------------------------------
docker rm -f bdeupd-app >/dev/null 2>&1
sql -c "INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count) VALUES ('future', 'x', '29990101000000_from_the_future', now(), now(), 1)" >/dev/null
app ''
wait_for 90 "the explanation page" serving
page fr | grep -q 'plus récente que cette version' || fail "no page for a database newer than the image"
page fr | grep -q '29990101000000_from_the_future' || fail "the page does not name the migration"
[ "$(health)" = 503 ] || fail "a database newer than the image must keep the platform stopped"
[ "$(sql -c "SELECT count(*) FROM \"Role\" WHERE name = 'Roletwo'")" = 1 ] || fail "the data was touched"
ok "a database newer than the image: stopped, explained, untouched"
sql -c "DELETE FROM _prisma_migrations WHERE id = 'future'" >/dev/null

# ---- 5. the compose file and the image do not belong together -----------------------------------------------------------
docker rm -f bdeupd-app >/dev/null 2>&1
app '' -e BDE_STACK=3
wait_for 90 "the explanation page" serving
page fr | grep -q "L'image est plus ancienne que docker-compose.yml" || fail "no page for an image older than the compose file"
ok "an image older than docker-compose.yml: explained instead of looping"

docker rm -f bdeupd-app >/dev/null 2>&1
app '' -e BDE_STACK=1
wait_for 90 "the explanation page" serving
page fr | grep -q "docker-compose.yml est plus ancien que l'image" || fail "no page for a compose file older than the image"
ok "a compose file older than the image: explained instead of looping"

# ---- 6. no database address at all (the incident: "Connection url is empty") --------------------------------------------
docker rm -f bdeupd-app >/dev/null 2>&1
docker run -d --name bdeupd-app --network "$NET" -p "127.0.0.1:${PORT}:3000" -e DATABASE_URL= -e BDE_STACK=2 "$IMAGE" >/dev/null
wait_for 90 "the explanation page" serving
page fr | grep -q "L'adresse de la base de données est invalide" || fail "no page for a missing database address"
ok "no database address: explained instead of 'Connection url is empty' in a loop"

echo ""
echo "The safe update works against the real image."
