/**
 * POC 3a — the local bridge daemon/CLI.
 *
 * Connects to a cloud *session stream* over a real websocket, authenticating
 * with a session token (mirrors Better Auth session token in
 * apps/web/lib/auth/config.ts — the cloud verifies the token and binds the
 * socket to a session before any message is processed). Then it:
 *
 *   - DIFF APPLY: on `diff-proposed`, previews (dry-run), asks the operator to
 *     confirm, applies, and reports `diff-result` (with rollback on failure).
 *   - LOCAL EXEC: on `tool-call` (local_exec), it PARKS for explicit operator
 *     approval, runs the full security policy, and only on approve+pass runs
 *     the command and streams stdout/stderr/exit back. A blocked command never
 *     runs; a denied command never runs.
 *
 * The operator gate is pluggable (`OperatorGate`) so the eval can drive
 * approve/deny/auto without a TTY. In a real CLI this is a terminal prompt.
 */
import WebSocket from "ws";
import {
  bridgeToServerSchema,
  serverToBridgeSchema,
  type BridgeToServer,
  type LocalExecInput,
  type ServerToBridge,
} from "./protocol";
import { evaluatePolicy, type ExecPolicyConfig } from "./policy";
import { runGuarded } from "./exec";
import { applyDiff, previewDiff } from "./diff-apply";

export type ApprovalContext = {
  kind: "exec";
  approvalId: string;
  toolCallId: string;
  input: LocalExecInput;
  /** Policy reason / preview shown to the operator. */
  reason: string;
};

export type DiffContext = {
  kind: "diff";
  diffId: string;
  summary: string;
  filesChanged: string[];
};

/**
 * The human-in-the-loop gate. Returns true to proceed (approve / confirm).
 * In production this is a terminal prompt; in the eval it is scripted.
 */
export type OperatorGate = {
  approveExec: (ctx: ApprovalContext) => Promise<boolean>;
  confirmDiff: (ctx: DiffContext) => Promise<boolean>;
};

export type PolicyDecisionLog = {
  ts: string;
  toolCallId?: string;
  diffId?: string;
  decision: string;
  layer?: string;
  reason?: string;
  argv?: string[];
}[];

export type BridgeOptions = {
  url: string;
  token: string;
  policy: ExecPolicyConfig;
  gate: OperatorGate;
  /** Append-only audit log of every policy + approval decision. */
  decisionLog: PolicyDecisionLog;
  /** Optional transcript sink (every wire message in/out). */
  onWire?: (dir: "recv" | "send", msg: unknown) => void;
};

export class Bridge {
  private ws: WebSocket | null = null;
  private readonly opts: BridgeOptions;

