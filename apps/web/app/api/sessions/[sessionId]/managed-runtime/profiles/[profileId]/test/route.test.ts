import { beforeEach, describe, expect, mock, test } from "bun:test";
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

type SavedProfileRecord = {
  id: string;
  version: string;
  displayName: string;
  description: string;
  setupCommands: Array<{
    id: string;
    label: string;
    description: string;
    command: string;
    required?: boolean;
  }>;
  verificationCommands: Array<{
    id: string;
    label: string;
    description: string;
    command: string;
    required?: boolean;
  }>;
  expectedTools: string[];
  optionalTools: string[];
  defaultPorts: number[];
  testResults: ManagedRuntimeCommandObservation[];
  testFailureMessage: string | null;
  testedAt: Date | null;
};

const profileRecord: SavedProfileRecord = {
  id: "session-profile-draft-1",
  version: "edited-2026-05-24T00:00:00.000Z",
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
  testResults: [],
  testFailureMessage: null,
  testedAt: null,
};

const calls: Array<Record<string, unknown>> = [];
let profileResult: SavedProfileRecord | undefined = profileRecord;
let execResults: Array<{
  success: boolean;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
}> = [{ success: true, exitCode: 0, stdout: "1.2.3\n" }];

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: async (sandboxState: unknown) => {
    calls.push({ fn: "connectSandbox", sandboxState });
    return {
      workingDirectory: "/repo",
      exec: async (command: string, cwd: string, timeoutMs: number) => {
        calls.push({ fn: "exec", command, cwd, timeoutMs });
        const result = execResults.shift();
        return result ?? { success: true, exitCode: 0, stdout: "" };
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

mock.module("@/lib/db/managed-runtime-saved-profiles", () => ({
  finishManagedRuntimeSavedProfileTest: async (
    params: Record<string, unknown>,
  ) => {
    calls.push({ fn: "finish", ...params });
    return profileResult
      ? {
          ...profileResult,
          testResults: params.testResults,
          testFailureMessage: params.testFailureMessage ?? null,
          testScope: params.testScope ?? null,
          testedAt: new Date("2026-05-24T00:01:00.000Z"),
        }
      : undefined;
  },
  getManagedRuntimeSavedProfile: async (params: Record<string, unknown>) => {
    calls.push({ fn: "get", ...params });
    return profileResult;
  },
  markManagedRuntimeSavedProfileTesting: async (
    params: Record<string, unknown>,
  ) => {
    calls.push({ fn: "markTesting", ...params });
    return profileResult;
  },
  toManagedRuntimeProfile: (profile: SavedProfileRecord) => profile,
}));

const routeModulePromise = import("./route");

function routeContext() {
  return {
    params: Promise.resolve({
      sessionId: "session-1",
      profileId: "session-profile-draft-1",
    }),
  };
}

function request(body?: unknown) {
  return new Request(
    "http://localhost/api/sessions/session-1/managed-runtime/profiles/session-profile-draft-1/test",
    body === undefined
      ? { method: "POST" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
}

describe("/api/sessions/[sessionId]/managed-runtime/profiles/[profileId]/test", () => {
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
    profileResult = profileRecord;
    execResults = [{ success: true, exitCode: 0, stdout: "1.2.3\n" }];
    calls.length = 0;
  });

  test("runs verification commands and records passing saved profile evidence", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(request(), routeContext());
    const body = (await response.json()) as {
      testEvidence: {
        status: string;
        testResults: Array<{ commandId: string; status: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.testEvidence).toMatchObject({
      status: "passed",
    });
    expect(body.testEvidence.testResults[0]).toMatchObject({
      commandId: "verify-bun",
      status: "passed",
    });
    expect(calls).toContainEqual(
      expect.objectContaining({
        fn: "markTesting",
        profileId: "session-profile-draft-1",
      }),
    );
    expect(calls).toContainEqual(
      expect.objectContaining({
        fn: "finish",
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
      testEvidence: {
        testResults: Array<{ commandId: string; status: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.testEvidence.testResults).toEqual([
      expect.objectContaining({
        commandId: "install-bun",
        status: "passed",
      }),
      expect.objectContaining({
        commandId: "verify-bun",
        status: "passed",
      }),
    ]);
  });

  test("records failing saved profile evidence", async () => {
    execResults = [{ success: false, exitCode: 1, stderr: "bun missing\n" }];
    const { POST } = await routeModulePromise;

    const response = await POST(request(), routeContext());
    const body = (await response.json()) as {
      testEvidence: {
        status: string;
        testFailureMessage: string;
        testResults: Array<{ status: string; summary: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.testEvidence.status).toBe("failed");
    expect(body.testEvidence.testFailureMessage).toBe("Verify Bun failed.");
    expect(body.testEvidence.testResults[0]?.summary).toContain("bun missing");
  });

  test("returns 404 when the saved profile is missing", async () => {
    profileResult = undefined;
    const { POST } = await routeModulePromise;

    const response = await POST(request(), routeContext());
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe("Profile not found");
  });

  // RED: today the route never persists or returns which scope (verify vs
  // setup_and_verify) was actually executed, so a passing verify-only run and
  // a passing setup_and_verify run are indistinguishable to the caller.
  test("persists and returns the executed test scope for a verify-only pass", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(request(), routeContext());
    const body = (await response.json()) as {
      testEvidence: { testScope: string };
    };

    expect(response.status).toBe(200);
    expect(body.testEvidence.testScope).toBe("verify");
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
      testEvidence: { testScope: string };
    };

    expect(response.status).toBe(200);
    expect(body.testEvidence.testScope).toBe("setup_and_verify");
    expect(calls).toContainEqual(
      expect.objectContaining({ fn: "finish", testScope: "setup_and_verify" }),
    );
  });

  // RED: today verify-mode does NOT break the loop on a required failure
  // (route.ts:233-238 only breaks in setup_and_verify mode), so a required
  // verification failure does not stop later commands from running. This
  // pins the unified semantics: required failure breaks the loop in BOTH
  // modes.
  test("stops running remaining verification commands after a required failure in verify mode", async () => {
    profileResult = {
      ...profileRecord,
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
    };
    execResults = [{ success: false, exitCode: 1, stderr: "bun missing\n" }];
    const { POST } = await routeModulePromise;

    const response = await POST(request(), routeContext());
    const body = (await response.json()) as {
      testEvidence: {
        testResults: Array<{ commandId: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.testEvidence.testResults).toHaveLength(1);
    expect(calls.filter((call) => call.fn === "exec")).toHaveLength(1);
  });

  // RED: today the catch handler returns a generic
  // "Failed to test managed runtime profile" string instead of a structured,
  // actionable error.
  test("returns a structured error when a required setup command fails during setup_and_verify", async () => {
    execResults = [{ success: false, exitCode: 1, stderr: "install failed\n" }];
    const { POST } = await routeModulePromise;

    const response = await POST(
      request({ mode: "setup_and_verify" }),
      routeContext(),
    );
    const body = (await response.json()) as {
      testEvidence: {
        errorKind: string;
        failureMessage: string;
        failedCommandLabel: string;
        nextAction: string;
      };
    };

    expect(response.status).toBe(200);
    expect(body.testEvidence.errorKind).toBe("setup_command_failed");
    expect(body.testEvidence.failedCommandLabel).toBe("Install Bun");
    expect(body.testEvidence.failureMessage).toContain("Install Bun failed");
    expect(body.testEvidence.nextAction).toContain("setup command");
  });
});
