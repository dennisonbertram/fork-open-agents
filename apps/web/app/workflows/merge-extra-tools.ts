import type { ToolSet } from "ai";

/**
 * Merge composioTools and githubTools into a single ToolSet (or undefined if
 * both are absent). Later entries win on key collision, so GitHub tools
 * override Composio tools with the same name — document as a known edge case.
 *
 * NOTE: managed_runtime mode drops injected tools at the agent-package layer
 * (see packages/agent/open-agent.ts allowlist). GitHub tools therefore only
 * function in classic mode today. Follow-up: thread githubToolsEnabled through
 * the managed_runtime tool policy in open-agent.ts.
 */
export function mergeExtraTools(
  composioTools: ToolSet | undefined,
  githubTools: ToolSet | undefined,
): ToolSet | undefined {
  if (!composioTools && !githubTools) {
    return undefined;
  }
  return { ...composioTools, ...githubTools };
}
