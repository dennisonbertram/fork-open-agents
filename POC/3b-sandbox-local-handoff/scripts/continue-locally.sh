#!/usr/bin/env bash
#
# continue-locally.sh — the "Continue this in my editor" one-command checkout.
#
# Given a handoff bundle (produced by export-state.sh in the sandbox) and the
# repo's clone URL, this clones the repo fresh and re-hydrates the exact sandbox
# state — branch, commits, and uncommitted staged/unstaged/untracked changes.
#
# Usage: continue-locally.sh <bundle-path> <clone-url-or-local-path> <dest-dir>
#
# In production the clone URL comes from sessions.cloneUrl (apps/web schema) and
# the bundle is streamed out of the sandbox. Here it works against any git URL or
# local path so the POC is fully runnable offline.
#
set -euo pipefail

BUNDLE="${1:?bundle path required}"
CLONE_SRC="${2:?clone url or path required}"
DEST="${3:?destination dir required}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Fresh clone of the repository (the "local" checkout).
git clone -q "$CLONE_SRC" "$DEST"

# Re-hydrate the full handoff state into it.
"$SCRIPT_DIR/import-state.sh" "$DEST" "$BUNDLE"

echo "ready: cd $DEST  (open in your editor)"
