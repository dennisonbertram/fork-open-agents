import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createOnDemandSandboxForSession,
  resetSandboxProvisioning,
} from "./sandbox-create";

const fetchMock = mock(async (_input: RequestInfo | URL, _init?: RequestInit) =>
  Response.json({}),
);

globalThis.fetch = fetchMock as unknown as typeof fetch;

describe("resetSandboxProvisioning", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  test("clears the provisional sandbox attach state for a session", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ session: {} }));

    await resetSandboxProvisioning("session-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/sessions/session-1/sandbox", {
      method: "DELETE",
    });
  });
});

describe("createOnDemandSandboxForSession", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  test("resets provisioning state when VM creation fails after attach succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          session: {
            id: "session-1",
            sandboxState: { type: "vercel" },
            lifecycleState: "provisioning",
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json(
          { error: "VM creation failed. Please try again." },
          { status: 500 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ session: {} }));

    await expect(
      createOnDemandSandboxForSession({
        sessionId: "session-1",
        sandboxType: "vercel",
      }),
    ).rejects.toThrow("VM creation failed. Please try again.");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/sessions/session-1/sandbox",
      { method: "POST" },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        isNewBranch: false,
        sessionId: "session-1",
        sandboxType: "vercel",
      }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/sessions/session-1/sandbox",
      { method: "DELETE" },
    );
  });
});
