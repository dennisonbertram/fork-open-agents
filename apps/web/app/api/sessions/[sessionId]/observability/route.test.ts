import { beforeEach, describe, expect, mock, test } from "bun:test";

// ---------------------------------------------------------------------------
// Shared mutable state for mock control
// ---------------------------------------------------------------------------

const SESSION_ID = "session-1";
const CHAT_ID = "chat-1";

let artifactsResult: Array<{
  id: string;
  kind: string;
  status: string;
  redactionStatus: string;
  sourceLocation: string | null;
  summary: string | null;
  createdByActor: string | null;
  workflowRunId: string | null;
  sessionId: string | null;
  chatId: string | null;
  goalId: string | null;
  gateId: string | null;
  createdAt: Date;
  updatedAt: Date;
}> = [];

let listArtifactsShouldThrow = false;

// ---------------------------------------------------------------------------
// Mock modules — must be declared before any import of the module under test
// ---------------------------------------------------------------------------

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => ({
    ok: true as const,
    userId: "user-1",
  }),
  requireOwnedSession: async () => ({
    ok: true as const,
    sessionRecord: {
      id: SESSION_ID,
      userId: "user-1",
      runtimeMode: "classic" as const,
    },
    response: undefined,
  }),
}));

mock.module("@/lib/db/client", () => ({
  db: {
    query: {
      workflowRuns: {
        findMany: async () => [],
      },
    },
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async () => [],
            }),
          }),
        }),
      }),
    }),
  },
}));

mock.module("@/lib/observability/managed-runtime-workers", () => ({
  extractManagedRuntimeWorkersFromMessages: () => [],
  summarizeManagedRuntimeDirectToolUseFromMessages: () => ({
    observed: false,
    count: 0,
    toolTypes: [],
    toolLabels: [],
    warning: null,
  }),
}));

mock.module("@/lib/observability/managed-runtime-profile-runs", () => ({
  listManagedRuntimeProfileRuns: async () => [],
  toManagedRuntimeProfileRunSnapshot: (r: unknown) => r,
}));

mock.module("@/lib/observability/events", () => ({
  listSessionEvents: async () => [],
  toSessionEventSnapshot: (e: unknown) => e,
}));

mock.module("@/lib/sandbox/runtime/browser-runs", () => ({
  listManagedBrowserRuns: async () => [],
}));

mock.module("@/lib/sandbox/runtime/service-launch", () => ({
  listManagedServices: async () => [],
}));

mock.module("@/lib/db/workflow-artifacts", () => ({
  listArtifacts: async (_filter: unknown) => {
    if (listArtifactsShouldThrow) {
      throw new Error("DB connection failed");
    }
    return artifactsResult;
  },
}));

// Import the route AFTER mocks are established
const routeModulePromise = import("./route");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeArtifact(
  id: string,
  redactionStatus: "pending" | "passed" | "failed" | "blocked",
  opts: { summary?: string; sourceLocation?: string } = {},
) {
  return {
    id,
    kind: "research_packet" as const,
    status: "available" as const,
    redactionStatus,
    sourceLocation: opts.sourceLocation ?? `s3://bucket/${id}.md`,
    summary: opts.summary ?? `Summary for ${id}`,
    createdByActor: "workflow-engine",
    workflowRunId: "wrun-1",
    sessionId: SESSION_ID,
    chatId: CHAT_ID,
    goalId: null,
    gateId: null,
    createdAt: new Date("2026-01-15T10:00:00.000Z"),
    updatedAt: new Date("2026-01-15T10:00:00.000Z"),
  };
}

function createRequest(chatId = CHAT_ID) {
  return new Request(
    `http://localhost/api/sessions/${SESSION_ID}/observability?chatId=${chatId}`,
  );
}

