import {
  OPEN_AGENT_TOOL_NAMES,
  type OpenAgentCallOptions,
} from "@open-agents/agent";

/**
 * `ask_user_question` is a client-side tool with no `execute` — the browser
 * is the only caller that can answer it. An MCP-started run has no browser
 * attached, so leaving the tool in the set lets the agent stall a whole run
 * on a question nobody can ever answer. Excluding it from the allowlist
 * (rather than teaching MCP to answer it) is the deliberate design for #1230.
 */
const HEADLESS_DENIED_TOOL_NAMES: ReadonlySet<string> = new Set([
  "ask_user_question",
]);

/**
 * Built-in tool names an MCP-started (headless) run may use: every tool the
 * classic runtime normally offers, minus `ask_user_question`.
 */
export const HEADLESS_ALLOWED_BUILTIN_TOOL_NAMES: readonly string[] =
  OPEN_AGENT_TOOL_NAMES.filter((name) => !HEADLESS_DENIED_TOOL_NAMES.has(name));

/**
 * Tells the agent (a) no human will ever answer a question, (b) a blocked
 * goal should end the turn with a written blocker + decision needed, and (c)
 * otherwise to work to completion. Mirrors the working precedent in
 * `apps/web/lib/background-agents/executor.ts`'s unattended custom
 * instructions.
 */
export const HEADLESS_CUSTOM_INSTRUCTIONS =
  "You are running headless, started over MCP by a local agent that has " +
  "disconnected. No human is watching this session and no question you ask " +
  "can be answered — the ask_user_question tool is unavailable. If the goal " +
  "itself is blocked, stop and write exactly what is blocked and what " +
  "decision is needed. Otherwise work autonomously to completion.";

export type HeadlessAgentOptions = Omit<
  OpenAgentCallOptions,
  "sandbox" | "skills"
>;

/**
 * The agent-call options every MCP write tool (`open_agents_start_session`,
 * `open_agents_send_message`) must pass through `startChatRun` so the run
 * they launch is headless: `unattended: true` so approval gates resolve
 * deterministically instead of stalling, the allowlist above so
 * `ask_user_question` is never offered, and the headless custom
 * instructions.
 */
export function buildHeadlessAgentOptions(): HeadlessAgentOptions {
  return {
    unattended: true,
    allowedBuiltinToolNames: [...HEADLESS_ALLOWED_BUILTIN_TOOL_NAMES],
    customInstructions: HEADLESS_CUSTOM_INSTRUCTIONS,
  };
}
