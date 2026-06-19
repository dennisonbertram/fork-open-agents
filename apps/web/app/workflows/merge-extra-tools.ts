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

/**
 * Match "github" as an underscore/dash-delimited token in a tool name so the
 * detection covers native `github_*`, Composio `GITHUB_*`, and any prefixed
 * variant (`COMPOSIO_GITHUB_*`) without matching unrelated names (`mygithub`).
 */
const GITHUB_TOOL_NAME = /(^|[_-])github([_-]|$)/i;

/**
 * Whether a toolset contains any authenticated GitHub tool. Used to enable the
 * prompt steer + web_fetch guardrail that keep the agent off unauthenticated
 * GitHub fetches when real GitHub tools are available.
 */
export function hasGithubTool(tools: ToolSet | undefined): boolean {
  if (!tools) return false;
  return Object.keys(tools).some((name) => GITHUB_TOOL_NAME.test(name));
}
