/**
 * HIGH-4: requireAgentApiRun must check AGENT_API_ENABLED before proceeding.
 *
 * The collection GET/POST routes check isApiEnabled(), but requireAgentApiRun
 * (used by ALL per-run sub-routes) does not. This means /events, /messages,
 * /proof, /cancel, and the [runId] GET are usable even when the flag is off.
 *
 * After fix: requireAgentApiRun checks the flag first and returns a 404
 * response when AGENT_API_ENABLED=false, without hitting auth or the DB.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthResult =
  | {
      ok: true;
      userId: string;
      token: {
        id: string;
        rateLimitMax: number;
        rateLimitWindowMs: number;
      };
      repositoryPolicy: { allowedRepositories: string[] | null };
    }
  | {
      ok: false;
      status: 401 | 403;
      code: string;
      message: string;
    };

const verifyBearerApiToken = mock(async (): Promise<AuthResult> => ({
  ok: true,
  userId: "user-1",
  token: { id: "token-1", rateLimitMax: 60, rateLimitWindowMs: 60_000 },
  repositoryPolicy: { allowedRepositories: null },
}));

const getAgentApiRunForToken = mock(async () => ({
  id: "arun_test",
  userId: "user-1",
  tokenId: "token-1",
  status: "running",
  sessionId: "session_test",
  chatId: "chat_test",
  workflowRunId: "workflow_test",
  requestId: "req-test",
  finishedAt: null,
  failureKind: null,
  failureMessage: null,
  failureRetryable: null,
  idempotencyKeyHash: null,
  promptMessageId: "msg_test",
  resultMessageId: null,
  title: "test",
  repository: null,
  runtimeMode: "managed_runtime" as const,
  managedRuntimeProfileId: null,
  modelId: null,
  inferenceRoute: null,
  inferenceProfileId: null,
  sandboxName: null,
  metadata: {},
  startedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}));

const selfHealAgentApiRunStatus = mock(async (run: unknown) => run);

mock.module("@/lib/api-auth/tokens", () => ({
  verifyBearerApiToken,
}));
mock.module("@/lib/agent-api-runs/runs", () => ({
  getAgentApiRunForToken,
  selfHealAgentApiRunStatus,
}));

const modulePromise = import("./route");

describe("HIGH-4: requireAgentApiRun feature-flag gate", () => {
  beforeEach(() => {
    verifyBearerApiToken.mockClear();
    getAgentApiRunForToken.mockClear();
    selfHealAgentApiRunStatus.mockClear();
  });

  test("BT-004-real: requireAgentApiRun returns 404 when AGENT_API_ENABLED=false", async () => {
    process.env.AGENT_API_ENABLED = "false";

    const { requireAgentApiRun } = await modulePromise;

    const result = await requireAgentApiRun(
      new Request("http://localhost/api/v1/agent-runs/arun_test", {
        headers: { authorization: "Bearer oa_test" },
      }),
      { params: Promise.resolve({ runId: "arun_test" }) },
      ["agent_runs:read"],
    );

    // Before fix: ok=true (goes through auth, hits DB, returns the run)
    // After fix: ok=false with 404 response
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(404);
    }

    // The flag check must happen BEFORE auth to avoid unnecessary DB reads
    expect(verifyBearerApiToken).not.toHaveBeenCalled();

    process.env.AGENT_API_ENABLED = "true";
  });

  test("BT-004-real-b: requireAgentApiRun proceeds normally when flag is on", async () => {
    process.env.AGENT_API_ENABLED = "true";

    const { requireAgentApiRun } = await modulePromise;

    const result = await requireAgentApiRun(
      new Request("http://localhost/api/v1/agent-runs/arun_test", {
        headers: { authorization: "Bearer oa_test" },
      }),
      { params: Promise.resolve({ runId: "arun_test" }) },
      ["agent_runs:read"],
    );

    // When flag is on, normal flow should occur
    expect(verifyBearerApiToken).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });
});
