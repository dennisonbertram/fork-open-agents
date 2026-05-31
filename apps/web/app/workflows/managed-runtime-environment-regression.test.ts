/**
 * Regression tests for managed-runtime-environment.ts
 *
 * These tests would fail if the implementation in managed-runtime-environment.ts
 * were reverted to the old chat-sandbox-runtime.ts behavior, specifically:
 *
 * R-001: snapshotId is passed through startManagedRuntimeProfileRun
 * R-002: required probe failure → run STAYS blocked (not completed)
 * R-003: optional probe skipped → run does NOT become blocked
 * R-004: setupScript fallback is ONLY used when setupCommands is empty
 * R-005: when setupCommands are present, setupScript is NOT executed per-session
 * R-006: setupScript failure → failureMessage is the REDACTED observation summary, not raw output
 * R-007: setupScript failure → managed_runtime.profile.failed payload.summary is redacted, not raw output
 */

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
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

const emittedEvents: Array<Record<string, unknown>> = [];
mock.module("@/lib/observability/events", () => ({
  emitSessionEvent: async (params: Record<string, unknown>) => {
    emittedEvents.push(params);
  },
}));

type ProfileRunRecord = {
  id: string;
  status: string;
  snapshotId: string | null;
  failureMessage: string | null;
};
const profileRunRecords = new Map<string, ProfileRunRecord>();
let profileRunIdCounter = 0;
const startRunCalls: Array<Record<string, unknown>> = [];

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
    // Simulate redaction sentinel: the real impl applies redactHarnessValue/redactSandboxLog.
    // Using a sentinel lets regression tests verify the code uses the observation summary
    // rather than raw output.
    summary: `[mock-redacted:${params.command.id}]`,
    startedAt: params.startedAt.toISOString(),
    finishedAt: params.finishedAt?.toISOString(),
  }),
  startManagedRuntimeProfileRun: async (params: Record<string, unknown>) => {
    startRunCalls.push(params);
    const id = `run-${++profileRunIdCounter}`;
    const record: ProfileRunRecord = {
      id,
      status: "running",
      snapshotId: (params["snapshotId"] as string | null | undefined) ?? null,
      failureMessage: null,
    };
    profileRunRecords.set(id, record);
    return record;
  },
  appendManagedRuntimeSetupResult: async (params: {
    profileRunId: string;
    observation: unknown;
  }) =>
    profileRunRecords.get(params.profileRunId) ?? { id: params.profileRunId },
  appendManagedRuntimeVerificationResult: async (params: {
    profileRunId: string;
    observation: unknown;
  }) =>
    profileRunRecords.get(params.profileRunId) ?? { id: params.profileRunId },
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
    }
    return record ?? { id: params.profileRunId };
  },
}));

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

function createMockStartupReporter() {
  return {
    async send() {},
    async appendCommandResult() {},
  };
}

const modulePromise = import("./managed-runtime-environment");

afterAll(() => {
  mock.restore();
});

function makeProfile(
  overrides: Partial<ManagedRuntimeProfile> = {},
): ManagedRuntimeProfile {
  return {
    id: "regression-profile",
    version: "1.0.0",
    displayName: "Regression Profile",
    description: "Used for regression testing",
    setupCommands: [],
    verificationCommands: [],
    expectedTools: [],
    optionalTools: [],
    defaultPorts: [3000],
    ...overrides,
  };
}

function createMockSession() {
  return { id: "regression-session-1", userId: "regression-user-1" };
}

