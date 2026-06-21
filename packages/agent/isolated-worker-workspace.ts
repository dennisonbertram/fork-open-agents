import { spawn } from "node:child_process";
import path from "node:path";
import { z } from "zod";
import type { AgentSandboxContext } from "./open-agent";

const isolatedWorkspaceReasonCodeSchema = z.enum([
  "isolated_workspace_creation_started",
  "isolated_workspace_creation_succeeded",
  "isolated_workspace_creation_failed",
  "isolated_workspace_provisioner_unavailable",
]);

export const isolatedWorkerWorkspaceProvenanceSchema = z.object({
  parentWorkspaceId: z.string(),
  childWorkspaceId: z.string(),
  sourceRef: z.string().optional(),
  sourceCommit: z.string().optional(),
  backendKind: z.string(),
  createdAt: z.number().int().nonnegative(),
});

export type IsolatedWorkerWorkspaceProvenance = z.infer<
  typeof isolatedWorkerWorkspaceProvenanceSchema
>;

export const isolatedWorkerWorkspaceEventSchema = z.object({
  type: z.enum([
    "isolated_workspace_creation_started",
    "isolated_workspace_creation_succeeded",
    "isolated_workspace_creation_failed",
  ]),
  parentWorkspaceId: z.string(),
  childWorkspaceId: z.string().optional(),
  backendKind: z.string().optional(),
  sourceRef: z.string().optional(),
  sourceCommit: z.string().optional(),
  reasonCode: isolatedWorkspaceReasonCodeSchema,
  failurePhase: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  createdAt: z.number().int().nonnegative(),
});

export type IsolatedWorkerWorkspaceEvent = z.infer<
  typeof isolatedWorkerWorkspaceEventSchema
>;

export const isolatedWorkerWorkspaceResultSchema = z.object({
  status: z.enum(["created", "failed", "unsupported"]),
  reasonCode: isolatedWorkspaceReasonCodeSchema,
  parentWorkspaceId: z.string(),
  childWorkspaceId: z.string().optional(),
  sourceRef: z.string().optional(),
  sourceCommit: z.string().optional(),
  backendKind: z.string().optional(),
  failurePhase: z.string().optional(),
  errorMessage: z.string().optional(),
  createdAt: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative(),
  events: z.array(isolatedWorkerWorkspaceEventSchema),
});

export type IsolatedWorkerWorkspaceResult = z.infer<
  typeof isolatedWorkerWorkspaceResultSchema
>;

export type IsolatedWorkspaceProvisionerInput = {
  parentSandbox: AgentSandboxContext;
  parentWorkspaceId: string;
  workerId: string;
  sourceRef?: string;
  sourceCommit?: string;
};

export type IsolatedWorkspaceProvisionerResult = {
  sandbox: AgentSandboxContext;
  provenance: IsolatedWorkerWorkspaceProvenance;
};

export type IsolatedWorkspaceProvisioner = (
  input: IsolatedWorkspaceProvisionerInput,
) => Promise<IsolatedWorkspaceProvisionerResult>;

function runGit(args: string[], cwd: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", () => resolve(undefined));
    child.on("close", (code) => {
      if (code !== 0) {
        resolve(undefined);
        return;
      }
      const trimmed = stdout.trim();
      resolve(trimmed.length > 0 ? trimmed : undefined);
    });
  });
}

export async function getParentWorkspaceGitState(
  workingDirectory: string,
): Promise<{ sourceRef?: string; sourceCommit?: string }> {
  const cwd = path.resolve(workingDirectory);
  const sourceRef = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  const sourceCommit = await runGit(["rev-parse", "HEAD"], cwd);
  return {
    sourceRef: sourceRef === "HEAD" ? sourceCommit : sourceRef,
    sourceCommit,
  };
}

export class IsolatedWorkspaceProvisioningError extends Error {
  readonly result: IsolatedWorkerWorkspaceResult;

  constructor(result: IsolatedWorkerWorkspaceResult) {
    super(
      `${result.reasonCode}: isolated worker workspace was not created. Worker was not started.`,
    );
    this.name = "IsolatedWorkspaceProvisioningError";
    this.result = result;
  }
}

