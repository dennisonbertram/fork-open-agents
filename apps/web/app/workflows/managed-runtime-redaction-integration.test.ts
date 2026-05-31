/**
 * BT-REDACT-001 through BT-REDACT-005: Real-redaction integration tests
 *
 * These tests exercise the actual secret-redaction path WITHOUT mocking
 * buildManagedRuntimeCommandObservation so that the real
 * redactHarnessValue / redactSandboxLog logic is exercised.
 *
 * BT-REDACT-001: Required setupCommand failure with secret-bearing stderr —
 *   the thrown WorkspaceSetupError message must not contain the raw secret.
 *
 * BT-REDACT-002: Required setupCommand failure — the DB-level failureMessage
 *   must be redacted (observation.summary from real buildManagedRuntimeCommandObservation).
 *
 * BT-REDACT-003: Required setupCommand failure — the emitted
 *   managed_runtime.profile.failed event payload must not contain the raw secret.
 *
 * BT-REDACT-004: Reporter appendCommandResult log lines must not contain
 *   bare sk- or ghp_ tokens (gaps in workspace-startup-log SECRET_PATTERNS).
 *
 * BT-REDACT-005: appendWorkspaceStartupLogLines must redact bare ghp_/sk- shapes
 *   (reporter sink uses the same redactWorkspaceLogLine path).
 */

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ManagedRuntimeProfile } from "@open-agents/sandbox/managed-runtime-profiles";

// ── Infrastructure stubs ─────────────────────────────────────────────────────

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

// ── DB-level capture for profile run writes ──────────────────────────────────
// We do NOT mock buildManagedRuntimeCommandObservation — we use the real one.
// The real implementation is imported below via a top-level await import,
// then forwarded in the mock.module below.

type ProfileRunRecord = {
  id: string;
  status: string;
  setupResults: unknown[];
  verificationResults: unknown[];
  failureMessage: string | null;
  summary: string | null;
};
const profileRunRecords = new Map<string, ProfileRunRecord>();
let profileRunIdCounter = 0;

// Import the real observation builder BEFORE we set up the mock.
// Since managed-runtime-profile-runs.ts imports "server-only" (which we've already
// mocked above) and "@/lib/db/client" (which we mock here separately), this import works.
mock.module("@/lib/db/client", () => ({
  db: {
    insert: () => ({ values: () => ({ returning: async () => [] }) }),
    update: () => ({
      set: () => ({ where: () => ({ returning: async () => [] }) }),
    }),
    query: { managedRuntimeProfileRuns: { findFirst: async () => null } },
  },
}));

// Use a dynamic import that resolves at test-collection time
const realObservationModule = await import(
  "@/lib/observability/managed-runtime-profile-runs"
);
const realBuildObservation =
  realObservationModule.buildManagedRuntimeCommandObservation;

