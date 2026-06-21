import { describe, expect, test } from "bun:test";
import {
  delegatedWorkspaceResolverDecisionSchema,
  resolveDelegatedWorkspacePolicy,
} from "./delegated-workspace-resolver";

describe("delegated workspace policy resolver", () => {
  test("resolves explicit shared policy to the parent workspace", () => {
    const decision = resolveDelegatedWorkspacePolicy({
      parentRunId: "run-1",
      runtimeMode: "classic",
      requestedPolicy: "shared",
      parentWorkspaceId: "workspace-1",
    });

    expect(delegatedWorkspaceResolverDecisionSchema.parse(decision)).toEqual(
      decision,
    );
    expect(decision).toMatchObject({
      status: "accepted",
      decision: "shared",
      requestedPolicy: "shared",
      effectivePolicy: "shared",
      parentWorkspaceId: "workspace-1",
      requiredCapabilities: ["workspace:use_shared"],
      createdResourceIds: [],
    });
  });

  test("resolves explicit isolated policy to a plan-only provisioning decision", () => {
    const decision = resolveDelegatedWorkspacePolicy({
      parentRunId: "run-1",
      runtimeMode: "managed_runtime",
      requestedPolicy: "isolated",
      parentWorkspaceId: "workspace-1",
      repositoryId: "repo-1",
    });

    expect(decision).toMatchObject({
      status: "accepted",
      decision: "isolated",
      requestedPolicy: "isolated",
      effectivePolicy: "isolated",
      requiredCapabilities: ["workspace:create_isolated"],
      provisioningPlan: {
        planOnly: true,
        kind: "isolated_worker_workspace",
        parentWorkspaceId: "workspace-1",
        repositoryId: "repo-1",
      },
      createdResourceIds: [],
    });
  });

  test("resolves auto deterministically without provisioning side effects", () => {
    const input = {
      parentRunId: "run-1",
      runtimeMode: "managed_runtime" as const,
      requestedPolicy: "auto" as const,
      parentWorkspaceId: "workspace-1",
    };

    const first = resolveDelegatedWorkspacePolicy(input);
    const second = resolveDelegatedWorkspacePolicy(input);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: "accepted",
      decision: "shared",
      requestedPolicy: "auto",
      effectivePolicy: "auto",
      reasonCode: "auto_managed_runtime_preserves_shared_workspace",
      createdResourceIds: [],
    });
  });

  test("defaults missing requested policy to auto", () => {
    const decision = resolveDelegatedWorkspacePolicy({
      parentRunId: "run-1",
      runtimeMode: "classic",
      parentWorkspaceId: "workspace-1",
    });

    expect(decision).toMatchObject({
      status: "accepted",
      decision: "shared",
      requestedPolicy: "auto",
      effectivePolicy: "auto",
      reasonCode: "auto_classic_preserves_shared_workspace",
    });
  });

  test("rejects missing parent inputs with typed reasons", () => {
    expect(
      resolveDelegatedWorkspacePolicy({
        runtimeMode: "classic",
        requestedPolicy: "isolated",
        parentWorkspaceId: "workspace-1",
      }),
    ).toMatchObject({
      status: "rejected",
      reasonCode: "missing_parent_run_id",
      createdResourceIds: [],
    });

    expect(
      resolveDelegatedWorkspacePolicy({
        parentRunId: "run-1",
        runtimeMode: "classic",
        requestedPolicy: "isolated",
      }),
    ).toMatchObject({
      status: "rejected",
      reasonCode: "missing_parent_workspace",
      createdResourceIds: [],
    });
  });
});
