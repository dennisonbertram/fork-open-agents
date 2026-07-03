import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  ManagedRuntimeCommandObservationJson,
  ManagedRuntimeProfileRunJson,
  ManagedRuntimeWorkerJson,
  SessionEventJson,
  WorkflowRunJson,
} from "./hooks/use-session-observability";
import {
  getManagedRuntimeToolReason,
  getProfileRunRollupLabel,
  ProfileRunSection,
  RuntimeActorsSection,
} from "./runtime-observability-panel";

function workflowRun(
  overrides: Partial<WorkflowRunJson> = {},
): WorkflowRunJson {
  return {
    id: "wrun_123",
    chatId: "chat_123",
    sessionId: "session_123",
    userId: "user_123",
    modelId: "test-model",
    requestId: "request_123",
    runtimeMode: "managed_runtime",
    sandboxName: "sbx_runtime_123",
    managedRuntimeProfileId: "web-bun-agent-browser",
    managedRuntimeProfileVersion: "2026-05-23.2",
    managedRuntimeProfileRunId: "mprun_123",
    errorMessage: null,
    status: "running",
    startedAt: "2026-05-26T20:00:00.000Z",
    finishedAt: "2026-05-26T20:00:00.000Z",
    totalDurationMs: 0,
    createdAt: "2026-05-26T20:00:00.000Z",
    ...overrides,
  };
}

function profileRun(
  overrides: Partial<ManagedRuntimeProfileRunJson> = {},
): ManagedRuntimeProfileRunJson {
  return {
    id: "mprun_123",
    sessionId: "session_123",
    chatId: "chat_123",
    userId: "user_123",
    workflowRunId: "wrun_123",
    sandboxName: "sbx_runtime_123",
    profileId: "web-bun-agent-browser",
    profileVersion: "2026-05-23.2",
    profileDisplayName: "Web app with Bun and browser checks",
    requestedProfileId: "web-bun-agent-browser",
    resolvedProfileId: "web-bun-agent-browser",
    status: "running",
    errorKind: null,
    nextAction: null,
    expectedTools: ["bun", "agent-browser"],
    optionalTools: ["node", "npm"],
    setupResults: [],
    verificationResults: [],
    summary: null,
    failureMessage: null,
    startedAt: "2026-05-26T20:00:00.000Z",
    finishedAt: null,
    createdAt: "2026-05-26T20:00:00.000Z",
    updatedAt: "2026-05-26T20:00:00.000Z",
    ...overrides,
  };
}

function workerEvent(
  overrides: Partial<SessionEventJson> = {},
): SessionEventJson {
  return {
    id: "event_123",
    sessionId: "session_123",
    chatId: "chat_123",
    userId: "user_123",
    source: "managed_runtime",
    actorType: "worker",
    actorId: "worker_executor_1",
    eventName: "managed_runtime.worker.tool.started",
    status: "running",
    summary: "Managed worker running Bash bun --bun run ci.",
    requestId: "request_123",
    workflowRunId: "wrun_123",
    harnessRunId: null,
    sandboxName: "sbx_runtime_123",
    managedRuntimeProfileRunId: "mprun_123",
    serviceId: null,
    browserRunId: null,
    payload: {
      workerType: "executor",
      profileId: "web-bun-agent-browser",
      profileVersion: "2026-05-23.2",
      currentTool: {
        name: "bash",
        safeSummary: "bun --bun run ci",
      },
    },
    redactionStatus: "passed",
    createdAt: "2026-05-26T20:00:00.000Z",
    ...overrides,
  };
}

function workerSnapshot(
  overrides: Partial<ManagedRuntimeWorkerJson> = {},
): ManagedRuntimeWorkerJson {
  return {
    id: "task-1",
    source: "message",
    taskToolCallId: "task-1",
    workerType: "executor",
    status: "running",
    sandboxName: "sbx_runtime_123",
    profileId: "web-bun-agent-browser",
    profileVersion: "2026-05-23.2",
    profileDisplayName: "Web app with Bun and browser checks",
    profileRunId: "mprun_123",
    currentToolName: "Bash",
    currentToolSummary: "bun --bun run ci",
    toolCallCount: 2,
    summary: "Implement a small UI change",
    updatedAt: "2026-05-26T20:00:00.000Z",
    ...overrides,
  };
}

