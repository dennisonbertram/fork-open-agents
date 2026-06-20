import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AccountDiagnosisResponse } from "@/lib/account-coordinator/types";

mock.module("server-only", () => ({}));

type AuthResult =
  | {
      ok: true;
      userId: string;
    }
  | {
      ok: false;
      response: Response;
    };

let authResult: AuthResult = { ok: true, userId: "user-1" };

const diagnosisFixture: AccountDiagnosisResponse = {
  generatedAt: "2026-06-20T12:00:00.000Z",
  source: "background_agent",
  id: "run-1",
  target: {
    id: "run-1",
    source: "background_agent",
    title: "Release watcher",
    status: "failed",
    needsAttention: true,
    attentionReasons: ["failed"],
    updatedAt: "2026-06-20T11:59:00.000Z",
  },
  sourceStatus: [{ source: "target", status: "ok", itemCount: 1 }],
  diagnosis: {
    status: "failed",
    needsAttention: true,
    attentionReasons: ["failed"],
    summary:
      "Failed background_agent; no failed/error evidence item was recorded.",
    evidenceCounts: {
      target: 1,
      timeline_event: 0,
      workflow_run: 0,
      workflow_input_snapshot: 0,
      workflow_step: 0,
      session_event: 0,
      background_agent_event: 0,
      background_agent_output: 0,
      background_agent_tool_session: 0,
      agent_loop_step: 0,
      agent_loop_event: 0,
      agent_loop_watchdog: 0,
      managed_runtime_profile_run: 0,
      sandbox_service: 0,
      browser_run: 0,
      workflow_goal: 0,
      workflow_goal_event: 0,
      verified_build_run: 0,
      verified_build_event: 0,
    },
    sourceGaps: [],
  },
  correlations: {
    sessionIds: [],
    chatIds: [],
    workflowRunIds: [],
    requestIds: [],
    harnessRunIds: [],
    sandboxNames: [],
    serviceIds: [],
    browserRunIds: [],
    prNumbers: [],
    issueNumbers: [],
  },
  timeline: [],
  evidence: [
    {
      id: "run-1",
      kind: "target",
      title: "Release watcher",
      status: "failed",
    },
  ],
};

const buildDbBackedAccountDiagnosis = mock(
  async (): Promise<AccountDiagnosisResponse | null> => diagnosisFixture,
);

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/account-coordinator/diagnosis-store", () => ({
  buildDbBackedAccountDiagnosis,
}));

const routeModulePromise = import("./route");

describe("GET /api/account/diagnosis", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    buildDbBackedAccountDiagnosis.mockClear();
    buildDbBackedAccountDiagnosis.mockResolvedValue(diagnosisFixture);
  });

  test("requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/account/diagnosis?source=session&id=session-1",
      ),
    );

    expect(response.status).toBe(401);
    expect(buildDbBackedAccountDiagnosis).not.toHaveBeenCalled();
  });

  test("rejects unsupported sources before loading data", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/account/diagnosis?source=scheduled_agents&id=agent-1",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.supportedSources).toContain("background_agent");
    expect(buildDbBackedAccountDiagnosis).not.toHaveBeenCalled();
  });

  test("requires an id", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/account/diagnosis?source=session"),
    );

    expect(response.status).toBe(400);
    expect(buildDbBackedAccountDiagnosis).not.toHaveBeenCalled();
  });

  test("returns 404 when the user-scoped diagnosis target is not found", async () => {
    buildDbBackedAccountDiagnosis.mockResolvedValue(null);
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/account/diagnosis?source=background_agent&id=foreign-run",
      ),
    );

    expect(response.status).toBe(404);
  });

  test("returns diagnosis for the authenticated user with bounded limit", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/account/diagnosis?source=background_agent&id=run-1&limit=25",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.source).toBe("background_agent");
    expect(buildDbBackedAccountDiagnosis).toHaveBeenCalledWith({
      userId: "user-1",
      source: "background_agent",
      id: "run-1",
      limit: 25,
    });
  });
});
