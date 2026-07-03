import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { SetupManagedRuntimeProfileInput } from "@open-agents/agent";
import type { ManagedRuntimeCommandObservation } from "@/lib/db/schema";

mock.module("server-only", () => ({}));

let authenticatedUser:
  | {
      ok: true;
      userId: string;
    }
  | {
      ok: false;
      response: Response;
    } = { ok: true, userId: "user-1" };
let ownedSession:
  | {
      ok: true;
      sessionRecord: {
        id: string;
        userId: string;
        sandboxState: { type: string; sandboxName: string; expiresAt: number };
      };
    }
  | {
      ok: false;
      response: Response;
    } = {
  ok: true,
  sessionRecord: {
    id: "session-1",
    userId: "user-1",
    sandboxState: {
      type: "vercel",
      sandboxName: "session_session-1",
      expiresAt: Date.now() + 60_000,
    },
  },
};

type DraftRecord = {
  id: string;
  userId: string;
  sessionId: string;
  chatId: string;
  toolCallId: string;
  status: string;
  targetScope: string;
  goal: string;
  repoSignals: string[];
  profileDraft: SetupManagedRuntimeProfileInput["draft"];
  questionsForUser: string[];
  latestTestRunId: string | null;
  testResults: ManagedRuntimeCommandObservation[];
  testFailureMessage: string | null;
  testedAt: Date | null;
  userInstructions: string | null;
  userDecision: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const draftRecord: DraftRecord = {
  id: "draft-1",
  userId: "user-1",
  sessionId: "session-1",
  chatId: "chat-1",
  toolCallId: "tool-1",
  status: "draft_ready",
  targetScope: "session",
  goal: "Set up this app",
  repoSignals: [],
  profileDraft: {
    displayName: "Bun app",
    description: "Install and verify Bun",
    setupCommands: [
      {
        id: "install-bun",
        label: "Install Bun",
        description: "Install Bun",
        command: "bun --version",
      },
    ],
    verificationCommands: [
      {
        id: "verify-bun",
        label: "Verify Bun",
        description: "Verify Bun",
        command: "bun --version",
      },
    ],
    expectedTools: ["bun"],
    optionalTools: [],
    defaultPorts: [3000],
  },
  questionsForUser: [],
  latestTestRunId: null,
  testResults: [],
  testFailureMessage: null,
  testedAt: null,
  userInstructions: null,
  userDecision: null,
  createdAt: new Date("2026-05-24T00:00:00.000Z"),
  updatedAt: new Date("2026-05-24T00:00:00.000Z"),
};

const calls: Array<Record<string, unknown>> = [];
let draftResult: DraftRecord | undefined = draftRecord;
let execResults: Array<{
  success: boolean;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
}> = [{ success: true, exitCode: 0, stdout: "1.2.3\n" }];
let connectError: Error | null = null;

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: async (sandboxState: unknown) => {
    calls.push({ fn: "connectSandbox", sandboxState });
    if (connectError) {
      throw connectError;
    }
    return {
      workingDirectory: "/repo",
      exec: async (command: string, cwd: string, timeoutMs: number) => {
        calls.push({ fn: "exec", command, cwd, timeoutMs });
        const result = execResults.shift();
        if (!result) {
          return { success: true, exitCode: 0, stdout: "" };
        }
        return result;
      },
    };
  },
}));

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authenticatedUser,
  requireOwnedSessionWithSandboxGuard: async () => ownedSession,
}));

mock.module("@/lib/db/sessions", () => ({
  getChatsBySessionId: async () => [],
  getSessionById: async () => null,
  updateSession: async (sessionId: string, update: Record<string, unknown>) => {
    calls.push({ fn: "updateSession", sessionId, update });
  },
}));

mock.module("@/lib/db/managed-runtime-profile-drafts", () => ({
  finishManagedRuntimeProfileDraftTest: async (
    params: Record<string, unknown>,
  ) => {
    calls.push({ fn: "finish", ...params });
    if (!draftResult) {
      return undefined;
    }
    return {
      ...draftResult,
      status: params.status,
      testResults: params.testResults,
      testFailureMessage: params.testFailureMessage ?? null,
      testScope: params.testScope ?? null,
      testedAt: new Date("2026-05-24T00:01:00.000Z"),
    };
  },
  getManagedRuntimeProfileDraft: async (params: Record<string, unknown>) => {
    calls.push({ fn: "get", ...params });
    return draftResult;
  },
  markManagedRuntimeProfileDraftTesting: async (
    params: Record<string, unknown>,
  ) => {
    calls.push({ fn: "markTesting", ...params });
    return draftResult ? { ...draftResult, status: "testing" } : undefined;
  },
  toManagedRuntimeProfileDraftSnapshot: (draft: DraftRecord) => ({
    ...draft,
    createdAt: draft.createdAt.toISOString(),
    testedAt: draft.testedAt?.toISOString() ?? null,
    updatedAt: draft.updatedAt.toISOString(),
  }),
}));