mock.module("@/lib/observability/managed-runtime-profile-runs", () => ({
  // Forward REAL observation builder so redactHarnessValue/redactSandboxLog is exercised
  buildManagedRuntimeCommandObservation: realBuildObservation,
  startManagedRuntimeProfileRun: async (params: {
    profile: { id: string };
  }) => {
    const id = `run-real-${++profileRunIdCounter}`;
    const record: ProfileRunRecord = {
      id,
      status: "running",
      setupResults: [],
      verificationResults: [],
      failureMessage: null,
      summary: null,
    };
    profileRunRecords.set(id, record);
    return record;
  },
  appendManagedRuntimeSetupResult: async (params: {
    profileRunId: string;
    observation: unknown;
  }) => {
    const record = profileRunRecords.get(params.profileRunId);
    if (record) record.setupResults.push(params.observation);
    return record ?? { id: params.profileRunId };
  },
  appendManagedRuntimeVerificationResult: async (params: {
    profileRunId: string;
    observation: unknown;
  }) => {
    const record = profileRunRecords.get(params.profileRunId);
    if (record) record.verificationResults.push(params.observation);
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

// ── Sandbox stub ─────────────────────────────────────────────────────────────

type CommandResponse = {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
};
const sandboxCommandResponses = new Map<string, CommandResponse>();
const capturedLogLines: string[] = [];

function createMockSandbox() {
  return {
    workingDirectory: "/vercel/sandbox",
    async exec(command: string): Promise<CommandResponse> {
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

function createCapturingReporter() {
  return {
    async send(_message: string, _lines?: string[]) {},
    async appendCommandResult(params: {
      message: string;
      command: string;
      exitCode: number | null;
      stdout: string;
      stderr: string;
    }) {
      // Exercises the REAL workspace-startup-log redaction path end-to-end
      const { getCommandOutputLogLines, appendWorkspaceStartupLogLines } =
        await import("./workspace-startup-log");
      const lines = getCommandOutputLogLines({
        command: params.command,
        exitCode: params.exitCode,
        stdout: params.stdout,
        stderr: params.stderr,
      });
      const normalized = appendWorkspaceStartupLogLines([], lines);
      capturedLogLines.push(...normalized);
    },
  };
}

function createMockSession() {
  return { id: "integration-session-1", userId: "integration-user-1" };
}

function makeProfile(
  overrides: Partial<ManagedRuntimeProfile> = {},
): ManagedRuntimeProfile {
  return {
    id: "integration-test-profile",
    version: "1.0.0",
    displayName: "Integration Test Profile",
    description: "Real-redaction integration test profile",
    setupCommands: [],
    verificationCommands: [],
    expectedTools: [],
    optionalTools: [],
    defaultPorts: [3000],
    ...overrides,
  };
}

const modulePromise = import("./managed-runtime-environment");

afterAll(() => {
  mock.restore();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("real-redaction integration — secrets must not leak", () => {
  beforeEach(() => {
    emittedEvents.length = 0;
    profileRunRecords.clear();
    sandboxCommandResponses.clear();
    capturedLogLines.length = 0;
    profileRunIdCounter = 0;
  });

  // BT-REDACT-001: WorkspaceSetupError message must not contain raw secret
  test("BT-REDACT-001: thrown WorkspaceSetupError message does not contain raw secret from setup command stderr", async () => {
    const { ensureManagedRuntimeEnvironment } = await modulePromise;
    const RAW_SECRET = "ghp_AAAA1234567890abcdefghijklmnopqr";

    sandboxCommandResponses.set("npm install --production", {
      success: false,
      exitCode: 1,
      stdout: "",
      stderr: `fatal: token=${RAW_SECRET} is invalid`,
    });

    let thrownError: Error | undefined;
    try {
      await ensureManagedRuntimeEnvironment({
        session: createMockSession(),
        chatId: null,
        userId: "integration-user-1",
        workflowRunId: null,
        sandbox: createMockSandbox() as unknown as Parameters<
          typeof ensureManagedRuntimeEnvironment
        >[0]["sandbox"],
        sandboxName: null,
        profile: makeProfile({
          setupCommands: [
            {
              id: "install-deps",
              label: "Install dependencies",
              description: "Install project dependencies",
              command: "npm install --production",
              required: true,
            },
          ],
        }),
        startupReporter:
          createCapturingReporter() as unknown as Parameters<
            typeof ensureManagedRuntimeEnvironment
          >[0]["startupReporter"],
      });
    } catch (err) {
      if (err instanceof Error) thrownError = err;
    }

    expect(thrownError).toBeDefined();
    expect(thrownError?.name).toBe("WorkspaceSetupError");
    // The raw token must NOT appear in the thrown error message
    expect(thrownError?.message).not.toContain(RAW_SECRET);
  });

  // BT-REDACT-002: DB failureMessage must not contain raw secret
  test("BT-REDACT-002: DB failureMessage for required setupCommand failure does not contain raw secret from stderr", async () => {
    const { ensureManagedRuntimeEnvironment } = await modulePromise;
    const RAW_SECRET = "sk-BBBB1234567890abcdefghijklmnopqr";

    sandboxCommandResponses.set("bun install", {
      success: false,
      exitCode: 1,
      stdout: `API_TOKEN=${RAW_SECRET}`,
      stderr: "authentication failed",
    });

    try {
      await ensureManagedRuntimeEnvironment({
        session: createMockSession(),
        chatId: null,
        userId: "integration-user-1",
        workflowRunId: null,
        sandbox: createMockSandbox() as unknown as Parameters<
          typeof ensureManagedRuntimeEnvironment
        >[0]["sandbox"],
        sandboxName: null,
        profile: makeProfile({
          setupCommands: [
            {
              id: "install",
              label: "Install",
              description: "Install step",
              command: "bun install",
              required: true,
            },
          ],
        }),
        startupReporter:
          createCapturingReporter() as unknown as Parameters<
            typeof ensureManagedRuntimeEnvironment
          >[0]["startupReporter"],
      });
    } catch {
      // WorkspaceSetupError expected
    }

    const [run] = [...profileRunRecords.values()];
    expect(run).toBeDefined();
    // failureMessage is set from observation.summary (real redactHarnessValue path)
    expect(run.failureMessage).not.toContain(RAW_SECRET);
  });

  // BT-REDACT-003: emitted event payload must not contain raw secret
  test("BT-REDACT-003: managed_runtime.profile.failed event payload does not contain raw secret", async () => {
    const { ensureManagedRuntimeEnvironment } = await modulePromise;
    const RAW_SECRET = "sk-CCCC1234567890abcdefghijklmnopqr";

    sandboxCommandResponses.set("pnpm install", {
      success: false,
      exitCode: 1,
      stdout: "",
      stderr: `API_KEY=${RAW_SECRET} not authorized`,
    });

    try {
      await ensureManagedRuntimeEnvironment({
        session: createMockSession(),
        chatId: null,
        userId: "integration-user-1",
        workflowRunId: null,
        sandbox: createMockSandbox() as unknown as Parameters<
          typeof ensureManagedRuntimeEnvironment
        >[0]["sandbox"],
        sandboxName: null,
        profile: makeProfile({
          setupCommands: [
            {
              id: "pnpm-install",
              label: "Install",
              description: "Install with pnpm",
              command: "pnpm install",
              required: true,
            },
          ],
        }),
        startupReporter:
          createCapturingReporter() as unknown as Parameters<
            typeof ensureManagedRuntimeEnvironment
          >[0]["startupReporter"],
      });
    } catch {
      // WorkspaceSetupError expected
    }

    const failedEvent = emittedEvents.find(
      (e) => e["eventName"] === "managed_runtime.profile.failed",
    );
    expect(failedEvent).toBeDefined();
    const payloadStr = JSON.stringify(failedEvent?.["payload"] ?? "");
    expect(payloadStr).not.toContain(RAW_SECRET);
  });

  // BT-REDACT-004: Reporter log lines must not contain bare ghp_/sk- tokens
  test("BT-REDACT-004: reporter appendCommandResult log lines do not contain bare ghp_ or sk- token shapes", async () => {
    const GHP_TOKEN = "ghp_DDDD1234567890abcdefghijklmnopqr";
    const SK_TOKEN = "sk-EEEE1234567890abcdefghijklmnopqr";

    const reporter = createCapturingReporter();
    await reporter.appendCommandResult({
      message: "Setup failed",
      command: "npm install",
      exitCode: 1,
      stdout: `using token: ${GHP_TOKEN}`,
      stderr: `OPENAI_KEY=${SK_TOKEN} auth failed`,
    });

    const allLogLines = capturedLogLines.join("\n");
    expect(allLogLines).not.toContain(GHP_TOKEN);
    expect(allLogLines).not.toContain(SK_TOKEN);
  });

  // BT-REDACT-005: workspace-startup-log normalizeLogLine must redact bare ghp_/sk- tokens
  test("BT-REDACT-005: appendWorkspaceStartupLogLines redacts bare ghp_ and sk- token shapes", async () => {
    const { appendWorkspaceStartupLogLines } = await import(
      "./workspace-startup-log"
    );

    const GHP_TOKEN = "ghp_FFFF1234567890abcdefghijklmnopqr";
    const SK_TOKEN = "sk-GGGG1234567890abcdefghijklmnopqr";

    const lines = appendWorkspaceStartupLogLines([], [
      `fetching with token ${GHP_TOKEN}`,
      `api call ${SK_TOKEN} failed`,
    ]);

    const joined = lines.join("\n");
    expect(joined).not.toContain(GHP_TOKEN);
    expect(joined).not.toContain(SK_TOKEN);
  });
});
