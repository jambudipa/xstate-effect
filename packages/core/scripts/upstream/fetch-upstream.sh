#!/bin/sh
# Clones upstream XState at the tag xstate@5.33.2 (commit fbee62e7c1586315ed478c2fedf530d7e0ff5a3e)
# into .upstream/xstate-5.33.2 (gitignored): the reference clone that
# scripts/upstream/freeze-upstream.ts reads to freeze test/upstream/upstream-manifest.json.
# No test reads the clone; the committed manifest is enough to run the suite.
#
# Usage, from packages/core: pnpm upstream:fetch
# The script does nothing when .upstream/xstate-5.33.2 exists, and it removes a fresh clone whose
# HEAD is not the expected commit.
set -eu

REPOSITORY="https://github.com/statelyai/xstate.git"
TAG="xstate@5.33.2"
COMMIT="fbee62e7c1586315ed478c2fedf530d7e0ff5a3e"
TARGET=".upstream/xstate-5.33.2"

cd "$(dirname "$0")/../.."

if [ -e "$TARGET" ]; then
  echo "$TARGET exists; nothing to fetch"
  exit 0
fi

mkdir -p .upstream
git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$TAG" "$REPOSITORY" "$TARGET"
HEAD_COMMIT="$(git -C "$TARGET" rev-parse HEAD)"
if [ "$HEAD_COMMIT" != "$COMMIT" ]; then
  echo "$TAG is commit $HEAD_COMMIT, not $COMMIT; removing $TARGET" >&2
  rm -rf "$TARGET"
  exit 1
fi
echo "$TARGET holds $TAG at $COMMIT"
