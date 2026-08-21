import { createHash } from "node:crypto";

export type ToolPolicyDeniedReason =
  | "explorer_readonly"
  | "mode_restricted"
  | "wrapper_dangerous";

export type ToolPolicyDeniedEvent = {
  service: "agent-tool-policy";
  event: "tool_policy_denied";
  level: "warn";
  tool: string;
  reason: ToolPolicyDeniedReason;
  commandHash: string;
  sessionId?: string;
  chatId?: string;
  runId?: string;
};

export type ToolPolicyEventRecorder = (event: ToolPolicyDeniedEvent) => void;

let recorder: ToolPolicyEventRecorder | null = null;

/**
 * Test/injection hook for structured tool-policy events. Production default
 * logs a redacted warn line via console.warn.
 */
export function setToolPolicyEventRecorder(
  next: ToolPolicyEventRecorder | null,
): void {
  recorder = next;
}

export function hashCommandForPolicy(command: string): string {
  return createHash("sha256").update(command).digest("hex").slice(0, 12);
}

export function emitToolPolicyDenied(params: {
  tool: string;
  reason: ToolPolicyDeniedReason;
  command: string;
  sessionId?: string;
  chatId?: string;
  runId?: string;
}): void {
  const event: ToolPolicyDeniedEvent = {
    service: "agent-tool-policy",
    event: "tool_policy_denied",
    level: "warn",
    tool: params.tool,
    reason: params.reason,
    commandHash: hashCommandForPolicy(params.command),
    ...(params.sessionId ? { sessionId: params.sessionId } : {}),
    ...(params.chatId ? { chatId: params.chatId } : {}),
    ...(params.runId ? { runId: params.runId } : {}),
  };

  if (recorder) {
    recorder(event);
    return;
  }

  console.warn(JSON.stringify(event));
}
