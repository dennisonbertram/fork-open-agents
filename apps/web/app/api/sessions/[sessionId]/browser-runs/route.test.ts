import { beforeEach, describe, expect, mock, test } from "bun:test";

const sandboxState = {
  type: "vercel" as const,
  sandboxName: "session-1",
};

const sessionRecord = {
  id: "session-1",
  userId: "user-1",
  runtimeMode: "managed_runtime" as const,
  sandboxState,
};

const sandbox = {
  workingDirectory: "/vercel/sandbox",
};

const requireAuthenticatedUserMock = mock(async () => ({
  ok: true as const,
  userId: "user-1",
}));

const requireOwnedSessionWithSandboxGuardMock = mock(async () => ({
  ok: true as const,
  sessionRecord,
}));

const connectSandboxMock = mock(async () => sandbox);
const getSandboxServiceMock = mock(async () => ({
  id: "service-1",
  url: "http://127.0.0.1:5173/",
}));
const runManagedBrowserCheckMock = mock(async () => ({
  id: "browser-run-1",
  status: "passed" as const,
  targetUrl: "http://127.0.0.1:5173/",
  summary: "Browser check loaded the preview and captured a snapshot.",
  consoleErrors: [],
  networkErrors: [],
  steps: [],
  artifactRefs: [],
  redactionStatus: "passed" as const,
}));

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: requireAuthenticatedUserMock,
  requireOwnedSessionWithSandboxGuard: requireOwnedSessionWithSandboxGuardMock,
}));

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: connectSandboxMock,
}));

mock.module("@/lib/sandbox/runtime/browser-runs", () => ({
  listManagedBrowserRuns: mock(async () => []),
  runManagedBrowserCheck: runManagedBrowserCheckMock,
}));

mock.module("@/lib/sandbox/runtime/service-records", () => ({
  getSandboxService: getSandboxServiceMock,
}));

mock.module("@/lib/sandbox/utils", () => ({
  isSandboxActive: () => true,
}));

const routeModulePromise = import("./route");

function createRouteContext(sessionId = "session-1") {
  return {
    params: Promise.resolve({ sessionId }),
  };
}

describe("/api/sessions/[sessionId]/browser-runs", () => {
  beforeEach(() => {
    requireAuthenticatedUserMock.mockClear();
    requireOwnedSessionWithSandboxGuardMock.mockClear();
    connectSandboxMock.mockClear();
    getSandboxServiceMock.mockClear();
    runManagedBrowserCheckMock.mockClear();
  });

  test("reconnects with managed runtime preview ports before running browser checks", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/browser-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId: "service-1",
          chatId: "chat-1",
        }),
      }),
      createRouteContext(),
    );
    const body = (await response.json()) as { run: { id: string } };

    expect(response.status).toBe(200);
    expect(body.run.id).toBe("browser-run-1");
    expect(connectSandboxMock).toHaveBeenCalledWith(sandboxState, {
      ports: [3000, 5173, 4321, 8000],
    });
    expect(runManagedBrowserCheckMock).toHaveBeenCalledWith({
      sessionId: "session-1",
      userId: "user-1",
      chatId: "chat-1",
      serviceId: "service-1",
      targetUrl: "http://127.0.0.1:5173/",
      sandbox,
    });
  });
});