describe("managed-runtime-environment regression", () => {
  beforeEach(() => {
    emittedEvents.length = 0;
    profileRunRecords.clear();
    sandboxCommandResponses.clear();
    executedCommands.length = 0;
    startRunCalls.length = 0;
  });

  // R-001: snapshotId is forwarded to startManagedRuntimeProfileRun
  test("R-001: snapshotId provided to ensureManagedRuntimeEnvironment is forwarded to the run record", async () => {
    const { ensureManagedRuntimeEnvironment } = await modulePromise;

    await ensureManagedRuntimeEnvironment({
      session: createMockSession(),
      chatId: null,
      userId: "regression-user-1",
      workflowRunId: null,
      sandbox: createMockSandbox() as unknown as Parameters<
        typeof ensureManagedRuntimeEnvironment
      >[0]["sandbox"],
      sandboxName: null,
      profile: makeProfile(),
      startupReporter: createMockStartupReporter() as unknown as Parameters<
        typeof ensureManagedRuntimeEnvironment
      >[0]["startupReporter"],
      snapshotId: "snap_regression_test",
    });

    // The snapshotId must appear in the startRun call
    expect(startRunCalls).toHaveLength(1);
    expect(startRunCalls[0]).toMatchObject({
      snapshotId: "snap_regression_test",
    });
  });

  // R-002: required probe failure → run stays blocked after return
  test("R-002: run status is blocked after required verification failure and does not become passed", async () => {
    const { ensureManagedRuntimeEnvironment } = await modulePromise;

    sandboxCommandResponses.set("required-tool --version", {
      success: false,
      exitCode: 127,
      stdout: "",
      stderr: "required-tool: not found",
    });

    await ensureManagedRuntimeEnvironment({
      session: createMockSession(),
      chatId: null,
      userId: "regression-user-1",
      workflowRunId: null,
      sandbox: createMockSandbox() as unknown as Parameters<
        typeof ensureManagedRuntimeEnvironment
      >[0]["sandbox"],
      sandboxName: null,
      profile: makeProfile({
        verificationCommands: [
          {
            id: "verify-required",
            label: "Verify required",
            description: "Required",
            command: "required-tool --version",
            required: true,
          },
        ],
      }),
      startupReporter: createMockStartupReporter() as unknown as Parameters<
        typeof ensureManagedRuntimeEnvironment
      >[0]["startupReporter"],
    });

    const [run] = [...profileRunRecords.values()];
    // If regression: this would be "passed" instead of "blocked"
    expect(run.status).toBe("blocked");
    expect(run.status).not.toBe("passed");
  });

  // R-003: optional probe failure does NOT set blocked status
  test("R-003: optional probe failure leaves run status as passed, not blocked", async () => {
    const { ensureManagedRuntimeEnvironment } = await modulePromise;

    sandboxCommandResponses.set("optional-tool --version", {
      success: false,
      exitCode: 127,
      stdout: "",
      stderr: "optional-tool: not found",
    });

    await ensureManagedRuntimeEnvironment({
      session: createMockSession(),
      chatId: null,
      userId: "regression-user-1",
      workflowRunId: null,
      sandbox: createMockSandbox() as unknown as Parameters<
        typeof ensureManagedRuntimeEnvironment
      >[0]["sandbox"],
      sandboxName: null,
      profile: makeProfile({
        verificationCommands: [
          {
            id: "observe-optional",
            label: "Observe optional",
            description: "Optional",
            command: "optional-tool --version",
            required: false,
          },
        ],
      }),
      startupReporter: createMockStartupReporter() as unknown as Parameters<
        typeof ensureManagedRuntimeEnvironment
      >[0]["startupReporter"],
    });

    const [run] = [...profileRunRecords.values()];
    // If regression: this would be "blocked" instead of "passed"
    expect(run.status).toBe("passed");
    expect(run.status).not.toBe("blocked");
  });

  // R-004: setupScript only executed as fallback when setupCommands is empty
  test("R-004: setupScript is NOT executed when setupCommands has items", async () => {
    const { ensureManagedRuntimeEnvironment } = await modulePromise;

    await ensureManagedRuntimeEnvironment({
      session: createMockSession(),
      chatId: null,
      userId: "regression-user-1",
      workflowRunId: null,
      sandbox: createMockSandbox() as unknown as Parameters<
        typeof ensureManagedRuntimeEnvironment
      >[0]["sandbox"],
      sandboxName: null,
      profile: makeProfile({
        setupScript: {
          repoPath: "profiles/test/setup.sh",
          sandboxPath: "/tmp/test/setup.sh",
          command: "bash /tmp/test/setup.sh",
          timeoutMs: 60_000,
        },
        setupCommands: [
          {
            id: "install-explicit",
            label: "Install explicit",
            description: "Explicit install step",
            command: "curl -fsSL https://example.com | bash",
          },
        ],
      }),
      startupReporter: createMockStartupReporter() as unknown as Parameters<
        typeof ensureManagedRuntimeEnvironment
      >[0]["startupReporter"],
    });

    // setupCommands takes precedence — setupScript must NOT run
    expect(executedCommands).toContain("curl -fsSL https://example.com | bash");
    expect(executedCommands).not.toContain("bash /tmp/test/setup.sh");
  });

  // R-005: setupScript IS executed as fallback when setupCommands is empty
  test("R-005: setupScript IS executed when setupCommands is empty (B1 fallback)", async () => {
    const { ensureManagedRuntimeEnvironment } = await modulePromise;

    await ensureManagedRuntimeEnvironment({
      session: createMockSession(),
      chatId: null,
      userId: "regression-user-1",
      workflowRunId: null,
      sandbox: createMockSandbox() as unknown as Parameters<
        typeof ensureManagedRuntimeEnvironment
      >[0]["sandbox"],
      sandboxName: null,
      profile: makeProfile({
        setupScript: {
          repoPath: "profiles/test/setup.sh",
          sandboxPath: "/tmp/test/setup.sh",
          command: "bash /tmp/test/setup.sh",
          timeoutMs: 60_000,
        },
        setupCommands: [],
      }),
      startupReporter: createMockStartupReporter() as unknown as Parameters<
        typeof ensureManagedRuntimeEnvironment
      >[0]["startupReporter"],
    });

    // If regression: this would NOT be in executedCommands
    expect(executedCommands).toContain("bash /tmp/test/setup.sh");
  });

  // R-006: setupScript failure persists redacted failureMessage, not raw stderr
  test("R-006: setupScript failure failureMessage is the redacted observation summary, not raw output", async () => {
    const { ensureManagedRuntimeEnvironment } = await modulePromise;

    const RAW_SECRET = "sk_live_REGRESSIONSECRET999";

    sandboxCommandResponses.set("bash /tmp/regression/setup.sh", {
      success: false,
      exitCode: 1,
      stdout: "",
      stderr: `error: credential=${RAW_SECRET}`,
    });

    try {
      await ensureManagedRuntimeEnvironment({
        session: createMockSession(),
        chatId: null,
        userId: "regression-user-1",
        workflowRunId: null,
        sandbox: createMockSandbox() as unknown as Parameters<
          typeof ensureManagedRuntimeEnvironment
        >[0]["sandbox"],
        sandboxName: null,
        profile: makeProfile({
          setupScript: {
            repoPath: "profiles/regression/setup.sh",
            sandboxPath: "/tmp/regression/setup.sh",
            command: "bash /tmp/regression/setup.sh",
            timeoutMs: 60_000,
          },
          setupCommands: [],
        }),
        startupReporter: createMockStartupReporter() as unknown as Parameters<
          typeof ensureManagedRuntimeEnvironment
        >[0]["startupReporter"],
      });
    } catch {
      // WorkspaceSetupError expected; we only care about what was persisted
    }

    const [run] = [...profileRunRecords.values()];
    expect(run).toBeDefined();
    // If regression (reverted to raw compactSummary): this would contain the secret
    expect(run.failureMessage).not.toContain(RAW_SECRET);
    // The value must be the redacted sentinel from buildManagedRuntimeCommandObservation
    expect(run.failureMessage).toBe("[mock-redacted:setup-script]");
  });

  // R-007: setupScript failure emits redacted payload.summary in the profile.failed event
  test("R-007: managed_runtime.profile.failed payload.summary is redacted observation summary, not raw output", async () => {
    const { ensureManagedRuntimeEnvironment } = await modulePromise;

    const RAW_SECRET = "tok_REGRESSIONSECRET_PAYLOAD_777";

    sandboxCommandResponses.set("bash /tmp/regression2/setup.sh", {
      success: false,
      exitCode: 1,
      stdout: `token: ${RAW_SECRET}`,
      stderr: "",
    });

    try {
      await ensureManagedRuntimeEnvironment({
        session: createMockSession(),
        chatId: null,
        userId: "regression-user-1",
        workflowRunId: null,
        sandbox: createMockSandbox() as unknown as Parameters<
          typeof ensureManagedRuntimeEnvironment
        >[0]["sandbox"],
        sandboxName: null,
        profile: makeProfile({
          setupScript: {
            repoPath: "profiles/regression2/setup.sh",
            sandboxPath: "/tmp/regression2/setup.sh",
            command: "bash /tmp/regression2/setup.sh",
            timeoutMs: 60_000,
          },
          setupCommands: [],
        }),
        startupReporter: createMockStartupReporter() as unknown as Parameters<
          typeof ensureManagedRuntimeEnvironment
        >[0]["startupReporter"],
      });
    } catch {
      // WorkspaceSetupError expected; we only care about what was emitted
    }

    const failedEvent = emittedEvents.find(
      (e) => e["eventName"] === "managed_runtime.profile.failed",
    );
    expect(failedEvent).toBeDefined();
    const payload = failedEvent?.["payload"] as Record<string, unknown>;
    // If regression (reverted to raw compactSummary): this would contain the secret
    expect(String(payload["summary"] ?? "")).not.toContain(RAW_SECRET);
    // Must be the redacted sentinel from buildManagedRuntimeCommandObservation
    expect(String(payload["summary"] ?? "")).toBe(
      "[mock-redacted:setup-script]",
    );
  });
});
