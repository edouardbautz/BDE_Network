#!/bin/sh
# OWASP ZAP against the QA platform (`sh qa/platform.sh up`), signed in as the owner by a cookie the harness forges.
#
#   sh qa/security/zap.sh baseline [outdir]   the spider and the passive rules: what every response says (minutes)
#   sh qa/security/zap.sh full [outdir]       the same, then the active rules: ZAP sends attacks (at most QA_ZAP_ACTIVE_MINUTES, 25 by default)
#
# The report (`zap.json`, `zap.html` for the baseline) goes to `outdir` (default `qa-zap`), and `zap-gate.mjs` decides: any alert of a
# level that is not accepted (qa/security/zap-accepted.json) fails. The platform's database is a throwaway one: the active scan
# is let loose on the owner's pages, which include the ones that change things.
set -eu

IMAGE="ghcr.io/zaproxy/zaproxy:2.16.1"
mode="${1:-baseline}"
out="${2:-qa-zap}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
network="${QA_NETWORK:-qa-net}"
target="${QA_ZAP_TARGET:-http://qa-app:3000}"
active_minutes="${QA_ZAP_ACTIVE_MINUTES:-25}"

case "$mode" in
  baseline | full) ;;
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
replacer() {
  printf '%s\n' \
    "-config" "replacer.full_list(0).description=session" \
    "-config" "replacer.full_list(0).enabled=true" \
    "-config" "replacer.full_list(0).matchtype=REQ_HEADER" \
    "-config" "replacer.full_list(0).matchstr=Cookie" \
    "-config" "replacer.full_list(0).regex=false" \
    "-config" "replacer.full_list(0).replacement=$cookie"
}

status=0
if [ "$mode" = baseline ]; then
  MSYS_NO_PATHCONV=1 docker run --rm --network "$network" -v "$(host_path "$out"):/zap/wrk:rw" -t "$IMAGE" \
    zap-baseline.py -t "$target" -J zap.json -r zap.html -I -j \
    -z "$(replacer | tr '\n' ' ')" || status=$?
else
  # The active scan of `zap-full-scan.py` has no end of its own (more than an hour on the 489 addresses of this platform, the job being cut at
  # 60 minutes, and a limit given to it as an option was not applied), so the plan of ZAP's automation framework is used: every step has its
  # duration, the scan has `QA_ZAP_ACTIVE_MINUTES` and each rule 2 minutes. What the scan has not reached in that time is not attacked; the baseline has
  # read every page the spider found.
  sed -e "s|__TARGET__|$target|g" -e "s|__MINUTES__|$active_minutes|g" "$root/qa/security/zap-active.yaml" >"$out/plan.yaml"
  # (an array of arguments through `set --`: the cookie is one word, but the habit of the other scripts is not to build a command in a string)
  set --
  while IFS= read -r line; do set -- "$@" "$line"; done <<EOF
$(replacer)
EOF
  MSYS_NO_PATHCONV=1 docker run --rm --network "$network" -v "$(host_path "$out"):/zap/wrk:rw" "$IMAGE" \
    zap.sh -cmd -autorun /zap/wrk/plan.yaml "$@" || status=$?
fi

# ZAP's own exit code says "there were warnings"; the gate below is what decides.
echo "zap exit code $status (not the verdict)"
# What the `sql` suite attacks, from the image and the cases of the access matrix: the SQL injection rule is accepted there and nowhere else.
(cd "$root" && npx tsx qa/security/sql-proven.ts "$out/sql-proven.json")
node "$root/qa/security/zap-gate.mjs" "$out/zap.json" --proven "$out/sql-proven.json"