function createRouteContext() {
  return {
    params: Promise.resolve({ sessionId: SESSION_ID }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("/api/sessions/[sessionId]/observability — workflowArtifacts extension", () => {
  beforeEach(() => {
    artifactsResult = [];
    listArtifactsShouldThrow = false;
  });

  // BT-001: passed artifact carries summary + sourceLocation in the response
  test("BT-001: passed artifact includes summary and sourceLocation in response", async () => {
    const secret = "SECRET_CONTENTS_MUST_APPEAR_IN_PASSED";
    artifactsResult = [
      makeArtifact("art-1", "passed", {
        summary: secret,
        sourceLocation: "s3://bucket/art-1.md",
      }),
    ];

    const { GET } = await routeModulePromise;
    const response = await GET(createRequest(), createRouteContext());
    const body = (await response.json()) as {
      workflowArtifacts: Array<{
        id: string;
        summary: string | null;
        sourceLocation: string | null;
        redactionStatus: string;
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.workflowArtifacts).toHaveLength(1);
    const art = body.workflowArtifacts[0];
    expect(art?.id).toBe("art-1");
    expect(art?.redactionStatus).toBe("passed");
    expect(art?.summary).toBe(secret);
    expect(art?.sourceLocation).toBe("s3://bucket/art-1.md");
  });

  // BT-002: pending artifact — summary/sourceLocation MUST be null (server-side gate)
  test("BT-002: pending artifact has null summary and sourceLocation in response (server-side gate)", async () => {
    const rawSecret = "TOP_SECRET_PENDING_CONTENT_MUST_NOT_REACH_CLIENT";
    artifactsResult = [
      makeArtifact("art-2", "pending", {
        summary: rawSecret,
        sourceLocation: "s3://bucket/art-2.md",
      }),
    ];

    const { GET } = await routeModulePromise;
    const response = await GET(createRequest(), createRouteContext());
    const body = (await response.json()) as {
      workflowArtifacts: Array<{
        id: string;
        summary: string | null;
        sourceLocation: string | null;
        redactionStatus: string;
      }>;
    };
    const responseText = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.workflowArtifacts).toHaveLength(1);
    const art = body.workflowArtifacts[0];
    expect(art?.id).toBe("art-2");
    expect(art?.redactionStatus).toBe("pending");
    // The gate: raw content MUST NOT be in the client payload
    expect(art?.summary).toBeNull();
    expect(art?.sourceLocation).toBeNull();
    // Security assertion: the raw secret must be absent from the entire serialized response
    expect(responseText).not.toContain(rawSecret);
  });

  // BT-003: failed artifact — secret must be absent from client payload
  test("BT-003: failed artifact has null summary and sourceLocation in response", async () => {
    const rawSecret = "TOP_SECRET_FAILED_PII_CONTENT_MUST_NOT_REACH_CLIENT";
    artifactsResult = [
      makeArtifact("art-3", "failed", {
        summary: rawSecret,
        sourceLocation: "s3://bucket/art-3.md",
      }),
    ];

    const { GET } = await routeModulePromise;
    const response = await GET(createRequest(), createRouteContext());
    const body = (await response.json()) as {
      workflowArtifacts: Array<{
        id: string;
        summary: string | null;
        sourceLocation: string | null;
        redactionStatus: string;
      }>;
    };
    const responseText = JSON.stringify(body);

    expect(response.status).toBe(200);
    const art = body.workflowArtifacts[0];
    expect(art?.redactionStatus).toBe("failed");
    expect(art?.summary).toBeNull();
    expect(art?.sourceLocation).toBeNull();
    expect(responseText).not.toContain(rawSecret);
  });

  // BT-004: blocked artifact — secret must be absent from client payload
  test("BT-004: blocked artifact has null summary and sourceLocation in response", async () => {
    const rawSecret = "TOP_SECRET_BLOCKED_CONTENT_MUST_NOT_REACH_CLIENT";
    artifactsResult = [
      makeArtifact("art-4", "blocked", {
        summary: rawSecret,
        sourceLocation: "s3://bucket/art-4.md",
      }),
    ];

    const { GET } = await routeModulePromise;
    const response = await GET(createRequest(), createRouteContext());
    const body = (await response.json()) as {
      workflowArtifacts: Array<{
        id: string;
        summary: string | null;
        sourceLocation: string | null;
        redactionStatus: string;
      }>;
    };
    const responseText = JSON.stringify(body);

    expect(response.status).toBe(200);
    const art = body.workflowArtifacts[0];
    expect(art?.redactionStatus).toBe("blocked");
    expect(art?.summary).toBeNull();
    expect(art?.sourceLocation).toBeNull();
    expect(responseText).not.toContain(rawSecret);
  });

  // BT-005: listArtifacts failure degrades gracefully to empty array
  test("BT-005: listArtifacts failure yields workflowArtifacts: [] (defensive fallback)", async () => {
    listArtifactsShouldThrow = true;

    const { GET } = await routeModulePromise;
    const response = await GET(createRequest(), createRouteContext());
    const body = (await response.json()) as {
      workflowArtifacts: unknown;
      runtimeMode: string;
    };

    expect(response.status).toBe(200);
    expect(body.workflowArtifacts).toEqual([]);
    // Existing fields must still be present
    expect(body.runtimeMode).toBeDefined();
  });

  // BT-006: safe metadata (id/kind/status/redactionStatus/createdByActor/createdAt) always present
  test("BT-006: safe metadata is always included regardless of redactionStatus", async () => {
    artifactsResult = [
      makeArtifact("art-5", "pending"),
      makeArtifact("art-6", "passed"),
    ];

    const { GET } = await routeModulePromise;
    const response = await GET(createRequest(), createRouteContext());
    const body = (await response.json()) as {
      workflowArtifacts: Array<{
        id: string;
        kind: string;
        status: string;
        redactionStatus: string;
        createdByActor: string | null;
        createdAt: string;
      }>;
    };

    expect(body.workflowArtifacts).toHaveLength(2);
    for (const art of body.workflowArtifacts) {
      expect(art.id).toBeTruthy();
      expect(art.kind).toBeTruthy();
      expect(art.status).toBeTruthy();
      expect(art.redactionStatus).toBeTruthy();
      expect(art.createdAt).toBeTruthy();
    }
  });

  // BT-007: auth preservation — existing fields not removed
  test("BT-007: existing response fields are preserved when workflowArtifacts is added", async () => {
    const { GET } = await routeModulePromise;
    const response = await GET(createRequest(), createRouteContext());
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toHaveProperty("runtimeMode");
    expect(body).toHaveProperty("events");
    expect(body).toHaveProperty("profileRuns");
    expect(body).toHaveProperty("workflowRuns");
    expect(body).toHaveProperty("workers");
    expect(body).toHaveProperty("directToolUse");
    expect(body).toHaveProperty("services");
    expect(body).toHaveProperty("browserRuns");
    expect(body).toHaveProperty("workflowArtifacts");
  });
});
