import type { ToolSet } from "ai";
import { bashTool } from "./tools/bash";
import { explorerBashTool } from "./tools/explorer-bash";
import { globTool } from "./tools/glob";
import { grepTool } from "./tools/grep";
import { readFileTool } from "./tools/read";
import { editFileTool, writeFileTool } from "./tools/write";
import type { OpenAgentRuntimeMode } from "./open-agent-runtime-mode";

/**
 * Coding tools available to delegated explorer workers.
 * Explorer bash is the read-only policy wrapper.
 */
export const EXPLORER_WORKER_TOOL_NAMES = [
  "read",
  "grep",
  "glob",
  "bash",
] as const;

/**
 * Coding tools available to delegated executor workers.
 */
export const EXECUTOR_WORKER_TOOL_NAMES = [
  "read",
  "write",
  "edit",
  "grep",
  "glob",
  "bash",
] as const;

export type DelegatedWorkerRole = "explorer" | "executor";

const explorerWorkerTools = {
  read: readFileTool(),
  grep: grepTool(),
  glob: globTool(),
  bash: explorerBashTool(),
} satisfies ToolSet;

const executorWorkerTools = {
  read: readFileTool(),
  write: writeFileTool(),
  edit: editFileTool(),
  grep: grepTool(),
  glob: globTool(),
  bash: bashTool(),
} satisfies ToolSet;

function pickTools(
  sourceTools: ToolSet,
  allowedToolNames: ReadonlyArray<string>,
): ToolSet {
  const nextTools: ToolSet = {};
  for (const toolName of allowedToolNames) {
    const candidate = sourceTools[toolName];
    if (candidate) {
      nextTools[toolName] = candidate;
    }
  }
  return nextTools;
}

/**
 * Derive the toolset for a task-delegated worker from runtime mode policy
 * intersected with an optional parent/profile builtin allowlist.
 *
 * Workers keep coding tools that the managed_runtime *coordinator* strips —
 * that is intentional. Instructions-only toolchain guidance is not enough;
 * the toolset itself must be policy-derived here.
 *
 * Lives outside open-agent.ts so subagents can import it without a cycle
 * through taskTool.
 */
export function getDelegatedWorkerToolPolicy(
  role: DelegatedWorkerRole,
  runtimeMode: OpenAgentRuntimeMode = "classic",
  options?: {
    allowedBuiltinToolNames?: ReadonlyArray<string> | null;
    /**
     * Profile toolchain labels (bun, agent-browser, …). Reserved for
     * intersection with future shell/toolchain gates; agent tool names are
     * selected from the role allowlist + allowedBuiltinToolNames today.
     */
    expectedTools?: ReadonlyArray<string>;
    optionalTools?: ReadonlyArray<string>;
  },
): ToolSet {
  void runtimeMode;
  void options?.expectedTools;
  void options?.optionalTools;

  const source =
    role === "explorer" ? explorerWorkerTools : executorWorkerTools;
  const roleNames =
    role === "explorer"
      ? EXPLORER_WORKER_TOOL_NAMES
      : EXECUTOR_WORKER_TOOL_NAMES;

  let allowedNames: ReadonlyArray<string> = roleNames;
  if (options?.allowedBuiltinToolNames != null) {
    const allow = new Set(options.allowedBuiltinToolNames);
    allowedNames = roleNames.filter((name) => allow.has(name));
  }

  return pickTools(source, allowedNames);
}