  constructor(opts: BridgeOptions) {
    this.opts = opts;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Auth: the session token is sent as a bearer header on the upgrade
      // request. The cloud rejects the upgrade if it cannot resolve a session.
      const ws = new WebSocket(this.opts.url, {
        headers: { authorization: `Bearer ${this.opts.token}` },
      });
      this.ws = ws;

      ws.on("open", () => resolve());
      ws.on("unexpected-response", (_req, res) => {
        reject(new Error(`auth rejected: HTTP ${res.statusCode}`));
      });
      ws.on("error", (err) => reject(err));
      ws.on("message", (data: WebSocket.RawData) => {
        void this.onMessage(data.toString());
      });
    });
  }

  close(): void {
    this.ws?.close();
  }

  private send(msg: BridgeToServer): void {
    const parsed = bridgeToServerSchema.parse(msg);
    this.opts.onWire?.("send", parsed);
    this.ws?.send(JSON.stringify(parsed));
  }

  private async onMessage(raw: string): Promise<void> {
    let parsed: ServerToBridge;
    try {
      parsed = serverToBridgeSchema.parse(JSON.parse(raw));
    } catch (err) {
      // Malformed/unknown messages are dropped, never acted on.
      return;
    }
    this.opts.onWire?.("recv", parsed);

    if (parsed.type === "ping") {
      this.send({ type: "pong" });
      return;
    }
    if (parsed.type === "diff-proposed") {
      await this.handleDiff(parsed.diffId, parsed.patch);
      return;
    }
    if (parsed.type === "tool-call") {
      await this.handleExec(parsed.toolCallId, parsed.input);
      return;
    }
  }

  private async handleDiff(diffId: string, patch: string): Promise<void> {
    const preview = await previewDiff(this.opts.policy.jailRoot, patch);
    if (!preview.ok) {
      this.opts.decisionLog.push({
        ts: new Date().toISOString(),
        diffId,
        decision: "diff-rejected-preview",
        reason: preview.reason,
      });
      const result = await applyDiff(this.opts.policy.jailRoot, patch, false);
      this.send({
        type: "diff-result",
        diffId,
        status: "rejected",
        detail: result.detail + (preview.reason ? ` (${preview.reason})` : ""),
        rolledBack: false,
      });
      return;
    }

    const confirmed = await this.opts.gate.confirmDiff({
      kind: "diff",
      diffId,
      summary: preview.summary,
      filesChanged: preview.filesChanged,
    });
    this.opts.decisionLog.push({
      ts: new Date().toISOString(),
      diffId,
      decision: confirmed ? "diff-confirmed" : "diff-declined",
    });

    const result = await applyDiff(this.opts.policy.jailRoot, patch, confirmed);
    if (result.status === "applied") {
      this.send({
        type: "diff-result",
        diffId,
        status: "applied",
        detail: result.detail,
        filesChanged: result.filesChanged,
      });
    } else {
      this.send({
        type: "diff-result",
        diffId,
        status: "rejected",
        detail: result.detail,
        rolledBack: result.rolledBack,
      });
    }
  }

  private async handleExec(
    toolCallId: string,
    input: LocalExecInput,
  ): Promise<void> {
    // PRE-APPROVAL policy check. If it fails, never ask the operator — block.
    const verdict = evaluatePolicy(this.opts.policy, input);
    if (!verdict.allowed) {
      this.opts.decisionLog.push({
        ts: new Date().toISOString(),
        toolCallId,
        decision: "blocked-by-policy",
        layer: verdict.layer,
        reason: verdict.reason,
        argv: input.argv,
      });
      this.send({
        type: "tool-output-error",
        toolCallId,
        errorText: `blocked by policy [${verdict.layer}]: ${verdict.reason}`,
      });
      return;
    }

    // PARK: emit approval-request, suspend until operator decides.
    const approvalId = `appr_${toolCallId}_${Date.now()}`;
    const reason =
      input.reason ?? `run ${input.argv.join(" ")} in ${input.cwd || "."}`;
    this.send({
      type: "tool-approval-request",
      toolCallId,
      toolName: "local_exec",
      approvalId,
      input,
      reason,
    });
    this.opts.decisionLog.push({
      ts: new Date().toISOString(),
      toolCallId,
      decision: "parked-for-approval",
      argv: input.argv,
    });

    const approved = await this.opts.gate.approveExec({
      kind: "exec",
      approvalId,
      toolCallId,
      input,
      reason,
    });

    if (!approved) {
      this.opts.decisionLog.push({
        ts: new Date().toISOString(),
        toolCallId,
        decision: "denied-by-operator",
        argv: input.argv,
      });
      this.send({
        type: "tool-output-denied",
        toolCallId,
        approvalId,
        reason: "operator denied",
      });
      return;
    }

    // APPROVED — but re-check policy at run time (TOCTOU defense).
    const outcome = await runGuarded(this.opts.policy, input);
    if (!outcome.ok) {
      this.opts.decisionLog.push({
        ts: new Date().toISOString(),
        toolCallId,
        decision: "blocked-at-runtime",
        layer: outcome.layer,
        reason: outcome.reason,
        argv: input.argv,
      });
      this.send({
        type: "tool-output-error",
        toolCallId,
        errorText: `blocked at runtime [${outcome.layer}]: ${outcome.reason}`,
      });
      return;
    }

    this.opts.decisionLog.push({
      ts: new Date().toISOString(),
      toolCallId,
      decision: "approved-and-ran",
      argv: input.argv,
    });
    this.send({
      type: "tool-output-available",
      toolCallId,
      output: outcome.result,
    });
  }
}