describe("RuntimeActorsSection", () => {
  test("shows a neutral no-work state when no worker ran and no tools were used", () => {
    const html = renderToStaticMarkup(
      <RuntimeActorsSection
        events={[]}
        latestProfileRun={profileRun()}
        latestWorkflow={workflowRun()}
        runtimeMode="managed_runtime"
        workers={[]}
      />,
    );

    expect(html).toContain("Coordinator");
    expect(html).toContain("Managed runtime");
    // Conversational turn — nothing to prove, so not flagged as incomplete.
    expect(html).toContain("No runtime work this turn");
    expect(html).not.toContain("Proof incomplete");
  });

  test("flags proof incomplete when the coordinator used repo tools directly without a worker", () => {
    const html = renderToStaticMarkup(
      <RuntimeActorsSection
        directToolUse={{
          observed: true,
          count: 1,
          toolTypes: ["tool-bash"],
          toolLabels: ["Bash"],
          warning: "Coordinator direct repo tool use observed: Bash.",
        }}
        events={[]}
        latestProfileRun={profileRun()}
        latestWorkflow={workflowRun()}
        runtimeMode="managed_runtime"
        workers={[]}
      />,
    );

    expect(html).toContain("No managed worker has executed yet");
    expect(html).toContain("Proof incomplete");
  });

  test("renders worker event attribution with sandbox and profile metadata", () => {
    const html = renderToStaticMarkup(
      <RuntimeActorsSection
        events={[workerEvent()]}
        latestProfileRun={profileRun()}
        latestWorkflow={workflowRun()}
        runtimeMode="managed_runtime"
        workers={[]}
      />,
    );

    expect(html).toContain("Managed worker");
    expect(html).toContain("Executor");
    expect(html).toContain("sbx_runtime_123");
    expect(html).toContain("web-bun-agent-browser@2026-05-23.2");
    expect(html).toContain("Bash");
    expect(html).toContain("bun --bun run ci");
  });

  test("renders worker snapshots derived from persisted task message parts", () => {
    const html = renderToStaticMarkup(
      <RuntimeActorsSection
        events={[]}
        latestProfileRun={profileRun()}
        latestWorkflow={workflowRun()}
        runtimeMode="managed_runtime"
        workers={[workerSnapshot()]}
      />,
    );

    expect(html).toContain("Managed worker");
    expect(html).toContain("Executor");
    expect(html).toContain("sbx_runtime_123");
    expect(html).toContain("web-bun-agent-browser@2026-05-23.2");
    expect(html).toContain("Bash");
    expect(html).toContain("bun --bun run ci");
  });

  test("warns when coordinator direct repo tools were observed in managed mode", () => {
    const html = renderToStaticMarkup(
      <RuntimeActorsSection
        directToolUse={{
          observed: true,
          count: 2,
          toolTypes: ["tool-bash", "tool-edit"],
          toolLabels: ["Bash", "Edit"],
          warning:
            "Coordinator direct repo tool use observed: Bash, Edit. These actions did not run through a managed worker.",
        }}
        events={[]}
        latestProfileRun={profileRun()}
        latestWorkflow={workflowRun()}
        runtimeMode="managed_runtime"
        workers={[]}
      />,
    );

    expect(html).toContain("Coordinator direct tool use");
    expect(html).toContain("Bash, Edit");
    expect(html).toContain("did not run through a managed worker");
  });
});

describe("getManagedRuntimeToolReason", () => {
  test("explains why agent-browser is installed by managed profiles", () => {
    expect(getManagedRuntimeToolReason("agent-browser")).toContain(
      "Browser QA tool",
    );
    expect(getManagedRuntimeToolReason("agent-browser")).toContain(
      "console or network errors",
    );
  });
});

function command(
  overrides: Partial<ManagedRuntimeCommandObservationJson> = {},
): ManagedRuntimeCommandObservationJson {
  return {
    commandId: "setup-1",
    label: "Install dependencies",
    status: "passed",
    required: true,
    exitCode: 0,
    durationMs: 1200,
    summary: "Installed 42 packages.",
    startedAt: "2026-05-26T20:00:00.000Z",
    finishedAt: "2026-05-26T20:00:01.200Z",
    ...overrides,
  };
}

describe("getProfileRunRollupLabel", () => {
  test("reports setup and verification pass/fail counts as 'Setup: 3/3 passed · Verification: 1/2 failed'", () => {
    const label = getProfileRunRollupLabel({
      setupResults: [
        command({ commandId: "s1", status: "passed" }),
        command({ commandId: "s2", status: "passed" }),
        command({ commandId: "s3", status: "passed" }),
      ],
      verificationResults: [
        command({ commandId: "v1", status: "passed" }),
        command({ commandId: "v2", status: "failed" }),
      ],
    });

    expect(label).toBe("Setup: 3/3 passed · Verification: 1/2 failed");
  });

  test("returns null when there are no command results yet", () => {
    const label = getProfileRunRollupLabel({
      setupResults: [],
      verificationResults: [],
    });

    expect(label).toBeNull();
  });

  test("omits a section with zero commands rather than showing 0/0", () => {
    const label = getProfileRunRollupLabel({
      setupResults: [command({ commandId: "s1", status: "passed" })],
      verificationResults: [],
    });

    expect(label).toBe("Setup: 1/1 passed");
    expect(label).not.toContain("Verification");
  });
});

