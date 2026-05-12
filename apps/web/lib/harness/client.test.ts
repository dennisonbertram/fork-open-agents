import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const clientModulePromise = import("./client");

const config = {
  enabled: true,
  baseUrl: "https://harness.example.com",
  serviceToken: "service-token",
  tenantId: "tenant-1",
  defaultProjectId: "project-1",
  allowedDirectMode: false,
  logJson: false,
  requestTimeoutMs: 1000,
  sseReplayLimit: 100,
} as const;

const context = {
  tenantId: "tenant-1",
  projectId: "project-1",
  actorId: "user-1",
  requestId: "request-123",
};

describe("harness client", () => {
  test("sends auth, scope, idempotency, and request id headers", async () => {
    const { HarnessClient } = await clientModulePromise;
    const calls: Request[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(new Request(input, init));
      return Response.json({ run_id: "run-1", status: "accepted" });
    }) as unknown as typeof fetch;
    const client = new HarnessClient(config, fetchImpl);

    await client.createRun({
      context,
      idempotencyKey: "idem-1",
      body: { mode: "verified_build" },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://harness.example.com/runs");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer service-token");
    expect(calls[0]?.headers.get("x-open-agents-tenant")).toBe("tenant-1");
    expect(calls[0]?.headers.get("x-open-agents-project")).toBe("project-1");
    expect(calls[0]?.headers.get("x-open-agents-actor")).toBe("user-1");
    expect(calls[0]?.headers.get("x-request-id")).toBe("request-123");
    expect(calls[0]?.headers.get("idempotency-key")).toBe("idem-1");
  });

  test("maps auth and server failures", async () => {
    const { HarnessClient } = await clientModulePromise;
    const client = new HarnessClient(config, (async () =>
      Response.json({}, { status: 401 })) as unknown as typeof fetch);

    await expect(
      client.getRun({ context, harnessRunId: "run-1" }),
    ).rejects.toMatchObject({
      code: "harness_unauthorized",
      status: 401,
    });
  });
});
