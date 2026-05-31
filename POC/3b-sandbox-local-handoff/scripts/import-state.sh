#!/usr/bin/env bash
#
# import-state.sh — re-hydrate a target git repo from a handoff bundle so that
# its branch, commit graph, AND uncommitted staged/unstaged/untracked state are
# BYTE-EXACT with the exporter's working tree.
#
# This is the symmetric "other side" of export-state.sh. It is direction-agnostic:
#   - sandbox -> local:  target is a fresh local clone
#   - local -> sandbox:  target is a fresh sandbox clone
# Either way every command is a plain git invocation runnable via the sandbox
# exec() seam.
#
# Usage: import-state.sh <target-repo-dir> <bundle-path>
#
# Restore algorithm (order matters):
#   1. fetch handoff refs from the bundle into the target object store
#   2. hard-reset the working branch to the captured HEAD (clean baseline)
#   3. materialize the FULL worktree tree to disk via a throwaway index
#      (this writes staged+unstaged+untracked files with correct modes/bytes)
#   4. delete files that existed at HEAD but are absent from the worktree tree
#      (these are the unstaged/working deletions)
#   5. point the real index at the captured INDEX tree
#      (so `git diff --cached` == staged, `git diff` == unstaged)
#
set -euo pipefail

TARGET_DIR="${1:?target repo dir required}"
BUNDLE="${2:?bundle path required}"
META="${BUNDLE}.meta"

cd "$TARGET_DIR"

# --- read metadata (branch / head / trees) ---
if [ ! -f "$META" ]; then
  echo "missing meta sidecar: $META" >&2
  exit 1
fi
# shellcheck disable=SC1090
BRANCH="$(grep '^branch=' "$META" | cut -d= -f2-)"
HEAD_SHA="$(grep '^head=' "$META" | cut -d= -f2-)"
INDEX_TREE="$(grep '^index_tree=' "$META" | cut -d= -f2-)"
WORKTREE_TREE="$(grep '^worktree_tree=' "$META" | cut -d= -f2-)"

# --- 1. pull handoff objects/refs out of the bundle ---
git fetch -q "$BUNDLE" 'refs/handoff/*:refs/handoff/*'

# Verify the trees actually arrived (objects are reachable from the fetched refs).
git rev-parse -q --verify "${INDEX_TREE}^{tree}" >/dev/null
git rev-parse -q --verify "${WORKTREE_TREE}^{tree}" >/dev/null
git rev-parse -q --verify "${HEAD_SHA}^{commit}" >/dev/null

# --- 2. put the branch on the captured HEAD with a clean tree ---
git checkout -q -B "$BRANCH" "$HEAD_SHA"
git reset -q --hard "$HEAD_SHA"
git clean -fdq

# --- 3. write the full worktree (staged+unstaged+untracked) to disk ---
# Use a throwaway index so the real index is untouched. checkout-index -a -f
# restores exact blob bytes AND file modes (exec bit) from the tree.
TMP_INDEX="$(mktemp "${TMPDIR:-/tmp}/handoff-restore.XXXXXX")"
trap 'rm -f "$TMP_INDEX"' EXIT
GIT_INDEX_FILE="$TMP_INDEX" git read-tree "$WORKTREE_TREE"
GIT_INDEX_FILE="$TMP_INDEX" git checkout-index -a -f
rm -f "$TMP_INDEX"
trap - EXIT

# --- 4. reproduce working-tree deletions ---
# Any path tracked at HEAD but missing from the worktree tree was deleted in the
# working tree. The reset in step 2 restored it; remove it now.
comm -23 \
  <(git ls-tree -r --name-only "$HEAD_SHA" | sort) \
  <(git ls-tree -r --name-only "$WORKTREE_TREE" | sort) \
| while IFS= read -r f; do
    [ -n "$f" ] && rm -f "$f"
  done

# --- 5. set the staging area to the captured index tree ---
# This makes the index == staged snapshot. The split is now exact:
#   HEAD  vs INDEX_TREE     == staged changes  (git diff --cached)
#   INDEX_TREE vs worktree  == unstaged changes (git diff)
git read-tree "$INDEX_TREE"

echo "imported:"
echo "  branch=$BRANCH head=$HEAD_SHA"
echo "  restored staged/unstaged/untracked working state"
