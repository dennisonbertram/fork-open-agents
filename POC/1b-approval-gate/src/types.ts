/**
 * POC 1b — Tool approval gate types.
 *
 * These types are a faithful, self-contained copy of the shapes the real
 * open-agents codebase already uses, so that the gate built here maps 1:1 onto
 * production wiring:
 *
 * - Tool UI part `state` values mirror AI SDK v6 + `packages/shared/lib/tool-state.ts`:
 *     "input-streaming" | "input-available" | "approval-requested" |
 *     "approval-responded" | "output-available" | "output-error" | "output-denied"
 *   and the `approval: { id, approved, reason }` sub-object that
 *   `extractRenderState()` reads (see tool-state.ts GenericToolPart).
 *
 * - The streamed chunks mirror AI SDK v6 `UIMessageChunk` tool events that
 *   `apps/web/app/workflows/chat.ts` writes to the workflow `Writable`.
 *
 * We model the chunk/state surface locally (rather than importing `ai`) so the
 * POC is fully offline-runnable and deterministic, but every field name and
 * value here is copied from the real types it must integrate with.
 */

/** Mirrors AI SDK v6 tool-part lifecycle states (see tool-state.ts). */
export type ToolPartState =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-error"
  | "output-denied";

/** Mirrors `GenericToolPart.approval` in packages/shared/lib/tool-state.ts. */
export type ToolApproval = {
  id: string;
  approved?: boolean;
  reason?: string;
  /** AI SDK v6 marks auto-resolved approvals; kept for parity. */
  isAutomatic?: boolean;
};

/**
 * A persisted tool UI part. Mirrors the relevant subset of a `tool-<name>`
 * part inside `WebAgentUIMessage.parts` (apps/web/app/types.ts) that the
 * workflow persists across the park/resume boundary.
 */
export type ToolUIPart = {
  type: `tool-${string}`;
  toolCallId: string;
  state: ToolPartState;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  approval?: ToolApproval;
};

/**
 * Streamed UI chunks. These mirror the AI SDK v6 `UIMessageChunk` variants the
 * tool loop emits to the workflow `Writable` in chat.ts. Only the variants the
 * approval gate produces/consumes are modeled here.
 */
export type UIChunk =
  | { type: "tool-input-available"; toolCallId: string; toolName: string; input: unknown }
  | {
      // AI SDK v6 emits this when a tool with needsApproval parks. The web
      // client renders it via tool-state.ts -> approvalRequested = true.
      type: "tool-approval-request";
      toolCallId: string;
      toolName: string;
      approvalId: string;
      input: unknown;
      isAutomatic?: boolean;
    }
  | { type: "tool-output-available"; toolCallId: string; output: unknown }
  | {
      type: "tool-output-denied";
      toolCallId: string;
      approvalId: string;
      reason?: string;
    }
  | { type: "tool-output-error"; toolCallId: string; errorText: string };

/**
 * Client decision, mirroring AI SDK v6 `addToolApprovalResponse({ id, approved, reason })`
 * and the persisted `tool-approval-response` model message part.
 */
export type ApprovalDecision = {
  approvalId: string;
  approved: boolean;
  reason?: string;
};
