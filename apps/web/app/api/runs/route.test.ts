import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { RunsListResponse } from "@/lib/runs/list";

mock.module("server-only", () => ({}));

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

let authResult: AuthResult = { ok: true, userId: "user-1" };
const listDbBackedAutomationRuns = mock(
  async (): Promise<RunsListResponse> => ({
    requestId: "request-1",
    generatedAt: "2026-07-11T12:00:00.000Z",
    items: [],
    sourceStatus: [],
    allSourcesFailed: false,
  }),
);

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));
mock.module("@/lib/runs/store", () => ({ listDbBackedAutomationRuns }));

const routePromise = import("./route");

describe("GET /api/runs", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    listDbBackedAutomationRuns.mockClear();
  });

  test("does not probe sources before authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { GET } = await routePromise;
    const response = await GET(new Request("http://localhost/api/runs"));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(listDbBackedAutomationRuns).not.toHaveBeenCalled();
  });

  test("validates filters and forwards only the authenticated owner", async () => {
    const { GET } = await routePromise;
    const invalid = await GET(
      new Request("http://localhost/api/runs?repoOwner=acme"),
    );
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("cache-control")).toBe("no-store");
    expect(listDbBackedAutomationRuns).not.toHaveBeenCalled();

    const response = await GET(
      new Request(
        "http://localhost/api/runs?view=active&repoOwner=acme&repoName=shop&limit=25",
        { headers: { "x-request-id": "request-42" } },
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("request-42");
    expect(listDbBackedAutomationRuns).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        requestId: "request-42",
        filters: { view: "active", repoOwner: "acme", repoName: "shop" },
        limit: 25,
      }),
    );
  });

  test("does not reflect an unbounded request id", async () => {
    const { GET } = await routePromise;
    const response = await GET(
      new Request("http://localhost/api/runs", {
        headers: { "x-request-id": "x".repeat(1000) },
      }),
    );

    expect(response.headers.get("x-request-id")).not.toBe("x".repeat(1000));
    expect(response.headers.get("x-request-id")?.length).toBeLessThanOrEqual(
      128,
    );
  });

  test("returns a non-cacheable typed service failure when every source fails", async () => {
    listDbBackedAutomationRuns.mockResolvedValueOnce({
      requestId: "request-failed",
      generatedAt: "2026-07-11T12:00:00.000Z",
      items: [],
      sourceStatus: [
        {
          source: "background_agent",
          status: "failed",
          itemCount: 0,
          safeErrorKind: "source_unavailable",
        },
        {
          source: "agent_loop",
          status: "failed",
          itemCount: 0,
          safeErrorKind: "source_unavailable",
        },
      ],
      allSourcesFailed: true,
    });
    const { GET } = await routePromise;
    const response = await GET(new Request("http://localhost/api/runs"));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      allSourcesFailed: true,
      sourceStatus: [
        { safeErrorKind: "source_unavailable" },
        { safeErrorKind: "source_unavailable" },
      ],
    });
  });
});
