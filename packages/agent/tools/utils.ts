import { connectSandbox, type Sandbox } from "@open-agents/sandbox";
import type { LanguageModel, ModelMessage } from "ai";
import * as path from "path";
import type { AgentContext } from "../types";
import type { SubagentRoster } from "../subagents/roster";

function isAgentContext(value: unknown): value is AgentContext {
  return (
    typeof value === "object" &&
    value !== null &&
    "sandbox" in value &&
    "model" in value
  );
}

/**
 * Check if a file path is within a given directory.
 * Used as a security boundary to prevent path traversal attacks.
 *
 * @param filePath - The path to check
 * @param directory - The directory that should contain the path
 * @returns true if filePath is within or equal to directory
 */
export function isPathWithinDirectory(
  filePath: string,
  directory: string,
): boolean {
  const resolvedDir = path.resolve(directory);
  const resolvedPath = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(resolvedDir, filePath);
  return (
    resolvedPath.startsWith(resolvedDir + path.sep) ||
    resolvedPath === resolvedDir
  );
}

/**
 * Convert a path into a compact, model-friendly display path.
 *
 * Paths inside the sandbox working directory are returned relative to that
 * directory (e.g., "src/index.ts") to avoid repeating long absolute prefixes.
 * Paths outside the working directory remain absolute for clarity and safety.
 */
export function toDisplayPath(
  filePath: string,
  workingDirectory: string,
): string {
  const absolutePath = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(workingDirectory, filePath);

  if (!isPathWithinDirectory(absolutePath, workingDirectory)) {
    return absolutePath.replace(/\\/g, "/");
  }

  const relativePath = path.relative(workingDirectory, absolutePath);
  if (relativePath === "") {
    return ".";
  }

  return relativePath.replace(/\\/g, "/");
}

/**
 * Whether authenticated GitHub tools are available for this step.
 *
 * Read directly from the raw context (not via isAgentContext) so it works even
 * before the sandbox is attached. Defaults to false when absent.
 */
export function getGithubToolAvailable(experimental_context: unknown): boolean {
  if (
    typeof experimental_context !== "object" ||
    experimental_context === null
  ) {
    return false;
  }
  return (
    (experimental_context as Record<string, unknown>)["githubToolAvailable"] ===
    true
  );
}

/**
 * Whether this agent run is unattended (a background agent or agent-loop step)
 * with no human available to approve tool calls.
 *
 * Read directly from the raw context (not via isAgentContext) so it works in
 * approval checks before the sandbox is attached. Defaults to false when absent.
 */
export function getUnattended(experimental_context: unknown): boolean {
  if (
    typeof experimental_context !== "object" ||
    experimental_context === null
  ) {
    return false;
  }
  return (
    (experimental_context as Record<string, unknown>)["unattended"] === true
  );
}

/**
 * Get sandbox from experimental context with null safety.
 * Throws a descriptive error if sandbox is not initialized.
 *
 * @param experimental_context - The context passed to tool execute functions
 * @param toolName - Optional tool name for better error messages
 * @returns The sandbox instance
 * @throws Error if sandbox is not available in context
 */
export async function getSandbox(
  experimental_context: unknown,
  toolName?: string,
): Promise<Sandbox> {
  const context = isAgentContext(experimental_context)
    ? experimental_context
    : undefined;
  if (!context?.sandbox) {
    const toolInfo = toolName ? ` (tool: ${toolName})` : "";
    const contextInfo = context
      ? `Context exists but sandbox is missing. Context keys: ${Object.keys(context).join(", ")}`
      : "Context is undefined or null";
    throw new Error(
      `Sandbox not initialized in context${toolInfo}. ${contextInfo}. ` +
        "Ensure the agent's prepareCall sets experimental_context: { sandbox, ... }",
    );
  }

  return connectSandbox(context.sandbox.state);
}

/**
 * Get sandbox + working directory from experimental_context for approval checks.
 *
 * @param experimental_context - The context passed to needsApproval functions
 * @param toolName - Optional tool name for better error messages
 */
export function getSandboxContext(
  experimental_context: unknown,
  toolName?: string,
): {
  sandbox: AgentContext["sandbox"];
  workingDirectory: string;
} {
  const context = isAgentContext(experimental_context)
    ? experimental_context
    : undefined;
  if (!context?.sandbox) {
    const toolInfo = toolName ? ` (tool: ${toolName})` : "";
    const contextInfo = context
      ? `Context exists but sandbox is missing. Context keys: ${Object.keys(context).join(", ")}`
      : "Context is undefined or null";
    throw new Error(
      `Sandbox context not initialized${toolInfo}. ${contextInfo}. ` +
        "Ensure the agent's prepareCall sets experimental_context: { sandbox, ... }",
    );
  }

  return {
    sandbox: context.sandbox,
    workingDirectory: context.sandbox.workingDirectory,
  };
}

/**
 * Get model from experimental context with null safety.
 * Throws a descriptive error if model is not initialized.
 */
export function getModel(
  experimental_context: unknown,
  toolName?: string,
): LanguageModel {
  const context = isAgentContext(experimental_context)
    ? experimental_context
    : undefined;
  if (!context?.model) {
    const toolInfo = toolName ? ` (tool: ${toolName})` : "";
    const contextInfo = context
      ? `Context exists but model is missing. Context keys: ${Object.keys(context).join(", ")}`
      : "Context is undefined or null";
    throw new Error(
      `Model not initialized in context${toolInfo}. ${contextInfo}. ` +
        "Ensure the agent's prepareCall sets experimental_context: { model, ... }",
    );
  }
  return context.model;
}

/**
 * Get subagent model from experimental context, falling back to the main model.
 * Returns the dedicated subagent model if configured, otherwise the main agent model.
 */
export function getSubagentModel(
  experimental_context: unknown,
  toolName?: string,
): LanguageModel {
  const context = isAgentContext(experimental_context)
    ? experimental_context
    : undefined;
  if (!context?.model) {
    const toolInfo = toolName ? ` (tool: ${toolName})` : "";
    throw new Error(
      `Model not initialized in context${toolInfo}. ` +
        "Ensure the agent's prepareCall sets experimental_context: { model, ... }",
    );
  }
  return context.subagentModel ?? context.model;
}

/**
 * Escape a string for safe use in a single-quoted shell argument.
 * Wraps the string in single quotes and escapes any embedded single quotes.
 */
export function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Extract the subagent roster from experimental_context.
 * Returns null when the context is absent or has no roster (synthetic fallback:
 * subagent behavior is byte-identical to today).
 */
export function getSubagentRoster(
  experimental_context: unknown,
): SubagentRoster | null {
  if (
    typeof experimental_context !== "object" ||
    experimental_context === null
  ) {
    return null;
  }

  const ctx = experimental_context as Record<string, unknown>;
  const roster = ctx["subagentRoster"];

  if (typeof roster !== "object" || roster === null || Array.isArray(roster)) {
    return null;
  }

  return roster as SubagentRoster;
}

export type ToolNeedsApprovalFunction<INPUT> = (
  input: INPUT,
  options: {
    /**
     * The ID of the tool call. You can use it e.g. when sending tool-call related information with stream data.
     */
    toolCallId: string;

    /**
     * Messages that were sent to the language model to initiate the response that contained the tool call.
     * The messages **do not** include the system prompt nor the assistant response that contained the tool call.
     */
    messages: ModelMessage[];

    /**
     * Additional context.
     *
     * Experimental (can break in patch releases).
     */
    experimental_context?: unknown;
  },
) => boolean | PromiseLike<boolean>;
