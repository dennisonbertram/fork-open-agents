import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const dispatchScheduledBackgroundAgents = mock(async () => ({
  enabled: true,
  matched: 1,
  created: 1,
  duplicates: 0,
  runIds: ["run-1"],
}));

const runEventRetention = mock(async () => ({
  tables: [],
  runId: "cron-retention",
}));

mock.module("@/lib/background-agents/dispatcher", () => ({
  dispatchBackgroundTriggerEvent: async () => ({
    enabled: true,
    matched: 0,
    created: 0,
    duplicates: 0,
    runIds: [],
  }),
  dispatchScheduledBackgroundAgents,
  dispatchWebhookErrorEvent: async () => ({
    enabled: true,
    matched: 0,
    created: 0,
    duplicates: 0,
    runIds: [],
  }),
}));

mock.module("@/lib/db/retention", () => ({
  runEventRetention,
  getRetentionConfig: () => ({
    windowDays: 30,
    keepPerRun: 200,
    batchSize: 500,
  }),
  planEventRetentionDeletes: () => [],
}));

const routeModulePromise = import("./route");

describe("POST /api/background-agents/cron", () => {
  beforeEach(() => {
    process.env.BACKGROUND_AGENTS_CRON_SECRET = "cron-secret";
    dispatchScheduledBackgroundAgents.mockClear();
    runEventRetention.mockClear();
  });

  test("requires cron secret configuration", async () => {
    delete process.env.BACKGROUND_AGENTS_CRON_SECRET;
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/background-agents/cron"),
    );

    expect(response.status).toBe(500);
    expect(dispatchScheduledBackgroundAgents).not.toHaveBeenCalled();
  });

  test("requires matching authorization", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/background-agents/cron"),
    );

    expect(response.status).toBe(401);
    expect(dispatchScheduledBackgroundAgents).not.toHaveBeenCalled();
  });

  test("dispatches scheduled agents when authorized", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/background-agents/cron", {
        method: "POST",
        headers: {
          Authorization: "Bearer cron-secret",
          "x-request-id": "req-1",
        },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      enabled: true,
      matched: 1,
      created: 1,
      duplicates: 0,
      runIds: ["run-1"],
    });
    expect(dispatchScheduledBackgroundAgents).toHaveBeenCalledWith({
      requestId: "req-1",
    });
    expect(runEventRetention).toHaveBeenCalled();
  });

  test("invokes event retention after authorized dispatch (#1400)", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/background-agents/cron", {
        method: "POST",
        headers: {
          Authorization: "Bearer cron-secret",
          "x-request-id": "req-retention",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(runEventRetention).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: expect.any(String),
      }),
    );
  });
});