describe("ProfileRunSection — mode row", () => {
  test("renders a loading state instead of Classic while observability data is loading", () => {
    const html = renderToStaticMarkup(
      <ProfileRunSection
        isLoading={true}
        latestProfileRun={null}
        latestWorkflow={null}
        runtimeMode={undefined}
      />,
    );

    expect(html).not.toContain("Classic");
    expect(html.toLowerCase()).toContain("loading");
  });

  test("renders Classic only when loaded data explicitly says runtimeMode is classic", () => {
    const html = renderToStaticMarkup(
      <ProfileRunSection
        isLoading={false}
        latestProfileRun={null}
        latestWorkflow={null}
        runtimeMode="classic"
      />,
    );

    expect(html).toContain("Classic");
  });

  test("renders managed-but-no-run-yet state distinctly from evidence-unavailable", () => {
    const html = renderToStaticMarkup(
      <ProfileRunSection
        isLoading={false}
        latestProfileRun={null}
        latestWorkflow={null}
        runtimeMode="managed_runtime"
      />,
    );

    expect(html).toContain("Managed runtime");
    expect(html).not.toContain("Evidence unavailable");
    expect(html).toContain("has not run");
  });

  test("renders evidence-unavailable when managed mode has workflow activity but no ProfileRun row", () => {
    const html = renderToStaticMarkup(
      <ProfileRunSection
        isLoading={false}
        latestProfileRun={null}
        latestWorkflow={workflowRun({ status: "completed" })}
        runtimeMode="managed_runtime"
      />,
    );

    expect(html).toContain("Evidence unavailable");
  });

  test("renders the failed state with the typed next-action copy", () => {
    const html = renderToStaticMarkup(
      <ProfileRunSection
        isLoading={false}
        latestProfileRun={profileRun({
          status: "failed",
          errorKind: "setup_command_failed",
          nextAction:
            "Fix the failing setup command in the profile editor, then run setup again.",
        })}
        latestWorkflow={workflowRun()}
        runtimeMode="managed_runtime"
      />,
    );

    expect(html).toContain("failed");
    expect(html).toContain(
      "Fix the failing setup command in the profile editor, then run setup again.",
    );
  });

  test("renders the passed state", () => {
    const html = renderToStaticMarkup(
      <ProfileRunSection
        isLoading={false}
        latestProfileRun={profileRun({ status: "passed" })}
        latestWorkflow={workflowRun()}
        runtimeMode="managed_runtime"
      />,
    );

    expect(html).toContain("passed");
  });

  test("renders a rollup header above the per-command rows", () => {
    const html = renderToStaticMarkup(
      <ProfileRunSection
        isLoading={false}
        latestProfileRun={profileRun({
          status: "passed",
          setupResults: [
            command({ commandId: "s1", status: "passed" }),
            command({ commandId: "s2", status: "passed" }),
          ],
          verificationResults: [
            command({ commandId: "v1", status: "passed" }),
          ],
        })}
        latestWorkflow={workflowRun()}
        runtimeMode="managed_runtime"
      />,
    );

    expect(html).toContain("Setup: 2/2 passed · Verification: 1/1 passed");
  });

  test("renders an explicit requested-vs-resolved mismatch warning naming both ids", () => {
    const html = renderToStaticMarkup(
      <ProfileRunSection
        isLoading={false}
        latestProfileRun={profileRun({
          status: "passed",
          requestedProfileId: "custom-profile-a",
          resolvedProfileId: "web-bun-agent-browser",
        })}
        latestWorkflow={workflowRun()}
        runtimeMode="managed_runtime"
      />,
    );

    expect(html).toContain("custom-profile-a");
    expect(html).toContain("web-bun-agent-browser");
  });
});

// ── Regression ──────────────────────────────────────────────────────────────
describe("ProfileRunSection regression", () => {
  // Pins the concern raised in issue #815 §14: loading state must take
  // priority over evidence-unavailable so the badge/panel never flickers
  // "Evidence unavailable" during a normal load.
  test("loading takes priority over evidence-unavailable even with a completed workflow and no run", () => {
    const html = renderToStaticMarkup(
      <ProfileRunSection
        isLoading={true}
        latestProfileRun={null}
        latestWorkflow={workflowRun({ status: "completed" })}
        runtimeMode="managed_runtime"
      />,
    );

    expect(html).not.toContain("Evidence unavailable");
  });
});
