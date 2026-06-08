/**
 * Pure helper functions for Composio section UX logic.
 * Extracted so they can be unit-tested independently of React.
 */
import type { ComposioAgentKey } from "@/lib/composio/types";

/**
 * Determines whether the toolkit search results dropdown should be visible.
 *
 * Rules:
 * - Visible when the input is focused (user is actively interacting)
 * - Visible when the query has non-whitespace content (results are relevant)
 * - Hidden otherwise (collapsed by default — no always-open scroll box)
 */
export function shouldShowResults(isFocused: boolean, query: string): boolean {
  if (isFocused) return true;
  return query.trim().length > 0;
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
  return profiles.length > 0 && mainDefaultProfileId === null;
}

/**
 * One-line description for each agent role shown as tooltip/subtext in
 * the compact agent defaults row.
 */
export const AGENT_ROLE_DESCRIPTIONS: Record<ComposioAgentKey, string> = {
  main: "The main chat agent — handles top-level tasks and conversations.",
  explorer: "Subagent that researches and maps out solutions before acting.",
  executor:
    "Subagent that carries out concrete actions (file edits, API calls).",
  design: "Subagent focused on design-related tasks and visual output.",
};
