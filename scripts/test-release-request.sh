#!/usr/bin/env bash
set -euo pipefail

script=$(realpath scripts/check-release-request.sh)
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
git -C "$temporary" init --quiet --initial-branch=main
git -C "$temporary" config user.name Test
git -C "$temporary" config user.email test@example.com
git -C "$temporary" config commit.gpgsign false
git -C "$temporary" commit --quiet --allow-empty -m initial
git -C "$temporary" tag v1.2.3
git -C "$temporary" commit --quiet --allow-empty -m next
git -C "$temporary" tag v1.2.4
git -C "$temporary" update-ref refs/remotes/origin/main "$(git -C "$temporary" rev-parse HEAD)"
current_sha=$(git -C "$temporary" rev-parse HEAD)
output="$temporary/output"

cd "$temporary"
run_guard() {
  : > "$output"
  GITHUB_OUTPUT="$output" EVENT_NAME="$1" EXPECTED_SHA="$2" VERSION="$3" bash "$script"
}

run_guard workflow_run "$current_sha" ''
grep -Fqx 'run=true' "$output"
grep -Fqx "ref=$current_sha" "$output"

run_guard workflow_run 0000000000000000000000000000000000000000 ''
grep -Fqx 'run=false' "$output"

run_guard workflow_dispatch '' 1.2.4
grep -Fqx 'run=true' "$output"
grep -Fqx "ref=$current_sha" "$output"
grep -Fqx 'version=1.2.4' "$output"

if run_guard workflow_dispatch '' 1.2.3 >/dev/null 2>&1; then
  echo 'Expected an older release tag to be rejected.' >&2
  exit 1
fi
if run_guard workflow_dispatch '' 1.2.5 >/dev/null 2>&1; then
  echo 'Expected a missing release tag to be rejected.' >&2
  exit 1
fi
if run_guard workflow_dispatch '' 1.2.4-rc.1 >/dev/null 2>&1; then
  echo 'Expected a non-stable version to be rejected.' >&2
  exit 1
fi
git -C "$temporary" checkout --quiet --orphan unrelated
git -C "$temporary" rm --quiet --force --ignore-unmatch .
git -C "$temporary" commit --quiet --allow-empty -m unrelated
git -C "$temporary" tag v1.2.5
if run_guard workflow_dispatch '' 1.2.5 >/dev/null 2>&1; then
  echo 'Expected a tag outside main to be rejected.' >&2
  exit 1
fi
