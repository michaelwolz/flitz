#!/usr/bin/env bash
set -euo pipefail

if [[ "$EVENT_NAME" == workflow_run ]]; then
  actual_sha=$(git rev-parse HEAD)
  if [[ "$EXPECTED_SHA" != "$actual_sha" ]]; then
    echo "The successful CI run is stale; main is now at $actual_sha."
    echo "run=false" >> "$GITHUB_OUTPUT"
    exit 0
  fi
  echo "run=true" >> "$GITHUB_OUTPUT"
  echo "ref=$EXPECTED_SHA" >> "$GITHUB_OUTPUT"
  exit 0
fi

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Expected a semantic-release version like 1.2.3." >&2
  exit 1
fi
tag="v$VERSION"
if ! git show-ref --verify --quiet "refs/tags/$tag"; then
  echo "Tag $tag does not exist on main." >&2
  exit 1
fi
tag_commit=$(git rev-parse "refs/tags/$tag^{commit}")
if ! git merge-base --is-ancestor "$tag_commit" origin/main; then
  echo "Tag $tag is not reachable from main." >&2
  exit 1
fi
latest_tag=$(git tag --merged origin/main --sort=-version:refname | awk '/^v[0-9]+\.[0-9]+\.[0-9]+$/ && !found { print; found = 1 }')
if [[ "$tag" != "$latest_tag" ]]; then
  echo "Tag $tag is not the latest release tag on main ($latest_tag)." >&2
  exit 1
fi
echo "run=true" >> "$GITHUB_OUTPUT"
echo "ref=$tag_commit" >> "$GITHUB_OUTPUT"
echo "version=$VERSION" >> "$GITHUB_OUTPUT"
