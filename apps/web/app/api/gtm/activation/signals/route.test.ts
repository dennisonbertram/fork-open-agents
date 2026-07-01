import { beforeEach, describe, expect, mock, test } from "bun:test";
import { GtmActivationError } from "@/lib/gtm-activation/types";

mock.module("server-only", () => ({}));

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

let authResult: AuthResult = { ok: true, userId: "operator-1" };
const runGtmActivationWatcher = mock(async () => ({
  runId: "run-1",
  signalIds: ["signal-1"],
  approvalIds: ["approval-1"],
  dedupedCount: 0,
}));
const listGtmActivationSignals = mock(async () => [
  {
    signalId: "signal-1",
    signalType: "activation",
    severity: "medium",
    summary: "No GitHub install",
    evidenceRefs: [],
    metadata: {},
    updatedAt: new Date("2026-07-01T00:00:00Z"),
  },
]);

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/gtm-activation/store", () => ({
  runGtmActivationWatcher,
  listGtmActivationSignals,
}));

const routeModulePromise = import("./route");

describe("/api/gtm/activation/signals", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "operator-1" };
    runGtmActivationWatcher.mockClear();
    listGtmActivationSignals.mockClear();
  });

  test("requires authentication for scans", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/gtm/activation/signals", {
        method: "POST",
        body: "{}",
      }),
    );

    expect(response.status).toBe(401);
    expect(runGtmActivationWatcher).not.toHaveBeenCalled();
  });

  test("runs a user-scoped activation scan", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/gtm/activation/signals", {
        method: "POST",
        headers: { "x-request-id": "req-1" },
        body: JSON.stringify({
          candidates: [{ targetUserHash: "user-hash", githubInstalled: false }],
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.approvalIds).toEqual(["approval-1"]);
    expect(runGtmActivationWatcher).toHaveBeenCalledWith({
      userId: "operator-1",
      requestId: "req-1",
      candidates: [{ targetUserHash: "user-hash", githubInstalled: false }],
    });
  });

  test("lists private activation queue signals", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.signals[0].signalId).toBe("signal-1");
    expect(listGtmActivationSignals).toHaveBeenCalledWith("operator-1");
  });

  test("returns typed activation errors", async () => {
    runGtmActivationWatcher.mockRejectedValue(
      new GtmActivationError("invalid_signal_input", "Bad input"),
    );
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/gtm/activation/signals", {
        method: "POST",
        body: JSON.stringify({ candidates: [] }),
      }),
    );

    expect(response.status).toBe(400);
  });
});