const routeModulePromise = import("./route");

function routeContext() {
  return {
    params: Promise.resolve({
      sessionId: "session-1",
      draftId: "draft-1",
    }),
  };
}

function request(body?: unknown) {
  return new Request(
    "http://localhost/api/sessions/session-1/managed-runtime/profile-drafts/draft-1/test",
    body === undefined
      ? { method: "POST" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
}

describe("/api/sessions/[sessionId]/managed-runtime/profile-drafts/[draftId]/test", () => {
  beforeEach(() => {
    authenticatedUser = { ok: true, userId: "user-1" };
    ownedSession = {
      ok: true,
      sessionRecord: {
        id: "session-1",
        userId: "user-1",
        sandboxState: {
          type: "vercel",
          sandboxName: "session_session-1",
          expiresAt: Date.now() + 60_000,
        },
      },
    };
    draftResult = draftRecord;
    execResults = [{ success: true, exitCode: 0, stdout: "1.2.3\n" }];
    connectError = null;
    calls.length = 0;
  });

  test("runs verification commands and records passing evidence", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(request(), routeContext());
    const body = (await response.json()) as {
      draft: {
        status: string;
        testResults: Array<{ commandId: string; status: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.draft.status).toBe("tested");
    expect(body.draft.testResults[0]).toMatchObject({
      commandId: "verify-bun",
      status: "passed",
    });
    expect(calls).toContainEqual(
      expect.objectContaining({
        fn: "exec",
        command: "bun --version",
        cwd: "/repo",
        timeoutMs: 120_000,
      }),
    );
    expect(calls).toContainEqual(
      expect.objectContaining({
        fn: "finish",
        status: "tested",
        testFailureMessage: null,
      }),
    );
  });

  test("runs setup commands before verification when requested", async () => {
    execResults = [
      { success: true, exitCode: 0, stdout: "installed\n" },
      { success: true, exitCode: 0, stdout: "1.2.3\n" },
    ];
    const { POST } = await routeModulePromise;

    const response = await POST(
      request({ mode: "setup_and_verify" }),
      routeContext(),
    );
    const body = (await response.json()) as {
      draft: {
        status: string;
        testResults: Array<{ commandId: string; status: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.draft.status).toBe("tested");
    expect(body.draft.testResults).toEqual([
      expect.objectContaining({
        commandId: "install-bun",
        status: "passed",
      }),
      expect.objectContaining({
        commandId: "verify-bun",
        status: "passed",
      }),
    ]);
    expect(
      calls.filter((call) => call.fn === "exec").map((call) => call.command),
    ).toEqual(["bun --version", "bun --version"]);
  });

  test("stops setup-and-verify after a required setup command fails", async () => {
    execResults = [{ success: false, exitCode: 1, stderr: "install failed\n" }];
    const { POST } = await routeModulePromise;

    const response = await POST(
      request({ mode: "setup_and_verify" }),
      routeContext(),
    );
    const body = (await response.json()) as {
      draft: {
        status: string;
        testFailureMessage: string;
        testResults: Array<{ commandId: string; status: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.draft.status).toBe("needs_changes");
    expect(body.draft.testFailureMessage).toBe("Install Bun failed.");
    expect(body.draft.testResults).toEqual([
      expect.objectContaining({
        commandId: "install-bun",
        status: "failed",
      }),
    ]);
    expect(calls.filter((call) => call.fn === "exec")).toHaveLength(1);
  });

  test("marks the draft as needing changes when required verification fails", async () => {
    execResults = [{ success: false, exitCode: 1, stderr: "bun missing\n" }];
    const { POST } = await routeModulePromise;

    const response = await POST(request(), routeContext());
    const body = (await response.json()) as {
      draft: {
        status: string;
        testFailureMessage: string;
        testResults: Array<{ status: string; summary: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.draft.status).toBe("needs_changes");
    expect(body.draft.testFailureMessage).toBe("Verify Bun failed.");
    expect(body.draft.testResults[0]?.status).toBe("failed");
    expect(body.draft.testResults[0]?.summary).toContain("bun missing");
  });

  test("keeps optional verification failure visible without failing the draft", async () => {
    draftResult = {
      ...draftRecord,
      profileDraft: {
        ...draftRecord.profileDraft,
        verificationCommands: [
          {
            id: "observe-node",
            label: "Observe Node",
            description: "Observe Node",
            command: "node --version",
            required: false,
          },
        ],
      },
    };
    execResults = [{ success: false, exitCode: 127, stderr: "no node\n" }];
    const { POST } = await routeModulePromise;

    const response = await POST(request(), routeContext());
    const body = (await response.json()) as {
      draft: {
        status: string;
        testFailureMessage: string | null;
        testResults: Array<{ status: string; required: boolean }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.draft.status).toBe("tested");
    expect(body.draft.testFailureMessage).toBeNull();
    expect(body.draft.testResults[0]).toMatchObject({
      status: "failed",
      required: false,
    });
  });

  // RED: today the route never persists or returns which scope (verify vs
  // setup_and_verify) was actually executed.
  test("persists and returns the executed test scope for a verify-only pass", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(request(), routeContext());
    const body = (await response.json()) as {
      draft: { testScope: string };
    };

    expect(response.status).toBe(200);
    expect(body.draft.testScope).toBe("verify");
    expect(calls).toContainEqual(
      expect.objectContaining({ fn: "finish", testScope: "verify" }),
    );
  });

  test("persists and returns setup_and_verify as the executed test scope", async () => {
    execResults = [
      { success: true, exitCode: 0, stdout: "installed\n" },
      { success: true, exitCode: 0, stdout: "1.2.3\n" },
    ];
    const { POST } = await routeModulePromise;

    const response = await POST(
      request({ mode: "setup_and_verify" }),
      routeContext(),
    );
    const body = (await response.json()) as {
      draft: { testScope: string };
    };

    expect(response.status).toBe(200);
    expect(body.draft.testScope).toBe("setup_and_verify");
    expect(calls).toContainEqual(
      expect.objectContaining({ fn: "finish", testScope: "setup_and_verify" }),
    );
  });

  // RED: today verify-mode does NOT break the loop on a required failure
  // (route.ts:125-130 only breaks in setup_and_verify mode).
  test("stops running remaining verification commands after a required failure in verify mode", async () => {
    draftResult = {
      ...draftRecord,
      profileDraft: {
        ...draftRecord.profileDraft,
        verificationCommands: [
          {
            id: "verify-bun",
            label: "Verify Bun",
            description: "Verify Bun",
            command: "bun --version",
          },
          {
            id: "verify-node",
            label: "Verify Node",
            description: "Verify Node",
            command: "node --version",
          },
        ],
      },
    };
    execResults = [{ success: false, exitCode: 1, stderr: "bun missing\n" }];
    const { POST } = await routeModulePromise;

    const response = await POST(request(), routeContext());
    const body = (await response.json()) as {
      draft: { testResults: Array<{ commandId: string }> };
    };

    expect(response.status).toBe(200);
    expect(body.draft.testResults).toHaveLength(1);
    expect(calls.filter((call) => call.fn === "exec")).toHaveLength(1);
  });

  // RED: today the response never surfaces structured error fields for a
  // required-command failure.
  test("returns a structured error when a required setup command fails during setup_and_verify", async () => {
    execResults = [{ success: false, exitCode: 1, stderr: "install failed\n" }];
    const { POST } = await routeModulePromise;

    const response = await POST(
      request({ mode: "setup_and_verify" }),
      routeContext(),
    );
    const body = (await response.json()) as {
      draft: {
        errorKind: string;
        failureMessage: string;
        failedCommandLabel: string;
        nextAction: string;
      };
    };

    expect(response.status).toBe(200);
    expect(body.draft.errorKind).toBe("setup_command_failed");
    expect(body.draft.failedCommandLabel).toBe("Install Bun");
    expect(body.draft.failureMessage).toContain("Install Bun failed");
    expect(body.draft.nextAction).toContain("setup command");
  });

  test("returns 404 when the draft is missing", async () => {
    draftResult = undefined;
    const { POST } = await routeModulePromise;

    const response = await POST(request(), routeContext());
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe("Profile draft not found");
  });

  test("rejects invalid test modes", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      request({ mode: "everything" }),
      routeContext(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid managed runtime profile test mode");
    expect(calls).toEqual([]);
  });

  test("returns 409 and hibernates state when the sandbox is unavailable", async () => {
    connectError = new Error("sandbox not found");
    const { POST } = await routeModulePromise;

    const response = await POST(request(), routeContext());
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(body.error).toBe("Sandbox is unavailable. Please resume sandbox.");
    expect(calls).toContainEqual(
      expect.objectContaining({
        fn: "updateSession",
        sessionId: "session-1",
      }),
    );
  });
});