export function buildUnsupportedIsolatedWorkspaceResult(params: {
  parentWorkspaceId: string;
  sourceRef?: string;
  sourceCommit?: string;
  startedAt: number;
  endedAt?: number;
}): IsolatedWorkerWorkspaceResult {
  const endedAt = params.endedAt ?? Date.now();
  return {
    status: "unsupported",
    reasonCode: "isolated_workspace_provisioner_unavailable",
    parentWorkspaceId: params.parentWorkspaceId,
    sourceRef: params.sourceRef,
    sourceCommit: params.sourceCommit,
    failurePhase: "provisioner_lookup",
    errorMessage:
      "No isolated workspace provisioner is available for this sandbox backend.",
    durationMs: Math.max(0, endedAt - params.startedAt),
    events: [
      {
        type: "isolated_workspace_creation_failed",
        parentWorkspaceId: params.parentWorkspaceId,
        sourceRef: params.sourceRef,
        sourceCommit: params.sourceCommit,
        reasonCode: "isolated_workspace_provisioner_unavailable",
        failurePhase: "provisioner_lookup",
        durationMs: Math.max(0, endedAt - params.startedAt),
        createdAt: endedAt,
      },
    ],
  };
}

export async function provisionIsolatedWorkerWorkspace(params: {
  provisioner?: IsolatedWorkspaceProvisioner;
  parentSandbox: AgentSandboxContext;
  parentWorkspaceId: string;
  workerId: string;
  startedAt?: number;
}): Promise<
  IsolatedWorkspaceProvisionerResult & {
    result: IsolatedWorkerWorkspaceResult;
  }
> {
  const startedAt = params.startedAt ?? Date.now();
  const { sourceRef, sourceCommit } = await getParentWorkspaceGitState(
    params.parentSandbox.workingDirectory,
  );

  if (!params.provisioner) {
    throw new IsolatedWorkspaceProvisioningError(
      buildUnsupportedIsolatedWorkspaceResult({
        parentWorkspaceId: params.parentWorkspaceId,
        sourceRef,
        sourceCommit,
        startedAt,
      }),
    );
  }

  const startedEvent: IsolatedWorkerWorkspaceEvent = {
    type: "isolated_workspace_creation_started",
    parentWorkspaceId: params.parentWorkspaceId,
    sourceRef,
    sourceCommit,
    reasonCode: "isolated_workspace_creation_started",
    createdAt: startedAt,
  };

  try {
    const provisioned = await params.provisioner({
      parentSandbox: params.parentSandbox,
      parentWorkspaceId: params.parentWorkspaceId,
      workerId: params.workerId,
      sourceRef,
      sourceCommit,
    });
    const endedAt = Date.now();
    const durationMs = Math.max(0, endedAt - startedAt);
    const provenance = {
      ...provisioned.provenance,
      sourceRef: provisioned.provenance.sourceRef ?? sourceRef,
      sourceCommit: provisioned.provenance.sourceCommit ?? sourceCommit,
    };
    const result: IsolatedWorkerWorkspaceResult = {
      status: "created",
      reasonCode: "isolated_workspace_creation_succeeded",
      parentWorkspaceId: params.parentWorkspaceId,
      childWorkspaceId: provenance.childWorkspaceId,
      sourceRef: provenance.sourceRef,
      sourceCommit: provenance.sourceCommit,
      backendKind: provenance.backendKind,
      createdAt: provenance.createdAt,
      durationMs,
      events: [
        startedEvent,
        {
          type: "isolated_workspace_creation_succeeded",
          parentWorkspaceId: params.parentWorkspaceId,
          childWorkspaceId: provenance.childWorkspaceId,
          backendKind: provenance.backendKind,
          sourceRef: provenance.sourceRef,
          sourceCommit: provenance.sourceCommit,
          reasonCode: "isolated_workspace_creation_succeeded",
          durationMs,
          createdAt: endedAt,
        },
      ],
    };

    return { ...provisioned, provenance, result };
  } catch (error) {
    if (error instanceof IsolatedWorkspaceProvisioningError) {
      throw error;
    }

    const endedAt = Date.now();
    throw new IsolatedWorkspaceProvisioningError({
      status: "failed",
      reasonCode: "isolated_workspace_creation_failed",
      parentWorkspaceId: params.parentWorkspaceId,
      sourceRef,
      sourceCommit,
      failurePhase: "provisioner_create",
      errorMessage: error instanceof Error ? error.message : String(error),
      durationMs: Math.max(0, endedAt - startedAt),
      events: [
        startedEvent,
        {
          type: "isolated_workspace_creation_failed",
          parentWorkspaceId: params.parentWorkspaceId,
          sourceRef,
          sourceCommit,
          reasonCode: "isolated_workspace_creation_failed",
          failurePhase: "provisioner_create",
          durationMs: Math.max(0, endedAt - startedAt),
          createdAt: endedAt,
        },
      ],
    });
  }
}
