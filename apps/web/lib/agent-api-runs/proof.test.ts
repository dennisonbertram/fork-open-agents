import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AgentApiRun } from "@/lib/db/schema";

mock.module("server-only", () => ({}));

let evidence: {
  workflowRun: {
    id: string;
    status: string;
    sandboxName: string | null;
  } | null;
  profileRun: { id: string; status: string } | null;
};
let messages: Array<{
  id: string;
  role: "user" | "assistant";
  outputs: { runtimeProof?: unknown };
}>;

const getAgentRunEvidence = mock(async () => evidence);
const listAgentRunMessages = mock(async () => messages);

mock.module("./snapshots", () => ({
  getAgentRunEvidence,
  listAgentRunMessages,
}));

const proofModulePromise = import("./proof");

function run(overrides: Partial<AgentApiRun> = {}): AgentApiRun {
  return {
    id: "arun_1",
    userId: "user_1",
    tokenId: "atok_1",
    status: "completed",
    idempotencyKeyHash: null,
    requestId: "req_1",
    sessionId: "session_1",
    chatId: "chat_1",
    workflowRunId: "workflow_1",
    promptMessageId: "msg_user",
    resultMessageId: "msg_assistant",
    title: "Proof run",
    repository: null,
    runtimeMode: "managed_runtime",
    managedRuntimeProfileId: "web-bun-agent-browser",
    modelId: "anthropic/claude-haiku-4.5",
    inferenceRoute: "gateway",
    inferenceProfileId: null,
    sandboxName: "sandbox_1",
    failureKind: null,
    failureMessage: null,
    failureRetryable: null,
    metadata: {},
    startedAt: new Date("2026-05-30T12:00:00.000Z"),
    finishedAt: new Date("2026-05-30T12:01:00.000Z"),
    createdAt: new Date("2026-05-30T12:00:00.000Z"),
    updatedAt: new Date("2026-05-30T12:01:00.000Z"),
    ...overrides,
  } as AgentApiRun;
}

describe("agent API proof builder", () => {
  beforeEach(() => {
    evidence = {
      workflowRun: {
        id: "workflow_1",
        status: "completed",
        sandboxName: "sandbox_1",
      },
      profileRun: { id: "profile_run_1", status: "completed" },
    };
    messages = [
      {
        id: "msg_assistant",
        role: "assistant",
        outputs: { runtimeProof: { status: "completed" } },
      },
    ];
    getAgentRunEvidence.mockClear();
    listAgentRunMessages.mockClear();
  });

  test("passes when a managed-runtime run has required workflow evidence", async () => {
    const { buildAgentRunProof } = await proofModulePromise;

    const proof = await buildAgentRunProof(run());

    expect(proof.status).toBe("passed");
    expect(proof.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "workflow_started", status: "passed" }),
        expect.objectContaining({
          id: "managed_runtime_profile_ready",
          status: "passed",
          required: true,
        }),
        expect.objectContaining({
          id: "runtime_proof_persisted",
          status: "passed",
        }),
        expect.objectContaining({ id: "redaction_passed", status: "passed" }),
      ]),
    );
  });

  test("blocks while terminal workflow evidence is still missing", async () => {
    const { buildAgentRunProof } = await proofModulePromise;
    evidence = {
      workflowRun: null,
      profileRun: null,
    };
    messages = [];

    const proof = await buildAgentRunProof(
      run({
        status: "running",
        workflowRunId: null,
        sandboxName: null,
      }),
    );

    expect(proof.status).toBe("failed");
    expect(proof.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "workflow_started", status: "failed" }),
        expect.objectContaining({ id: "workflow_terminal", status: "blocked" }),
        expect.objectContaining({
          id: "managed_runtime_profile_ready",
          status: "blocked",
        }),
      ]),
    );
  });

  test("fails closed when managed runtime profile setup failed", async () => {
    const { buildAgentRunProof } = await proofModulePromise;
    evidence = {
      workflowRun: {
        id: "workflow_1",
        status: "failed",
        sandboxName: "sandbox_1",
      },
      profileRun: { id: "profile_run_1", status: "failed" },
    };

    const proof = await buildAgentRunProof(run({ status: "failed" }));

    expect(proof.status).toBe("failed");
    expect(proof.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "managed_runtime_profile_ready",
          status: "failed",
        }),
      ]),
    );
  });

  test("marks managed-runtime-only checks not applicable for classic runs", async () => {
    const { buildAgentRunProof } = await proofModulePromise;
    evidence = {
      workflowRun: {
        id: "workflow_1",
        status: "completed",
        sandboxName: "sandbox_1",
      },
      profileRun: null,
    };
    messages = [{ id: "msg_assistant", role: "assistant", outputs: {} }];

    const proof = await buildAgentRunProof(
      run({
        runtimeMode: "classic",
        managedRuntimeProfileId: null,
      }),
    );

    expect(proof.status).toBe("passed");
    expect(proof.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "managed_runtime_profile_ready",
          status: "not_applicable",
          required: false,
        }),
        expect.objectContaining({
          id: "runtime_proof_persisted",
          status: "not_applicable",
        }),
      ]),
    );
  });
});
