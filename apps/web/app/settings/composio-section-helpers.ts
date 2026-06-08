/**
 * Pure helper functions for Composio section UX logic.
 * Extracted so they can be unit-tested independently of React.
 *
 * STUB — will be replaced by real implementation after tests confirm red state.
 */
import type { ComposioAgentKey } from "@/lib/composio/types";

/**
 * Determines whether the toolkit search results dropdown should be visible.
 *
 * Rules:
 * - Visible when the input is focused (user is actively interacting)
 * - Visible when the query has non-whitespace content (results are relevant)
 * - Hidden otherwise (collapsed by default)
 */
export function shouldShowResults(_isFocused: boolean, _query: string): boolean {
  // STUB: always returns false so tests fail for the right behavioral reason
  return false;
}

/**
 * Whether to show the "Tip: set a default profile for Main" hint.
 *
 * Shows when:
 * - At least one profile exists (there's something to assign)
 * - Main agent has no default profile set (the tip is actionable)
 */
export function shouldShowMainDefaultTip(
  profiles: ReadonlyArray<{ id: string }>,
  mainDefaultProfileId: string | null,
): boolean {
  // STUB: always returns false so tests fail for the right behavioral reason
  return false;
}

/**
 * One-line description for each agent role shown as tooltip/subtext in
 * the compact agent defaults row.
 */
export const AGENT_ROLE_DESCRIPTIONS: Record<ComposioAgentKey, string> = {
  main: "",
  explorer: "",
  executor: "",
  design: "",
};
