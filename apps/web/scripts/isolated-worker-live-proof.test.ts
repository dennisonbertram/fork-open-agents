import { describe, expect, test } from "bun:test";
import {
  formatIsolatedWorkerLiveProof,
  runIsolatedWorkerLiveProof,
  type IsolatedWorkerLiveProofEvidence,
} from "./isolated-worker-live-proof";

const baseEvidence: IsolatedWorkerLiveProofEvidence = {
  proofId: "proof-1",
  createdAt: "2026-06-21T22:45:00.000Z",
  backendKind: "vercel-sandbox",
  correlationId: "corr-1",
  parent: {
    workspaceId: "parent-workspace",
    workspacePath: "/private/tmp/open-agents-parent",
    sourceRef: "develop",
    sourceCommit: "abc123",
    markerPresentBeforeIntegration: false,
  },
  child: {
    workerId: "worker-1",
    workspaceId: "child-workspace",
    workspacePath: "/private/tmp/open-agents-child",
    sourceRef: "develop",
    sourceCommit: "abc123",
    markerPath: ".open-agents/proof/marker.txt",
    markerWriteSucceeded: true,
    toolExecutionSucceeded: true,
  },
  persistence: {
    runId: "run-1",
    terminalStatus: "completed",
    lifecycleStates: ["launching", "running", "completed"],
    evidenceRefs: [
      "tool-task.output.isolatedWorkspace",
      "tool-task.output.delegatedWorkerLifecycleEvents",
    ],
  },
  cleanup: {
    status: "completed",
    detail: "Child workspace was removed after marker checks.",
  },
  limitations: [],
};

describe("isolated-worker-live-proof", () => {
  test("fails evidence when parent and child workspace ids match", async () => {
    const result = await runIsolatedWorkerLiveProof(
      {
        live: false,
        format: "json",
        evidenceJson: JSON.stringify({
          ...baseEvidence,
          child: {
            ...baseEvidence.child,
            workspaceId: baseEvidence.parent.workspaceId,
          },
        }),
      },
      {
        uuid: () => "ignored",
        now: () => new Date("2026-06-21T22:45:00.000Z"),
      },
    );

    expect(result.status).toBe("failed");
    expect(
      result.checks.find((check) => check.id === "workspace_separation"),
    ).toEqual(
      expect.objectContaining({
        status: "failed",
        detail: "Parent and child workspace identities match.",
      }),
    );
  });

  test("reports missing live prerequisites as blocked, not passed", async () => {
    const result = await runIsolatedWorkerLiveProof(
      {
        live: true,
        format: "json",
      },
      {
        env: {},
        uuid: () => "proof-blocked",
        now: () => new Date("2026-06-21T22:45:00.000Z"),
      },
    );

    expect(result.status).toBe("blocked");
    expect(result.checks).toEqual([
      expect.objectContaining({
        id: "live_prerequisites",
        status: "blocked",
        evidence: expect.arrayContaining([
          "missing=ISOLATED_WORKER_LIVE_PROOF_ENABLED=1",
          "missing=real isolated workspace provisioner",
          "missing=live sandbox execution hook",
        ]),
      }),
    ]);
  });

  test("passes complete redacted evidence and formats it for PR comments", async () => {
    const result = await runIsolatedWorkerLiveProof({
      live: false,
      format: "json",
      evidenceJson: JSON.stringify(baseEvidence),
    });

    expect(result.status).toBe("passed");
    expect(result.checks.map((check) => [check.id, check.status])).toEqual([
      ["workspace_separation", "passed"],
      ["source_linkage", "passed"],
      ["marker_isolation", "passed"],
      ["tool_execution", "passed"],
      ["lifecycle_persistence", "passed"],
      ["cleanup", "passed"],
    ]);

    const markdown = formatIsolatedWorkerLiveProof(result);
    expect(markdown).toContain("status: passed");
    expect(markdown).toContain("parentPathName=open-agents-parent");
    expect(markdown).not.toContain("/private/tmp");
  });

  test("blocks incomplete source linkage without hiding successful isolation", async () => {
    const result = await runIsolatedWorkerLiveProof({
      live: false,
      format: "json",
      evidenceJson: JSON.stringify({
        ...baseEvidence,
        child: {
          ...baseEvidence.child,
          sourceCommit: undefined,
        },
      }),
    });

    expect(result.status).toBe("blocked");
    expect(
      result.checks.find((check) => check.id === "workspace_separation"),
    ).toEqual(expect.objectContaining({ status: "passed" }));
    expect(
      result.checks.find((check) => check.id === "source_linkage"),
    ).toEqual(expect.objectContaining({ status: "blocked" }));
  });
});
