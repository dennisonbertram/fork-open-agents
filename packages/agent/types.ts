import type { SandboxState } from "@open-agents/sandbox";
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { AgentSandboxContext } from "./open-agent";
import type { SkillMetadata } from "./skills/types";

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
 */
export type AgentContextWriter = {
  write: (chunk: { type: "file"; url: string; mediaType: string }) => void;
};

export interface AgentContext {
  sandbox: AgentSandboxContext;
  skills?: SkillMetadata[];
  model: LanguageModel;
  subagentModel?: LanguageModel;
  runtimeMode?: "classic" | "managed_runtime";
  managedRuntime?: {
    profileId?: string;
    profileVersion?: string;
    profileDisplayName?: string;
    profileRunId?: string;
    sandboxName?: string;
  };
  /**
   * Optional stream writer for inline image/file parts (e.g. browser screenshots).
   * When present, tools call writer.write({ type: "file", url, mediaType }) to
   * stream chunks that render inline in the chat UI.
   */
  writer?: AgentContextWriter;
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
