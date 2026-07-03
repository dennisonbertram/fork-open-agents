import type {
  RepoToolkitPolicyBlockReason,
  RepoToolkitPolicyResult,
} from "./repo-policy";
import type { ComposioToolkitConnectionState } from "@/app/settings/composio-connection-state";

/**
 * Shared repo-tools effective-status derivation (#805, epic #796 T9 —
 * discoverable per-repo Tools surface).
 *
 * This is the ONE place that composes applyRepoToolkitPolicy's allow/block
 * result with the honest connection-state helpers (#800) into a single
 * effective status per toolkit for rendering on the repo Tools tab and the
 * settings/repositories page. It never re-derives allow/block logic itself
 * — that stays the sole responsibility of applyRepoToolkitPolicy — and it
 * never re-derives connection state — that stays the sole responsibility of
 * getToolkitConnectionState/buildToolkitStatusMap.
 *
 * Five effective statuses (per the issue's behavior contract):
 * - "blocked": excluded by the repo policy result, either because it's on
 *   the denylist ("repo_policy_blocked") or missing from a non-null
 *   allowlist ("not_in_repo_allowlist"). Checked FIRST — a blocked toolkit
 *   reports "blocked" regardless of its connection state (statuses compose;
 *   a block is never hidden behind a connection problem).
 * - "not_connected": survives the policy check (allowed) but has no
 *   connected account at all. Rendered distinctly from "blocked" so a user
 *   never sees a bare allow/block toggle implying the tool would work if
 *   unblocked when it wouldn't work anyway.
 * - "default_on": selectedToolkitSlugs is null (repo never configured) and
 *   the toolkit is "github" — the resolver's default-on-if-connected rule.
 * - "selected": present in a non-null selectedToolkitSlugs allowlist (and
 *   not blocked).
 * - "allowed": survives the policy check and is connected, but is neither
 *   the null-allowlist github default nor part of an explicit allowlist
 *   (e.g. selectedToolkitSlugs is null and the toolkit isn't github, or
 *   selectedToolkitSlugs is non-null but the resolver still passed it
 *   through as unrestricted overflow — kept distinct from "selected" so a
 *   null-allowlist repo doesn't claim every connected toolkit was
 *   "selected" by the user).
 *
 * IMPORTANT — null vs [] semantics (finding B5): selectedToolkitSlugs ===
 * null means "never configured" (github default-on applies); an explicit
 * empty array ([]) is a deliberate "nothing selected" choice and must NOT
 * collapse into the null/default_on case — every requested slug for an
 * empty-array repo is excluded by applyRepoToolkitPolicy's allowlist check
 * and therefore reports "blocked" (not_in_repo_allowlist), never
 * "default_on".
 */

export type RepoToolkitEffectiveStatusKind =
  | "allowed"
  | "blocked"
  | "selected"
  | "default_on"
  | "not_connected";

export type RepoToolkitEffectiveStatus = {
  slug: string;
  name: string;
  status: RepoToolkitEffectiveStatusKind;
  blockReason?: RepoToolkitPolicyBlockReason;
};

export type RepoToolkitEffectiveStatusInput = {
  /** The toolkit slugs to compute status for (the "relevant toolkit set"). */
  toolkitSlugs: string[];
  /** Optional display names for slugs; falls back to the slug itself. */
  namesBySlug?: Record<string, string>;
  /** Raw selectedToolkitSlugs value — null/array distinction preserved. */
  selectedToolkitSlugs: string[] | null;
  /** Result of applyRepoToolkitPolicy over the same toolkitSlugs list. */
  policyResult: RepoToolkitPolicyResult;
  /** Per-slug connection state from getToolkitConnectionState/buildToolkitStatusMap. */
  connectionStateBySlug: Map<string, ComposioToolkitConnectionState>;
};

const CONNECTED_STATES: ReadonlySet<ComposioToolkitConnectionState> = new Set([
  "active",
  "expired",
  "other",
]);

function isConnected(
  state: ComposioToolkitConnectionState | undefined,
): boolean {
  return state !== undefined && CONNECTED_STATES.has(state);
}

export function deriveRepoToolkitEffectiveStatuses(
  input: RepoToolkitEffectiveStatusInput,
): RepoToolkitEffectiveStatus[] {
  const {
    toolkitSlugs,
    namesBySlug = {},
    selectedToolkitSlugs,
    policyResult,
    connectionStateBySlug,
  } = input;

  const blockedBySlug = new Map(
    policyResult.blocked.map((entry) => [entry.slug, entry.reason]),
  );
  const allowlistSet = selectedToolkitSlugs
    ? new Set(selectedToolkitSlugs.map((slug) => slug.toLowerCase()))
    : null;

  return toolkitSlugs.map((slug) => {
    const name = namesBySlug[slug] ?? slug;
    const blockReason = blockedBySlug.get(slug);

    if (blockReason) {
      return { slug, name, status: "blocked" as const, blockReason };
    }

    const connected = isConnected(connectionStateBySlug.get(slug));
    if (!connected) {
      return { slug, name, status: "not_connected" as const };
    }

    if (allowlistSet) {
      // Non-null allowlist: an allowed slug present in it was an explicit
      // choice ("selected"). applyRepoToolkitPolicy already guarantees any
      // slug not in the allowlist landed in `blocked`, so reaching here with
      // a non-null allowlist means the slug IS in it.
      return { slug, name, status: "selected" as const };
    }

    // selectedToolkitSlugs === null: never configured. GitHub gets the
    // resolver's default-on-if-connected treatment; every other connected,
    // unrestricted toolkit is generically "allowed".
    if (slug.toLowerCase() === "github") {
      return { slug, name, status: "default_on" as const };
    }

    return { slug, name, status: "allowed" as const };
  });
}
