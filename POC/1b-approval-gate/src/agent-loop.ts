/**
 * Simulated agent tool loop with a park/resume boundary.
 *
 * This is a faithful, minimal stand-in for the production loop in
 * `apps/web/app/workflows/chat.ts`:
 *
 *   - The model "produces" a tool call (here scripted, not via a live LLM).
 *   - The gate may PARK the call. When any part is `approval-requested`, the
 *     loop suspends — exactly what `shouldPauseForToolInteraction()` does in
 *     chat.ts (it stops the step loop on `input-available` /
 *     `approval-requested`).
 *   - Parked state is PERSISTED to a store (mirroring chat.ts persisting the
 *     assistant message + tool parts before the park boundary).
 *   - A separate "request" later injects the client decision and RESUMES from
 *     the persisted state, mirroring the new HTTP POST that carries the
 *     `tool-approval-response` and re-enters the workflow.
 *
 * The persistence indirection is what lets us prove durability across a
 * stateless/serverless restart: resume reads ONLY from the store, never from
 * in-memory loop state.
 */
import type { ApprovedTool, GateContext, ParkedCall } from "./approval-gate";
import type { ApprovalDecision, ToolUIPart, UIChunk } from "./types";

/** A scripted tool call the "model" wants to make. */
export type ToolCall = {
  toolCallId: string;
  toolName: string;
  input: unknown;
};

/** Durable record of a parked call. JSON-serializable on purpose. */
export type ParkedRecord = {
  approvalId: string;
  toolName: string;
  toolCallId: string;
  input: unknown;
  category?: string;
  reason?: string;
  part: ToolUIPart;
};

/** Pluggable durable store. In production this is the DB (chats/messages). */
export interface ApprovalStore {
  save: (record: ParkedRecord) => Promise<void>;
  load: (approvalId: string) => Promise<ParkedRecord | null>;
  delete: (approvalId: string) => Promise<void>;
}

/** A trivial JSON-backed store to demonstrate cross-restart durability. */
export class JsonFileStore implements ApprovalStore {
  constructor(private path: string) {}

  private async readAll(): Promise<Record<string, ParkedRecord>> {
    const file = Bun.file(this.path);
    if (!(await file.exists())) return {};
    return (await file.json()) as Record<string, ParkedRecord>;
  }
  private async writeAll(data: Record<string, ParkedRecord>): Promise<void> {
    await Bun.write(this.path, JSON.stringify(data, null, 2));
  }
  async save(record: ParkedRecord): Promise<void> {
    const all = await this.readAll();
    all[record.approvalId] = record;
    await this.writeAll(all);
  }
  async load(approvalId: string): Promise<ParkedRecord | null> {
    const all = await this.readAll();
    return all[approvalId] ?? null;
  }
  async delete(approvalId: string): Promise<void> {
    const all = await this.readAll();
    delete all[approvalId];
    await this.writeAll(all);
  }
}

export type LoopResult =
  | { status: "parked"; approvalId: string; chunks: UIChunk[]; finalState: string }
  | { status: "completed"; chunks: UIChunk[]; finalState: string };

/**
 * First leg: run scripted tool calls until one parks or all complete.
 * Returns streamed chunks (what the client receives) and, if parked, persists
 * the parked record so a later, independent process can resume.
 */
export async function runUntilPark<TInput>(params: {
  toolCall: ToolCall;
  gate: ApprovedTool<TInput>;
  store: ApprovalStore;
}): Promise<LoopResult> {
  const { toolCall, gate, store } = params;
  const chunks: UIChunk[] = [];
  const ctx: GateContext = {
    toolCallId: toolCall.toolCallId,
    emit: (chunk) => chunks.push(chunk),
  };

  const outcome = await gate.run(toolCall.input as TInput, ctx);

  if (outcome.status === "parked") {
    const record: ParkedRecord = {
      approvalId: outcome.approvalId,
      toolName: outcome.toolName,
      toolCallId: outcome.toolCallId,
      input: outcome.input,
      category: outcome.category,
      reason: outcome.reason,
      part: outcome.part,
    };
    // Persist BEFORE suspending — mirrors chat.ts persisting tool parts at the
    // pause boundary so a serverless teardown does not lose the parked call.
    await store.save(record);
    return {
      status: "parked",
      approvalId: outcome.approvalId,
      chunks,
      finalState: outcome.part.state,
    };
  }

  return { status: "completed", chunks, finalState: outcome.part.state };
}

/**
 * Second leg: a FRESH entrypoint (new "serverless invocation"). It reconstructs
 * the parked call from the store ONLY, then injects the decision and resumes.
 * No in-memory state from the first leg is used.
 */
export async function resumeFromDecision<TInput>(params: {
  decision: ApprovalDecision;
  gate: ApprovedTool<TInput>;
  store: ApprovalStore;
}): Promise<{ chunks: UIChunk[]; finalState: string; part: ToolUIPart }> {
  const { decision, gate, store } = params;
  const record = await store.load(decision.approvalId);
  if (!record) {
    throw new Error(
      `No parked approval found for ${decision.approvalId} (durability failure)`,
    );
  }

  const parked: ParkedCall = {
    status: "parked",
    approvalId: record.approvalId,
    toolName: record.toolName,
    toolCallId: record.toolCallId,
    input: record.input,
    category: record.category,
    reason: record.reason,
    part: record.part,
  };

  const chunks: UIChunk[] = [];
  const ctx: GateContext = {
    toolCallId: record.toolCallId,
    emit: (chunk) => chunks.push(chunk),
  };

  const completed = await gate.resume(parked, decision, ctx);
  await store.delete(decision.approvalId); // approval consumed
  return { chunks, finalState: completed.part.state, part: completed.part };
}
