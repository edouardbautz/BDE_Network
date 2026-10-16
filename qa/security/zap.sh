#!/bin/sh
# OWASP ZAP against the QA platform (`sh qa/platform.sh up`), signed in as the owner by a cookie the harness forges.
#
#   sh qa/security/zap.sh baseline [outdir]   the spider and the passive rules: what every response says (minutes)
#   sh qa/security/zap.sh full [outdir]       the same, then the active rules: ZAP sends attacks (a quarter of an hour)
#
# The report (`zap.json`, `zap.html`) goes to `outdir` (default `qa-zap`), and `zap-gate.mjs` decides: any alert of a level
# that is not accepted (qa/security/zap-accepted.json) fails. The platform's database is a throwaway one: the active scan
# is let loose on the owner's pages, which include the ones that change things.
set -eu

IMAGE="ghcr.io/zaproxy/zaproxy:2.16.1"
mode="${1:-baseline}"
out="${2:-qa-zap}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
network="${QA_NETWORK:-qa-net}"
target="${QA_ZAP_TARGET:-http://qa-app:3000}"

case "$mode" in
  baseline) script="zap-baseline.py" ;;
  full) script="zap-full-scan.py" ;;
  *) echo "usage: sh qa/security/zap.sh baseline|full [outdir]" >&2; exit 2 ;;
esac

mkdir -p "$out"
out="$(cd "$out" && pwd)"
chmod 777 "$out"

eval "$(sh "$root/qa/platform.sh" env)"
cookie="$(cd "$root" && npx tsx qa/cli.ts cookie --persona owner --secret "$QA_AUTH_SECRET")"
case "$cookie" in
  authjs.session-token=*) ;;
  *) echo "no session cookie for the owner: $cookie" >&2; exit 1 ;;
esac

host_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }

# The cookie is added to every request by a ZAP "replacer" rule; the spider then sees the application, not the login page.
status=0
MSYS_NO_PATHCONV=1 docker run --rm --network "$network" -v "$(host_path "$out"):/zap/wrk:rw" -t "$IMAGE" \
  "$script" -t "$target" -J zap.json -r zap.html -I -j \
  -z "-config replacer.full_list(0).description=session \
      -config replacer.full_list(0).enabled=true \
      -config replacer.full_list(0).matchtype=REQ_HEADER \
      -config replacer.full_list(0).matchstr=Cookie \
      -config replacer.full_list(0).regex=false \
      -config replacer.full_list(0).replacement=$cookie" || status=$?

# ZAP's own exit code says "there were warnings"; the gate below is what decides.
echo "zap exit code $status (not the verdict)"
node "$root/qa/security/zap-gate.mjs" "$out/zap.json"
