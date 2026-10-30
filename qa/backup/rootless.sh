#!/bin/sh
# The nightly backups on a rootless Docker (qa/backup/run.ts, played twice): the Docker of the computers of the school, where the daemon belongs
# to the user and the application's user is a number of that user's range. The daemon is a `docker:dind-rootless` container; the suite runs INSIDE it,
# as its unprivileged user, so that the folders the suite makes are the daemon's own file system, as on a real machine (a bind mount is
# resolved by the daemon, on its side). Needs only Docker and the image built before (`docker build -t bde-network:local .`).
#
#   sh qa/backup/rootless.sh [image]
#
# 1. the folder is made by Docker and handed to the application (a local disk);
# 2. the file system refuses the change of owner (`--refuse-chown`): the folder is the host user's, private, and must be opened some other way.
set -eu

IMAGE="${1:-bde-network:local}"
NAME="bde-rootless-$$"
SOCKET="unix:///run/user/1000/docker.sock"
export MSYS_NO_PATHCONV=1

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

inside() { docker exec -e "DOCKER_HOST=$SOCKET" "$NAME" "$@"; }

docker run -d --privileged --name "$NAME" -e DOCKER_TLS_CERTDIR= docker:29-dind-rootless >/dev/null

echo "waiting for the rootless daemon"
tries=0
until inside docker info >/dev/null 2>&1; do
  tries=$((tries + 1))
  if [ "$tries" -gt 60 ]; then
    echo "the rootless daemon did not start" >&2
    docker logs "$NAME" 2>&1 | tail -20 >&2
    exit 1
  fi
  sleep 2
done
inside docker info --format 'daemon: {{.SecurityOptions}}'
case "$(inside docker info --format '{{.SecurityOptions}}')" in
  *rootless*) ;;
  *) echo "this daemon is not rootless" >&2; exit 1 ;;
esac

docker exec -u root "$NAME" apk add -q nodejs npm git >/dev/null
docker save "$IMAGE" postgres:17-alpine | docker exec -i -e "DOCKER_HOST=$SOCKET" "$NAME" docker load >/dev/null
# `docker-compose.build.yml` names the image bde-network:local
if [ "$IMAGE" != "bde-network:local" ]; then inside docker tag "$IMAGE" bde-network:local; fi

# the project, as tracked by git, in the home of the daemon's user
git ls-files -z | tar --null -T - -cf - | docker exec -i -u root "$NAME" sh -c \
  'mkdir -p /home/rootless/project && cd /home/rootless/project && tar xf - && chown -R rootless:rootless /home/rootless'
docker exec -u rootless -w /home/rootless/project "$NAME" sh -c \
  'git init -q . && git add -A >/dev/null && git -c user.email=qa@example.org -c user.name=qa commit -qm qa >/dev/null && npm ci --ignore-scripts --no-audit --no-fund >/dev/null'

status=0
for variant in "" "--refuse-chown"; do
  echo "=== qa/backup/run.ts ${variant:-(the folder is handed to the application)}"
  # shellcheck disable=SC2086
  docker exec -u rootless -w /home/rootless/project -e "DOCKER_HOST=$SOCKET" "$NAME" \
    npx tsx qa/backup/run.ts $variant || status=1
done
exit "$status"
