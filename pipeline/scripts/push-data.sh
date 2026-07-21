#!/usr/bin/env bash
# Publishes the output tree as the single orphan commit on the data branch.
# The branch history is intentionally rewritten every run: the tip is the state.
set -euo pipefail

OUT_DIR="${1:?usage: push-data.sh <out-dir>}"
: "${GITHUB_TOKEN:?GITHUB_TOKEN required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY required}"

REMOTE="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"

cd "$OUT_DIR"
rm -rf .git
git init -q -b data
git config user.name "ais-pipeline[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add -A
git commit -q -m "data: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

for attempt in 1 2 3; do
  if git push -q --force "$REMOTE" data:data; then
    echo "pushed data branch (attempt $attempt)"
    exit 0
  fi
  echo "push failed (attempt $attempt); retrying"
  sleep $((attempt * 5))
done
echo "giving up; next run will resume from the previous tip" >&2
exit 1
