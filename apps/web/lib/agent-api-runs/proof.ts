import "server-only";

import type { AgentApiRun } from "@/lib/db/schema";
import { getAgentRunEvidence, listAgentRunMessages } from "./snapshots";

export type ProofCheckStatus =
  | "passed"
  | "failed"
  | "blocked"
  | "not_applicable";

export type ProofCheck = {
  id: string;
  status: ProofCheckStatus;
  summary: string;
  required: boolean;
};

export type AgentRunProof = {
  runId: string;
  status: "passed" | "failed" | "blocked";
  checks: ProofCheck[];
};

function check(params: ProofCheck): ProofCheck {
  return params;
}

function summarize(checks: ProofCheck[]): AgentRunProof["status"] {
  if (checks.some((item) => item.required && item.status === "failed")) {
    return "failed";
  }
  if (checks.some((item) => item.required && item.status === "blocked")) {
    return "blocked";
  }
  return "passed";
}

export async function buildAgentRunProof(
  run: AgentApiRun,
): Promise<AgentRunProof> {
  const evidence = await getAgentRunEvidence(run);
  const messages = run.chatId
    ? await listAgentRunMessages({ chatId: run.chatId })
    : [];
  const assistantMessage = messages.find(
    (message) => message.role === "assistant",
  );
  const runtimeProof = assistantMessage?.outputs.runtimeProof;

  const checks: ProofCheck[] = [
    check({
      id: "workflow_started",
      status: run.workflowRunId ? "passed" : "failed",
      summary: run.workflowRunId
        ? `Workflow ${run.workflowRunId} was recorded.`
        : "No workflow id was recorded for this API run.",
      required: true,
    }),
    check({
      id: "workflow_terminal",
      status:
        run.status === "completed" ||
        run.status === "failed" ||
        run.status === "cancelled"
          ? "passed"
          : "blocked",
      summary: `API run status is ${run.status}.`,
      required: true,
    }),
    check({
      id: "workflow_run_row",
      status: evidence.workflowRun ? "passed" : "blocked",
      summary: evidence.workflowRun
        ? `Workflow row status is ${evidence.workflowRun.status}.`
        : "Workflow row is not available yet.",
      required: true,
    }),
    check({
      id: "sandbox_attributed",
      status:
        run.sandboxName || evidence.workflowRun?.sandboxName
          ? "passed"
          : "blocked",
      summary:
        run.sandboxName || evidence.workflowRun?.sandboxName
          ? `Sandbox ${run.sandboxName ?? evidence.workflowRun?.sandboxName} was attributed.`
          : "No sandbox attribution is available yet.",
      required: true,
    }),
    check({
      id: "managed_runtime_profile_ready",
      status:
        run.runtimeMode === "managed_runtime"
          ? evidence.profileRun
            ? evidence.profileRun.status === "failed"
              ? "failed"
              : "passed"
            : "blocked"
          : "not_applicable",
      summary:
        run.runtimeMode === "managed_runtime"
          ? evidence.profileRun
            ? `Managed runtime profile run ${evidence.profileRun.id} is ${evidence.profileRun.status}.`
            : "No managed runtime profile run is available yet."
          : "Classic runtime does not require managed runtime profile evidence.",
      required: run.runtimeMode === "managed_runtime",
    }),
    check({
      id: "assistant_message_persisted",
      status: assistantMessage ? "passed" : "blocked",
      summary: assistantMessage
        ? `Assistant message ${assistantMessage.id} was persisted.`
        : "No assistant message is available yet.",
      required: true,
    }),
    check({
      id: "runtime_proof_persisted",
      status:
        run.runtimeMode === "managed_runtime"
          ? runtimeProof
            ? "passed"
            : "blocked"
          : "not_applicable",
      summary: runtimeProof
        ? "Runtime proof data part was persisted."
        : "Runtime proof data part is not available yet.",
      required: run.runtimeMode === "managed_runtime",
    }),
    check({
      id: "redaction_passed",
      status: "passed",
      summary:
        "API proof excludes bearer tokens, prompts, cookies, and raw logs.",
      required: true,
    }),
  ];

  return {
    runId: run.id,
    status: summarize(checks),
    checks,
  };
}
