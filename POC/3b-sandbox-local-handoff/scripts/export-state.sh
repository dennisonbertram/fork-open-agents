#!/usr/bin/env bash
#
# export-state.sh — capture a git repo's FULL state (branch + commit graph +
# uncommitted staged/unstaged/untracked working state) as a single portable
# artifact: a git bundle.
#
# This is the "sandbox side" of POC 3b. Every command here is a plain git
# invocation, so it maps 1:1 onto the sandbox `exec(command, cwd, timeoutMs)`
# seam in packages/sandbox/interface.ts.
#
# Usage: export-state.sh <repo-dir> <output-bundle> [base-ref]
#
#   <repo-dir>      working git repo to export (the sandbox checkout)
#   <output-bundle> path to write the portable .bundle artifact
#   [base-ref]      optional: only bundle commits since this ref (delta export).
#                   Omit to bundle the full reachable history.
#
# The artifact captures three trees so the importer can reconstruct the EXACT
# staged/unstaged/untracked split:
#   refs/handoff/head      -> the branch tip commit (HEAD)
#   refs/handoff/index     -> a commit whose tree == the staging area (staged)
#   refs/handoff/worktree  -> a commit whose tree == the full working tree
#                             (staged + unstaged + untracked, gitignore-respecting)
# Plus metadata written to refs/handoff/meta as a blob.
#
set -euo pipefail

REPO_DIR="${1:?repo dir required}"
OUT_BUNDLE="${2:?output bundle path required}"
BASE_REF="${3:-}"

cd "$REPO_DIR"

# --- branch + head ---
BRANCH="$(git symbolic-ref --short HEAD 2>/dev/null || echo HEAD)"
HEAD_SHA="$(git rev-parse HEAD)"

# --- staged tree (index) ---
# `git write-tree` snapshots the current index exactly.
INDEX_TREE="$(git write-tree)"

# --- full working tree incl untracked, via an EXTERNAL throwaway index ---
# We start the temp index from HEAD, then `git add -A` it. This stages every
# tracked modification, every deletion, AND every untracked-but-not-ignored
# file into the temp index, then snapshots it as a tree. The temp index lives
# OUTSIDE the worktree so it never pollutes the captured state.
TMP_INDEX="$(mktemp "${TMPDIR:-/tmp}/handoff-idx.XXXXXX")"
trap 'rm -f "$TMP_INDEX"' EXIT
GIT_INDEX_FILE="$TMP_INDEX" git read-tree "$HEAD_SHA"
GIT_INDEX_FILE="$TMP_INDEX" git add -A
WORKTREE_TREE="$(GIT_INDEX_FILE="$TMP_INDEX" git write-tree)"

# --- wrap the two state trees in commits so the bundle carries their objects ---
# (bundles only transport objects reachable from refs; bare trees are not.)
INDEX_COMMIT="$(git commit-tree "$INDEX_TREE" -p "$HEAD_SHA" -m "handoff: index/staged state")"
WORKTREE_COMMIT="$(git commit-tree "$WORKTREE_TREE" -p "$HEAD_SHA" -m "handoff: full worktree state")"

# --- metadata blob (branch name, head sha, base) so import is self-describing ---
META="$(printf 'branch=%s\nhead=%s\nindex_tree=%s\nworktree_tree=%s\nbase=%s\n' \
  "$BRANCH" "$HEAD_SHA" "$INDEX_TREE" "$WORKTREE_TREE" "${BASE_REF:-}")"
META_BLOB="$(printf '%s' "$META" | git hash-object -w --stdin)"

# --- publish handoff refs ---
git update-ref "refs/handoff/head" "$HEAD_SHA"
git update-ref "refs/handoff/index" "$INDEX_COMMIT"
git update-ref "refs/handoff/worktree" "$WORKTREE_COMMIT"
# store the branch under its own real ref name too, so it transfers as a branch
git update-ref "refs/handoff/branch/$BRANCH" "$HEAD_SHA"

# --- build the bundle ---
# We bundle the handoff refs (which reach the head, index, and worktree trees)
# plus the branch itself. With a base-ref we produce a thin delta bundle; the
# importer must already have the base commit.
mkdir -p "$(dirname "$OUT_BUNDLE")"
if [ -n "$BASE_REF" ]; then
  BASE_SHA="$(git rev-parse "$BASE_REF")"
  git bundle create "$OUT_BUNDLE" \
    "$BASE_SHA"..refs/handoff/head \
    refs/handoff/index refs/handoff/worktree \
    "refs/handoff/branch/$BRANCH" >/dev/null
else
  git bundle create "$OUT_BUNDLE" \
    refs/handoff/head refs/handoff/index refs/handoff/worktree \
    "refs/handoff/branch/$BRANCH" >/dev/null
fi

# --- stash the metadata next to the bundle so import does not need to guess ---
printf '%s' "$META" > "${OUT_BUNDLE}.meta"

# clean up our scratch refs in the source repo (do not leave handoff/* dangling)
git update-ref -d "refs/handoff/index" || true
git update-ref -d "refs/handoff/worktree" || true
git update-ref -d "refs/handoff/head" || true
git update-ref -d "refs/handoff/branch/$BRANCH" || true

echo "exported:"
echo "  bundle=$OUT_BUNDLE"
echo "  meta=${OUT_BUNDLE}.meta"
echo "  branch=$BRANCH head=$HEAD_SHA"
echo "  index_tree=$INDEX_TREE worktree_tree=$WORKTREE_TREE"
echo "  index_commit=$INDEX_COMMIT worktree_commit=$WORKTREE_COMMIT"
