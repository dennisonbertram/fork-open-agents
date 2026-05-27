import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { BackgroundAgentWithTriggers } from "./store";

mock.module("server-only", () => ({}));

let workflowRunId: string | null = "workflow-1";
const start = mock(async () => ({ runId: workflowRunId }));
const createRunForTrigger = mock(async ({ event }: { event: unknown }) => ({
  created: true,
  run: { id: "run-1" },
  event,
}));
const recordBackgroundAgentEvent = mock(async () => undefined);

mock.module("workflow/api", () => ({ start }));

mock.module("@/app/workflows/background-agent", () => ({
  runBackgroundAgentWorkflow: {},
}));

mock.module("./store", () => ({
  createRunForTrigger,
  getOwnedBackgroundAgentWithTriggers: async () => null,
  getWebhookTriggerByPublicId: async () => null,
  listEnabledScheduleTriggers: async () => [],
  listMatchingTriggersForEvent: async () => [],
  recordBackgroundAgentEvent,
}));

const dispatcherModulePromise = import("./dispatcher");

const agent: BackgroundAgentWithTriggers = {
  id: "agent-1",
  userId: "user-1",
  name: "Manual test agent",
  repoOwner: "acme",
  repoName: "widgets",
  triggers: [
    {
      id: "trigger-disabled",
      agentId: "agent-1",
      userId: "user-1",
      name: "Disabled",
      kind: "github.issue",
      status: "disabled",
      conditions: {},
      schedule: null,
      webhookPublicId: null,
      webhookSecretHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: "trigger-enabled",
      agentId: "agent-1",
      userId: "user-1",
      name: "Pull request",
      kind: "github.pull_request",
      status: "enabled",
      conditions: {},
      schedule: null,
      webhookPublicId: null,
      webhookSecretHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
  description: null,
  status: "enabled",
  instructions: "Run the smoke check.",
  permissions: {},
  outputMode: "none",
  checkCommand: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("dispatchManualBackgroundAgentTest", () => {
  beforeEach(() => {
    process.env.BACKGROUND_AGENTS_ENABLED = "true";
    workflowRunId = "workflow-1";
    start.mockClear();
    createRunForTrigger.mockClear();
    recordBackgroundAgentEvent.mockClear();
  });

  test("creates a manual test event without forcing a non-existent sandbox branch", async () => {
    const { dispatchManualBackgroundAgentTest } = await dispatcherModulePromise;

    const result = await dispatchManualBackgroundAgentTest({
      agent,
      requestId: "req-1",
    });

    expect(result).toEqual({
      enabled: true,
      matched: 1,
      created: 1,
      duplicates: 0,
      runIds: ["run-1"],
    });
    expect(createRunForTrigger).toHaveBeenCalledTimes(1);
    const createCall = createRunForTrigger.mock.calls[0]?.[0] as {
      trigger: { id: string };
      event: {
        action?: string;
        branch?: string;
        ref?: string;
        kind: string;
        source: string;
        title?: string;
      };
    };
    expect(createCall.trigger.id).toBe("trigger-enabled");
    expect(createCall.event.kind).toBe("github.pull_request");
    expect(createCall.event.source).toBe("github");
    expect(createCall.event.action).toBe("manual_test");
    expect(createCall.event.branch).toBeUndefined();
    expect(createCall.event.ref).toBeUndefined();
    expect(createCall.event.title).toBe("Manual test for Manual test agent");
    expect(start).toHaveBeenCalledWith({}, [{ runId: "run-1" }]);
  });

  test("does not create a manual test run when rollout is disabled", async () => {
    process.env.BACKGROUND_AGENTS_ENABLED = "false";
    const { dispatchManualBackgroundAgentTest } = await dispatcherModulePromise;

    const result = await dispatchManualBackgroundAgentTest({
      agent,
      requestId: "req-1",
    });

    expect(result).toEqual({
      enabled: false,
      matched: 0,
      created: 0,
      duplicates: 0,
      runIds: [],
    });
    expect(createRunForTrigger).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });
});
