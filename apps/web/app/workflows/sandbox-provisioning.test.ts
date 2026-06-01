import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type FakeSession = {
  id: string;
  status: "running" | "archived";
  sandboxProvisioningRunId: string | null;
};

let sessionRecord: FakeSession | null = null;
let provisionShouldThrow: Error | null = null;
const provisionCalls: string[] = [];
const failedUpdates: Array<{ sessionId: string; lifecycleError: string }> = [];

let runMetadataId = "run-default";

mock.module("workflow", () => ({
  getWorkflowMetadata: () => ({ workflowRunId: runMetadataId }),
}));

// Atomic first-claim-wins semantics, mirroring the DB conditional update.
const sessionsModule = {
  getSessionById: async () =>
    sessionRecord ? { ...sessionRecord } : null,
  claimSessionSandboxProvisioningRunId: async (
    sessionId: string,
    runId: string,
  ) => {
    if (
      !sessionRecord ||
      sessionRecord.id !== sessionId ||
      sessionRecord.sandboxProvisioningRunId !== null
    ) {
      return false;
    }
    sessionRecord = { ...sessionRecord, sandboxProvisioningRunId: runId };
    return true;
  },
  clearSessionSandboxProvisioningRunIdIfOwned: async (
    sessionId: string,
    runId: string,
  ) => {
    if (
      sessionRecord &&
      sessionRecord.id === sessionId &&
      sessionRecord.sandboxProvisioningRunId === runId
    ) {
      sessionRecord = { ...sessionRecord, sandboxProvisioningRunId: null };
      return true;
    }
    return false;
  },
  updateSession: async (
    sessionId: string,
    patch: Record<string, unknown>,
  ) => {
    if (patch.lifecycleState === "failed") {
      failedUpdates.push({
        sessionId,
        lifecycleError: String(patch.lifecycleError),
      });
    }
    return null;
  },
};

mock.module("@/lib/db/sessions", () => sessionsModule);

class FakeArchivedError extends Error {
  constructor(sessionId: string) {
    super(`Session ${sessionId} was archived`);
    this.name = "SessionArchivedDuringProvisioningError";
  }
}

mock.module("@/lib/sandbox/provisioning", () => ({
  SessionArchivedDuringProvisioningError: FakeArchivedError,
  provisionSessionSandbox: async ({ sessionId }: { sessionId: string }) => {
    provisionCalls.push(sessionId);
    if (provisionShouldThrow) {
      throw provisionShouldThrow;
    }
    return { sandboxState: { type: "vercel", sandboxId: "sbx-1" } };
  },
}));

const modulePromise = import("./sandbox-provisioning");

describe("sandboxProvisioningWorkflow", () => {
  beforeEach(() => {
    sessionRecord = {
      id: "session-1",
      status: "running",
      sandboxProvisioningRunId: null,
    };
    provisionShouldThrow = null;
    provisionCalls.length = 0;
    failedUpdates.length = 0;
    runMetadataId = "run-default";
  });

  test("first-claim-wins: only one of two racing runs provisions", async () => {
    const { sandboxProvisioningWorkflow } = await modulePromise;

    runMetadataId = "run-A";
    const first = sandboxProvisioningWorkflow("session-1");
    runMetadataId = "run-B";
    const second = sandboxProvisioningWorkflow("session-1");

    const [a, b] = await Promise.all([first, second]);

    // Exactly one run provisions; the duplicate is skipped as run-replaced.
    expect(provisionCalls).toEqual(["session-1"]);
    const results = [a, b];
    const skipped = results.filter((r) => r.skipped);
    const provisioned = results.filter((r) => !r.skipped);
    expect(provisioned).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ reason: "run-replaced" });
  });

  test("records lifecycle failure and re-throws on provisioning error", async () => {
    const { sandboxProvisioningWorkflow } = await modulePromise;

    runMetadataId = "run-A";
    provisionShouldThrow = new Error("boom");

    await expect(sandboxProvisioningWorkflow("session-1")).rejects.toThrow(
      "boom",
    );
    expect(failedUpdates).toEqual([
      { sessionId: "session-1", lifecycleError: "boom" },
    ]);
    // The lease is released after failure.
    expect(sessionRecord?.sandboxProvisioningRunId).toBeNull();
  });

  test("skips when the session no longer exists", async () => {
    const { sandboxProvisioningWorkflow } = await modulePromise;

    runMetadataId = "run-A";
    sessionRecord = null;

    const result = await sandboxProvisioningWorkflow("session-1");
    expect(result).toMatchObject({ skipped: true, reason: "session-not-found" });
    expect(provisionCalls).toHaveLength(0);
  });
});
