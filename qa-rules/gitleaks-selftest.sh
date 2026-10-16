#!/bin/sh
# Checks the configuration of gitleaks (.gitleaks.toml) does what it says: the generic "looks like a key" rule is relaxed
# in test files, and ONLY that rule: a token of a known service is still found in a test file, and the generic rule is
# still active elsewhere. Needs Docker.
#
#   sh qa-rules/gitleaks-selftest.sh
set -eu

IMAGE="zricethezav/gitleaks:v8.30.1"
export MSYS_NO_PATHCONV=1
root="$(cd "$(dirname "$0")/.." && pwd)"
host() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }
work="$(mktemp -d)"

# The fake secrets are written in halves: a scanner (this one, or Trivy's) must not take this very file for a leak.
fake_key_a='abcdEFGH1234ijkl'
fake_key_b='MNOP5678qrstUVWX'
fake_token_a='ghp'
fake_token_b='Zk3RwQ9vXb2LmN7pTc5HsY8dFg1JaE4uVo6W'

scan() {
  docker run --rm -v "$(host "$work"):/scan" -v "$(host "$root/.gitleaks.toml"):/config.toml:ro" "$IMAGE" \
    detect --no-git --source /scan --config /config.toml --no-banner >/dev/null 2>&1
}

fail() { echo "✗ $1" >&2; rm -rf "$work"; exit 1; }

# a fake client secret in a test file: relaxed
printf "const clientSecret = '%s%s';\n" "$fake_key_a" "$fake_key_b" >"$work/example.test.ts"
scan || fail "a fake secret in a test file must not be reported"

# a token of a known service in a test file: still found
rm "$work/example.test.ts"
printf "const token = '%s_%s';\n" "$fake_token_a" "$fake_token_b" >"$work/example.test.ts"
if scan; then fail "a GitHub token in a test file must be reported"; fi

# the same fake secret outside a test file: found
rm "$work/example.test.ts"
printf "const clientSecret = '%s%s';\n" "$fake_key_a" "$fake_key_b" >"$work/example.ts"
if scan; then fail "a secret outside a test file must be reported"; fi

rm -rf "$work"
echo "✓ gitleaks: the configuration relaxes the generic rule in tests, and nothing else"
