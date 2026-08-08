import type { SandboxState } from "@open-agents/sandbox";
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { AgentModelSelection } from "./models";
import type { AgentSandboxContext } from "./open-agent";
import type { SkillMetadata } from "./skills/types";
import type { SubagentRoster } from "./subagents/roster";

export const todoStatusSchema = z.enum(["pending", "in_progress", "completed"]);
export type TodoStatus = z.infer<typeof todoStatusSchema>;

export const todoItemSchema = z.object({
  id: z.string().describe("Unique identifier for the todo item"),
  content: z.string().describe("The task description"),
  status: todoStatusSchema.describe(
    "Current status. Only ONE task should be in_progress at a time.",
  ),
});
export type TodoItem = z.infer<typeof todoItemSchema>;

/**
 * Writer for streaming inline UI chunks (e.g. screenshot images) from tool executes.
 * The chunk shape matches the UIMessageChunk "file" variant used by the chat renderer
 * at shared-chat-content.tsx: p.type === "file" && p.mediaType?.startsWith("image/").
 *
 * write() may return Promise<void> — the screenshot tool always awaits it so
 * a rejection does not escape as an unhandled rejection.
 */
export type AgentContextWriter = {
  write: (chunk: {
    type: "file";
    url: string;
    mediaType: string;
  }) => Promise<void> | void;
};

export interface AgentContext {
  sandbox: AgentSandboxContext;
  skills?: SkillMetadata[];
  model: LanguageModel;
  subagentModel?: LanguageModel;
  /**
   * The resolved selection (id + directInference + providerOptionsOverrides)
   * that built `subagentModel` (or `model`, when there is no dedicated
   * subagent model) — the role's effective default routing before any roster
   * override. Threaded so a roster entry with a plain (non-profile) model id
   * override can still ride the same BYOK/direct-inference channel instead of
   * silently falling back to the Vercel gateway (#1157).
   */
  subagentModelSelection?: AgentModelSelection;
  runtimeMode?: "classic" | "managed_runtime";
  managedRuntime?: {
    profileId?: string;
    profileVersion?: string;
    profileDisplayName?: string;
    profileRunId?: string;
    sandboxName?: string;
  };
  /**
   * Per-role subagent configuration resolved from agents rows in the web app.
   * Absent or null = synthetic fallback (today's behavior unchanged).
   */
  subagentRoster?: SubagentRoster;
  /**
   * True when authenticated GitHub tools (native `github_*` or Composio
   * `GITHUB_*`) are in this step's toolset. The web_fetch tool uses it to block
   * unauthenticated calls to GitHub hosts and steer the model to those tools.
   */
  githubToolAvailable?: boolean;
  /**
   * Optional stream writer for inline image/file parts (e.g. browser screenshots).
   * When present, tools call writer.write({ type: "file", url, mediaType }) to
   * stream chunks that render inline in the chat UI.
   */
  writer?: AgentContextWriter;
  /**
   * Session-scoped id used by browser tools to isolate Playwright contexts.
   */
  sessionId?: string;
}

export interface SandboxExecutionContext {
  sandbox: AgentSandboxContext;
}

export function isSandboxState(value: unknown): value is SandboxState {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "vercel"
  );
}

export const EVICTION_THRESHOLD_BYTES = 80 * 1024;
