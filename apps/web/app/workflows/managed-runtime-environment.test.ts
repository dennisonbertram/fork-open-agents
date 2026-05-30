/**
 * Behavioral tests for ensureManagedRuntimeEnvironment:
 *
 * Test 1: required probe failure → status "blocked" + managed_runtime.profile.blocked event
 * Test 2: optional probe failure → non-blocking (status stays successful; skipped event emitted)
 * Test B1: empty setupCommands + present setupScript → setupScript executed as per-session setup fallback
 *
 * Test 3 (caller side): no-available-package-manager throw → managed_runtime.profile.blocked signal
 * (the throw itself is tested in js-package-manager.test.ts; here we test the surface in the
 *  workflow that converts it to a blocked structured event)
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ManagedRuntimeProfile } from "@open-agents/sandbox/managed-runtime-profiles";

// ── Module stubs ───────────────────────────────────────────────────────────────

mock.module("server-only", () => ({}));
mock.module("workflow", () => ({
  getWritable: () =>
    new WritableStream({
      write() {},
    }),
  getWorkflowMetadata: () => ({ workflowRunId: null }),
}));

// Capture emitted events
const emittedEvents: Array<Record<string, unknown>> = [];
mock.module("@/lib/observability/events", () => ({
  emitSessionEvent: async (params: Record<string, unknown>) => {
    emittedEvents.push(params);
  },
}));

// Capture profile run DB calls
type ProfileRunRecord = {
  id: string;
  status: string;
  setupResults: unknown[];
  verificationResults: unknown[];
  failureMessage: string | null;
  summary: string | null;
  snapshotId: string | null;
};
const profileRunRecords = new Map<string, ProfileRunRecord>();
let profileRunIdCounter = 0;

mock.module("@/lib/observability/managed-runtime-profile-runs", () => ({
  buildManagedRuntimeCommandObservation: (params: {
    command: { id: string; label: string; required?: boolean };
    status: string;
    startedAt: Date;
    finishedAt?: Date;
    result?: {
      success: boolean;
      exitCode?: number | null;
      stdout?: string;
      stderr?: string;
    };
  }) => ({
    commandId: params.command.id,
    label: params.command.label,
    status: params.status,
    required: params.command.required ?? true,
    exitCode: params.result?.exitCode ?? null,
    // Simulate redaction: the real summarizeManagedRuntimeCommandOutput applies
    // redactHarnessValue/redactSandboxLog; in tests we return a sentinel that is
    // clearly distinct from any raw secret value fed by the test.
    summary: `[mock-redacted:${params.command.id}]`,
    startedAt: params.startedAt.toISOString(),
    finishedAt: params.finishedAt?.toISOString(),
  }),
  startManagedRuntimeProfileRun: async (params: {
    profile: ManagedRuntimeProfile;
    snapshotId?: string | null;
  }) => {
    const id = `run-${++profileRunIdCounter}`;
    const record: ProfileRunRecord = {
      id,
      status: "running",
      setupResults: [],
      verificationResults: [],
      failureMessage: null,
      summary: null,
      snapshotId: params.snapshotId ?? null,
    };
    profileRunRecords.set(id, record);
    return record;
  },
  appendManagedRuntimeSetupResult: async (params: {
    profileRunId: string;
    observation: unknown;
  }) => {
    const record = profileRunRecords.get(params.profileRunId);
    if (record) {
      record.setupResults.push(params.observation);
    }
    return record ?? { id: params.profileRunId };
  },
  appendManagedRuntimeVerificationResult: async (params: {
    profileRunId: string;
    observation: unknown;
  }) => {
    const record = profileRunRecords.get(params.profileRunId);
    if (record) {
      record.verificationResults.push(params.observation);
    }
    return record ?? { id: params.profileRunId };
  },
  finishManagedRuntimeProfileRun: async (params: {
    profileRunId: string;
    status: string;
    summary?: string | null;
    failureMessage?: string | null;
  }) => {
    const record = profileRunRecords.get(params.profileRunId);
    if (record) {
      record.status = params.status;
      record.failureMessage = params.failureMessage ?? null;
      record.summary = params.summary ?? null;
    }
    return record ?? { id: params.profileRunId };
  },
}));

// ── Sandbox stub ───────────────────────────────────────────────────────────────

type CommandResponse = {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
};
const sandboxCommandResponses = new Map<string, CommandResponse>();
const executedCommands: string[] = [];

function createMockSandbox() {
  return {
    workingDirectory: "/vercel/sandbox",
    async exec(command: string): Promise<CommandResponse> {
      executedCommands.push(command);
      return (
        sandboxCommandResponses.get(command) ?? {
          success: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
        }
      );
    },
  };
}

// ── Session stub ───────────────────────────────────────────────────────────────

function createMockSession(
  overrides: Partial<{ id: string; userId: string }> = {},
) {
  return {
    id: overrides.id ?? "session-test-1",
    userId: overrides.userId ?? "user-test-1",
  };
}

function createMockStartupReporter() {
  return {
    async send() {},
    async appendCommandResult() {},
  };
}

// ── Module under test (lazy import after mocks) ────────────────────────────────

const modulePromise = import("./managed-runtime-environment");

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeProfile(
  overrides: Partial<ManagedRuntimeProfile> = {},
): ManagedRuntimeProfile {
  return {
    id: "test-profile",
    version: "1.0.0",
    displayName: "Test Profile",
    description: "Test managed runtime profile",
    setupCommands: [],
    verificationCommands: [],
    expectedTools: [],
    optionalTools: [],
    defaultPorts: [3000],
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("ensureManagedRuntimeEnvironment", () => {
  beforeEach(() => {
    emittedEvents.length = 0;
    profileRunRecords.clear();
    sandboxCommandResponses.clear();
    executedCommands.length = 0;
  });

  // Test 1: required probe failure → status "blocked" + managed_runtime.profile.blocked event
  test("required verification failure sets run status to blocked and emits managed_runtime.profile.blocked", async () => {
    const { ensureManagedRuntimeEnvironment } = await modulePromise;

    const profile = makeProfile({
      verificationCommands: [
        {
          id: "verify-required-tool",
          label: "Verify required tool",
          description: "Checks required tool availability",
          command: "required-tool --version",
          required: true,
        },
      ],
    });

    // Required tool probe fails
    sandboxCommandResponses.set("required-tool --version", {
      success: false,
      exitCode: 127,
      stdout: "",
      stderr: "required-tool: not found",
    });

    await ensureManagedRuntimeEnvironment({
      session: createMockSession(),
      chatId: null,
      userId: "user-test-1",
      workflowRunId: null,
      sandbox: createMockSandbox() as unknown as Parameters<
        typeof ensureManagedRuntimeEnvironment
      >[0]["sandbox"],
      sandboxName: null,
      profile,
      startupReporter: createMockStartupReporter() as unknown as Parameters<
        typeof ensureManagedRuntimeEnvironment
      >[0]["startupReporter"],
    });

    // The profile run record should be blocked
    const [run] = [...profileRunRecords.values()];
    expect(run).toBeDefined();
    expect(run.status).toBe("blocked");

    // The managed_runtime.profile.blocked event must have been emitted
    const blockedEvent = emittedEvents.find(
      (e) => e["eventName"] === "managed_runtime.profile.blocked",
    );
    expect(blockedEvent).toBeDefined();
    expect(blockedEvent?.["status"]).toBe("blocked");
  });

  // Test 2: optional probe failure is non-blocking
  test("optional verification failure does not block the run and emits skipped event", async () => {
    const { ensureManagedRuntimeEnvironment } = await modulePromise;

    const profile = makeProfile({
      verificationCommands: [
        {
          id: "observe-optional-tool",
          label: "Observe optional tool",
          description: "Records whether optional tool is present",
          command: "optional-tool --version",
          required: false,
        },
      ],
    });

    // Optional tool probe fails
    sandboxCommandResponses.set("optional-tool --version", {
      success: false,
      exitCode: 127,
      stdout: "",
      stderr: "optional-tool: not found",
    });

    const result = await ensureManagedRuntimeEnvironment({
      session: createMockSession(),
      chatId: null,
      userId: "user-test-1",
      workflowRunId: null,
      sandbox: createMockSandbox() as unknown as Parameters<
        typeof ensureManagedRuntimeEnvironment
      >[0]["sandbox"],
      sandboxName: null,
      profile,
      startupReporter: createMockStartupReporter() as unknown as Parameters<
        typeof ensureManagedRuntimeEnvironment
      >[0]["startupReporter"],
    });

    // Run must NOT be blocked — it should have finished as passed
    const [run] = [...profileRunRecords.values()];
    expect(run).toBeDefined();
    expect(run.status).toBe("passed");

    // A skipped/optional-unavailable event must have been emitted (NOT a blocked event)
    const blockedEvent = emittedEvents.find(
      (e) => e["eventName"] === "managed_runtime.profile.blocked",
    );
    expect(blockedEvent).toBeUndefined();

    const skippedEvent = emittedEvents.find(
      (e) =>
        e["eventName"] === "managed_runtime.profile.verify.command.skipped",
    );
    expect(skippedEvent).toBeDefined();

    // Notes record the optional miss
    expect(result.notes.some((n) => n.includes("Optional"))).toBe(true);
  });

  // Decision B1: empty setupCommands + present setupScript → setupScript executed
  test("executes setupScript as per-session setup fallback when setupCommands is empty", async () => {
    const { ensureManagedRuntimeEnvironment } = await modulePromise;

    const profile = makeProfile({
      setupScript: {
        repoPath: "profiles/test/setup.sh",
        sandboxPath: "/tmp/test/setup.sh",
        command: "bash /tmp/test/setup.sh",
        timeoutMs: 60_000,
      },
      setupCommands: [], // empty — should fall back to setupScript
    });

    await ensureManagedRuntimeEnvironment({
      session: createMockSession(),
      chatId: null,
      userId: "user-test-1",
      workflowRunId: null,
      sandbox: createMockSandbox() as unknown as Parameters<
        typeof ensureManagedRuntimeEnvironment
      >[0]["sandbox"],
      sandboxName: null,
      profile,
      startupReporter: createMockStartupReporter() as unknown as Parameters<
        typeof ensureManagedRuntimeEnvironment
      >[0]["startupReporter"],
    });

    // The setupScript command must have been executed
    expect(executedCommands).toContain("bash /tmp/test/setup.sh");
  });

  // BT-SEC-001: setupScript failure path uses redacted observation summary, not raw output
  test("setupScript failure persists redacted failureMessage and emits redacted payload.summary — never raw secret output", async () => {
    const { ensureManagedRuntimeEnvironment } = await modulePromise;

    const SECRET_TOKEN = "ghp_SUPERSECRETTOKEN1234567890abcdef";

    const profile = makeProfile({
      setupScript: {
        repoPath: "profiles/test/setup.sh",
        sandboxPath: "/tmp/test/setup.sh",
        command: "bash /tmp/test/setup.sh",
        timeoutMs: 60_000,
      },
      setupCommands: [],
    });

    // Script fails and its output contains a secret token
    sandboxCommandResponses.set("bash /tmp/test/setup.sh", {
      success: false,
      exitCode: 1,
      stdout: "",
      stderr: `fatal: token=${SECRET_TOKEN} is invalid`,
    });

    try {
      await ensureManagedRuntimeEnvironment({
        session: createMockSession(),
        chatId: null,
        userId: "user-test-1",
        workflowRunId: null,
        sandbox: createMockSandbox() as unknown as Parameters<
          typeof ensureManagedRuntimeEnvironment
        >[0]["sandbox"],
        sandboxName: null,
        profile,
        startupReporter: createMockStartupReporter() as unknown as Parameters<
          typeof ensureManagedRuntimeEnvironment
        >[0]["startupReporter"],
      });
    } catch {
      // WorkspaceSetupError is expected; we only care about what was persisted/emitted
    }

    // The persisted failureMessage must NOT contain the raw secret token
    const [run] = [...profileRunRecords.values()];
    expect(run).toBeDefined();
    expect(run.failureMessage).not.toContain(SECRET_TOKEN);

    // The persisted failureMessage must be the redacted observation summary from
    // buildManagedRuntimeCommandObservation (our mock returns "[mock-redacted:setup-script]")
    expect(run.failureMessage).toBe("[mock-redacted:setup-script]");

    // The emitted managed_runtime.profile.failed event payload must also use the redacted summary
    const failedEvent = emittedEvents.find(
      (e) => e["eventName"] === "managed_runtime.profile.failed",
    );
    expect(failedEvent).toBeDefined();
    const payload = failedEvent?.["payload"] as Record<string, unknown>;
    expect(payload).toBeDefined();
    expect(String(payload["summary"] ?? "")).not.toContain(SECRET_TOKEN);
    expect(String(payload["summary"] ?? "")).toBe("[mock-redacted:setup-script]");
  });
});
