/**
 * POC 3a — Bridge wire protocol (cloud session stream <-> local bridge CLI).
 *
 * The bridge connects to a cloud *session stream* over a websocket. The cloud
 * side is the same conceptual surface as `apps/web/app/workflows/chat.ts`,
 * which writes `UIMessageChunk`s to a workflow `Writable`. Here we model the
 * subset of that surface relevant to the two bridge capabilities, plus the
 * upstream messages the bridge sends back:
 *
 *   cloud -> bridge:
 *     - diff-proposed       (a unified diff / git patch to apply locally)
 *     - tool-call (local_exec)  (the agent invoking the local-exec tool)
 *
 *   bridge -> cloud:
 *     - diff-result         (applied / rejected+rolled-back)
 *     - tool-approval-request   (PARK; mirrors AI SDK v6 needsApproval parking;
 *                                renders via packages/shared/lib/tool-state.ts)
 *     - tool-output-available    (exec ran; stdout/stderr/exit streamed back)
 *     - tool-output-denied       (operator denied; never ran)
 *     - tool-output-error        (policy block / failure; never ran)
 *
 * Field names for the tool lifecycle (`approval-requested`, `output-available`,
 * `output-denied`, `approval: { id, approved, reason }`) are copied verbatim
 * from `packages/shared/lib/tool-state.ts` and `POC/1b-approval-gate` so this
 * maps 1:1 onto production wiring with no changes to `tool-state.ts`.
 */
import { z } from "zod";

/** Mirrors AI SDK v6 tool-part lifecycle states (see tool-state.ts). */
export const toolPartStateSchema = z.enum([
  "input-streaming",
  "input-available",
  "approval-requested",
  "approval-responded",
  "output-available",
  "output-error",
  "output-denied",
]);
export type ToolPartState = z.infer<typeof toolPartStateSchema>;

/** The `local_exec` tool input the cloud agent emits. */
export const localExecInputSchema = z.object({
  /** Argv form ONLY — no shell string. The bridge never spawns a shell. */
  argv: z.array(z.string()).min(1),
  /** Working directory, MUST be relative to the jail root. */
  cwd: z.string().default("."),
  /** Optional human-readable reason the agent needs the local machine. */
  reason: z.string().optional(),
});
export type LocalExecInput = z.infer<typeof localExecInputSchema>;

/** A proposed patch from the cloud agent. */
export const diffProposedSchema = z.object({
  type: z.literal("diff-proposed"),
  diffId: z.string(),
  /** Unified diff / `git apply`-compatible patch text. */
  patch: z.string(),
  summary: z.string().optional(),
});

/** The cloud agent invoking local_exec. */
export const toolCallSchema = z.object({
  type: z.literal("tool-call"),
  toolCallId: z.string(),
  toolName: z.literal("local_exec"),
  input: localExecInputSchema,
});

/** Cloud -> bridge messages. */
export const serverToBridgeSchema = z.discriminatedUnion("type", [
  diffProposedSchema,
  toolCallSchema,
  z.object({ type: z.literal("ping") }),
]);
export type ServerToBridge = z.infer<typeof serverToBridgeSchema>;

/** Bridge -> cloud messages. */
export const bridgeToServerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("diff-result"),
    diffId: z.string(),
    status: z.enum(["applied", "rejected"]),
    /** Files touched on success; on reject, why + that the tree was rolled back. */
    detail: z.string(),
    filesChanged: z.array(z.string()).optional(),
    rolledBack: z.boolean().optional(),
  }),
  z.object({
    // Mirrors the chunk a parked tool emits; client renders approvalRequested.
    type: z.literal("tool-approval-request"),
    toolCallId: z.string(),
    toolName: z.literal("local_exec"),
    approvalId: z.string(),
    input: localExecInputSchema,
    /** Why approval is being requested (policy reason / preview). */
    reason: z.string(),
  }),
  z.object({
    type: z.literal("tool-output-available"),
    toolCallId: z.string(),
    output: z.object({
      stdout: z.string(),
      stderr: z.string(),
      exitCode: z.number(),
      durationMs: z.number(),
    }),
  }),
  z.object({
    type: z.literal("tool-output-denied"),
    toolCallId: z.string(),
    approvalId: z.string(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("tool-output-error"),
    toolCallId: z.string(),
    errorText: z.string(),
  }),
  z.object({ type: z.literal("pong") }),
]);
export type BridgeToServer = z.infer<typeof bridgeToServerSchema>;

/**
 * Operator decision injected locally (mirrors AI SDK v6
 * addToolApprovalResponse({ id, approved, reason })).
 */
export type OperatorDecision = {
  approvalId: string;
  approved: boolean;
  reason?: string;
};
