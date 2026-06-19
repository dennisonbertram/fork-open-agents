/**
 * Pure precedence helper for resolving Composio tools for the chat MAIN agent.
 *
 * Implements the precedence rules for Part C (Phase 3):
 *   1. Explicit per-chat directToolkitSlugs → wins over agent row
 *   2. Explicit per-chat mainProfileId      → wins over agent row
 *   3. Agent row composioToolkitSlugs (non-empty) → used as default
 *   4. Agent row composioProfileId          → used as default when no slugs
 *   5. No agent row / empty → null (today's behavior, no change)
 *
 * CRITICAL: With no agent row and no explicit selection this function returns
 * exactly {directSlugs: null, profileId: null}, which is byte-for-byte
 * identical to the existing behavior before Phase 3.
 *
 * No I/O — pure function, fully unit-testable.
 */

export type ChatMainComposioInput = {
  /** Explicit per-chat direct toolkit slugs (null = not set). */
  chatDirectSlugs: string[] | null;
  /** Explicit per-chat main profile id (null = not set). */
  chatMainProfileId: string | null;
  /**
   * Composio toolkit slugs from the user_default agent row.
   * null means no agent row was found (synthetic fallback).
   * [] means row exists but no slugs set.
   */
  agentRowComposioSlugs: string[] | null;
  /**
   * Composio profile id from the user_default agent row.
   * null means no agent row or not set.
   */
  agentRowComposioProfileId: string | null;
  /**
   * Repo/workspace-level toolkit slugs (already resolved, incl. GitHub
   * default-on). Lowest precedence: applied only when nothing else is selected
   * — the case where a chat would otherwise get no Composio tools. Optional so
   * existing callers/behavior are unchanged when omitted.
   */
  repoSelectedSlugs?: string[] | null;
};

export type ChatMainComposioResult = {
  /** Final direct toolkit slugs to use (null = off). */
  directSlugs: string[] | null;
  /** Final profile id to use (null = off). */
  profileId: string | null;
};

/**
 * Resolve which Composio tools the chat MAIN agent should use, applying the
 * precedence rules described above.
 *
 * The result feeds into the existing resolveComposioToolsForChat logic:
 * - when directSlugs is non-null and non-empty → use the direct-list path
 * - when profileId is non-null → use the profile path
 * - otherwise → {status: "off"} (no tools)
 */
export function resolveComposioSlugsForChatMain(
  input: ChatMainComposioInput,
): ChatMainComposioResult {
  const {
    chatDirectSlugs,
    chatMainProfileId,
    agentRowComposioSlugs,
    agentRowComposioProfileId,
  } = input;

  // Explicit per-chat directSlugs wins (non-empty array only)
  const chatSlugsNonEmpty =
    chatDirectSlugs != null && chatDirectSlugs.length > 0;
  if (chatSlugsNonEmpty) {
    return { directSlugs: chatDirectSlugs, profileId: null };
  }

  // Explicit per-chat profile id wins
  if (chatMainProfileId != null) {
    return { directSlugs: null, profileId: chatMainProfileId };
  }

  // Agent row slugs used as default (non-empty array)
  const agentSlugsNonEmpty =
    agentRowComposioSlugs != null && agentRowComposioSlugs.length > 0;
  if (agentSlugsNonEmpty) {
    return { directSlugs: agentRowComposioSlugs, profileId: null };
  }

  // Agent row profile id used as default
  if (agentRowComposioProfileId != null) {
    return { directSlugs: null, profileId: agentRowComposioProfileId };
  }

  // Repo/workspace-level selection — lowest precedence, only when nothing else
  // is selected. This is the case that previously yielded no tools and forced
  // the model onto unauthenticated web_fetch for GitHub.
  const repoSlugsNonEmpty =
    input.repoSelectedSlugs != null && input.repoSelectedSlugs.length > 0;
  if (repoSlugsNonEmpty) {
    return { directSlugs: input.repoSelectedSlugs ?? null, profileId: null };
  }

  // No selection — today's behavior (null/null = off)
  return { directSlugs: null, profileId: null };
}
