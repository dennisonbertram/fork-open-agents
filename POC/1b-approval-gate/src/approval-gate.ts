/**
 * `withApproval(tool, policy)` — the reusable approval gate.
 *
 * When a tool call matches the policy, the gate:
 *   1. emits a `tool-approval-request` UI chunk carrying a stable `approvalId`
 *      (mirrors AI SDK v6 needsApproval parking + tool-state.ts
 *      `approval-requested` / `activeApprovalId`),
 *   2. PARKS — it does NOT call the wrapped tool's `execute`,
 *   3. returns a `parked` outcome so the agent loop suspends (this mirrors
 *      `shouldPauseForToolInteraction()` in apps/web/app/workflows/chat.ts,
 *      which halts the step loop while a part is `approval-requested`).
 *
 * Later, a client decision is injected (mirroring AI SDK v6
 * `addToolApprovalResponse({ id, approved, reason })` -> persisted
 * `tool-approval-response`). On approve the wrapped `execute` runs and an
 * `output-available` chunk streams; on deny the side effect NEVER runs and an
 * `output-denied` chunk streams.
 */
import type { ApprovalPolicy } from "./classifier";
import { classifyAction } from "./classifier";
import type { Tool } from "./tool";
import type {
  ApprovalDecision,
  ToolUIPart,
  UIChunk,
} from "./types";

let approvalCounter = 0;
/** Deterministic, stable approval ids so park/resume can correlate. */
function generateApprovalId(toolCallId: string): string {
  approvalCounter += 1;
  return `appr_${toolCallId}_${approvalCounter}`;
}

export type GateContext = {
  toolCallId: string;
  /** Sink for streamed UI chunks (the workflow `Writable` in production). */
  emit: (chunk: UIChunk) => void;
};

/** A call that parked, awaiting a client decision. */
export type ParkedCall = {
  status: "parked";
  approvalId: string;
  toolName: string;
  toolCallId: string;
  input: unknown;
  category?: string;
  reason?: string;
  /** The persisted UI part at park time (state: "approval-requested"). */
  part: ToolUIPart;
};

/** A call that produced a terminal result without parking. */
export type CompletedCall =
  | { status: "output-available"; toolCallId: string; output: unknown; part: ToolUIPart }
  | { status: "output-denied"; toolCallId: string; approvalId: string; reason?: string; part: ToolUIPart }
  | { status: "output-error"; toolCallId: string; errorText: string; part: ToolUIPart };

export type GateOutcome = ParkedCall | CompletedCall;

export type ApprovedTool<TInput> = {
  name: string;
  /**
   * Run the tool. If the policy requires approval, returns a `parked` outcome
   * and emits a `tool-approval-request` chunk instead of executing.
   */
  run: (input: TInput, ctx: GateContext) => Promise<GateOutcome>;
  /**
   * Resume a parked call once a client decision arrives. Mirrors the resume
   * path: approve -> execute + output-available; deny -> output-denied.
   */
  resume: (
    parked: ParkedCall,
    decision: ApprovalDecision,
    ctx: GateContext,
  ) => Promise<CompletedCall>;
};

async function runExecute<TInput>(
  tool: Tool<TInput, unknown>,
  input: TInput,
  toolCallId: string,
  emit: (chunk: UIChunk) => void,
): Promise<CompletedCall> {
  try {
    const output = await tool.execute(input);
    emit({ type: "tool-output-available", toolCallId, output });
    return {
      status: "output-available",
      toolCallId,
      output,
      part: {
        type: `tool-${tool.name}`,
        toolCallId,
        state: "output-available",
        input,
        output,
      },
    };
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error);
    emit({ type: "tool-output-error", toolCallId, errorText });
    return {
      status: "output-error",
      toolCallId,
      errorText,
      part: {
        type: `tool-${tool.name}`,
        toolCallId,
        state: "output-error",
        input,
        errorText,
      },
    };
  }
}

export function withApproval<TInput>(
  tool: Tool<TInput, unknown>,
  policy: ApprovalPolicy = classifyAction,
): ApprovedTool<TInput> {
  return {
    name: tool.name,

    async run(input, ctx) {
      const verdict = await policy(tool.name, input);

      // Safe action: pass through, execute immediately.
      if (!verdict.requires) {
        return runExecute(tool, input, ctx.toolCallId, ctx.emit);
      }

      // Outward-facing / destructive: PARK. Do not execute.
      const approvalId = generateApprovalId(ctx.toolCallId);
      const part: ToolUIPart = {
        type: `tool-${tool.name}`,
        toolCallId: ctx.toolCallId,
        state: "approval-requested",
        input,
        approval: { id: approvalId, reason: verdict.reason },
      };
      ctx.emit({
        type: "tool-approval-request",
        toolCallId: ctx.toolCallId,
        toolName: tool.name,
        approvalId,
        input,
        isAutomatic: false,
      });
      return {
        status: "parked",
        approvalId,
        toolName: tool.name,
        toolCallId: ctx.toolCallId,
        input,
        category: verdict.category,
        reason: verdict.reason,
        part,
      };
    },

    async resume(parked, decision, ctx) {
      if (decision.approvalId !== parked.approvalId) {
        throw new Error(
          `Approval id mismatch: decision ${decision.approvalId} != parked ${parked.approvalId}`,
        );
      }

      if (decision.approved) {
        // Approve -> the wrapped tool finally executes.
        return runExecute(tool, parked.input as TInput, parked.toolCallId, ctx.emit);
      }

      // Deny -> side effect never happens; stream output-denied.
      ctx.emit({
        type: "tool-output-denied",
        toolCallId: parked.toolCallId,
        approvalId: parked.approvalId,
        reason: decision.reason,
      });
      return {
        status: "output-denied",
        toolCallId: parked.toolCallId,
        approvalId: parked.approvalId,
        reason: decision.reason,
        part: {
          type: `tool-${tool.name}`,
          toolCallId: parked.toolCallId,
          state: "output-denied",
          input: parked.input,
          approval: {
            id: parked.approvalId,
            approved: false,
            reason: decision.reason,
          },
        },
      };
    },
  };
}
