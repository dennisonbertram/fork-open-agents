import "server-only";

import { createHash } from "node:crypto";
import type { Sandbox } from "@open-agents/sandbox";

const GIT_PROGRESS_PROBE_TIMEOUT_MS = 15_000;

/**
 * Cheap per-turn probe for a no-progress (git-delta) budget: combines HEAD
 * sha, porcelain status, and diff into one sandbox.exec call (deliberately
 * NOT routed through an observed-command helper, which would emit
 * started/completed events per sub-command) and hashes the raw stdout to
 * sha256 so no diff content is ever logged.
 *
 * Returns null on any probe failure (non-zero exit or thrown error) — the
 * progress budget (see `@/lib/progress-budget`) treats null as "unknown, not
 * stale" rather than failing the run over a sandbox/tooling hiccup.
 *
 * Originally written for background agents (#914) and shared with headless
 * MCP chat runs (#1231) — both callers need the identical fingerprint shape,
 * so this lives in a neutral `lib/sandbox` module rather than being owned by
 * (or duplicated for) either feature.
 */
export async function probeGitFingerprint(
  sandbox: Sandbox,
): Promise<string | null> {
  try {
    const result = await sandbox.exec(
      // A complete working-state fingerprint: committed HEAD + file states +
      // UNSTAGED tracked diffs + STAGED (index) tracked diffs + UNTRACKED file
      // contents. Each piece closes a false-stall gap: git status --porcelain
      // alone reports the same "M path"/"?? path" regardless of content, so
      // both `git diff` (unstaged) and `git diff --cached` (staged) are needed
      // for tracked edits, and ls-files|cat is needed for untracked contents
      // (git diff omits those).
      //
      // The whole thing is hashed INSIDE the sandbox (`| sha256sum`) so the
      // command returns a tiny fixed-size digest. sandbox.exec truncates stdout
      // to 50k chars; hashing app-side would let a large diff push later
      // sections (staged/untracked) past the cap, freezing the fingerprint
      // while the index changes. The OA_PROGRESS_PROBE markers keep the
      // sections unambiguous within the hashed stream.
      "{ git rev-parse HEAD; printf '\\n---OA_PROGRESS_PROBE---\\n'; " +
        "git status --porcelain; printf '\\n---OA_PROGRESS_PROBE---\\n'; " +
        "git diff; printf '\\n---OA_PROGRESS_PROBE---\\n'; " +
        "git diff --cached; printf '\\n---OA_PROGRESS_PROBE---\\n'; " +
        "git ls-files --others --exclude-standard -z | xargs -0 -r cat; } " +
        "2>/dev/null | sha256sum",
      sandbox.workingDirectory,
      GIT_PROGRESS_PROBE_TIMEOUT_MS,
    );
    if (!result.success) {
      return null;
    }
    // result.stdout is the in-sandbox digest (never truncated); re-hash for a
    // stable, fixed-length fingerprint regardless of the sha256sum output shape.
    return createHash("sha256").update(result.stdout).digest("hex");
  } catch {
    return null;
  }
}
