import { randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const appRoot = join(import.meta.dirname, "..");

type ProofStatus = "passed" | "blocked" | "failed";
type CheckStatus = "passed" | "blocked" | "failed";
type OutputFormat = "markdown" | "json";

const isoTimestampSchema = z
  .string()
  .datetime()
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}T/));

const proofLifecycleStatusSchema = z.enum([
  "launching",
  "running",
  "blocked",
  "completed",
  "failed",
  "cancelled",
  "stale",
]);

export const isolatedWorkerLiveProofEvidenceSchema = z.object({
  proofId: z.string().min(1),
  createdAt: isoTimestampSchema,
  backendKind: z.string().min(1),
  correlationId: z.string().min(1),
  parent: z.object({
    workspaceId: z.string().min(1),
    workspacePath: z.string().min(1).optional(),
    sourceRef: z.string().min(1).optional(),
    sourceCommit: z.string().min(1).optional(),
    markerPresentBeforeIntegration: z.boolean(),
  }),
  child: z.object({
    workerId: z.string().min(1),
    workspaceId: z.string().min(1),
    workspacePath: z.string().min(1).optional(),
    sourceRef: z.string().min(1).optional(),
    sourceCommit: z.string().min(1).optional(),
    markerPath: z.string().min(1),
    markerWriteSucceeded: z.boolean(),
    toolExecutionSucceeded: z.boolean(),
  }),
  persistence: z.object({
    runId: z.string().min(1),
    terminalStatus: z.enum(["completed", "failed", "cancelled", "blocked"]),
    lifecycleStates: z.array(proofLifecycleStatusSchema).min(1),
    evidenceRefs: z.array(z.string().min(1)).default([]),
  }),
  cleanup: z.object({
    status: z.enum(["completed", "skipped", "failed", "manual_required"]),
    detail: z.string().min(1),
  }),
  limitations: z.array(z.string().min(1)).default([]),
});

export type IsolatedWorkerLiveProofEvidence = z.infer<
  typeof isolatedWorkerLiveProofEvidenceSchema
>;

export type IsolatedWorkerLiveProofCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  evidence: string[];
};

export type IsolatedWorkerLiveProofResult = {
  status: ProofStatus;
  proofId: string;
  createdAt: string;
  checks: IsolatedWorkerLiveProofCheck[];
  evidence?: IsolatedWorkerLiveProofEvidence;
  limitations: string[];
  nextSteps: string[];
};

export type IsolatedWorkerLiveProofOptions = {
  live: boolean;
  format: OutputFormat;
  evidenceJson?: string;
};

type Env = Record<string, string | undefined>;

type ProofDeps = {
  now?: () => Date;
  uuid?: () => string;
  env?: Env;
  runLiveSmoke?: () => Promise<IsolatedWorkerLiveProofEvidence>;
};

export class IsolatedWorkerLiveProofError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IsolatedWorkerLiveProofError";
  }
}

function loadLocalEnv() {
  for (const filename of [".env.local", ".env"]) {
    const envPath = join(appRoot, filename);
    if (existsSync(envPath)) {
      loadEnv({ path: envPath, override: false });
    }
  }
}

function parseBoolean(value: string | undefined) {
  if (!value) {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseArgs(argv: string[]): IsolatedWorkerLiveProofOptions {
  let live = false;
  let format: OutputFormat = "markdown";
  let evidenceJson: string | undefined;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--live") {
      live = true;
      continue;
    }

    if (arg === "--format") {
      if (next !== "markdown" && next !== "json") {
        throw new IsolatedWorkerLiveProofError(
          "--format must be markdown or json.",
        );
      }
      format = next;
      index++;
      continue;
    }

    if (arg === "--evidence-json") {
      if (!next) {
        throw new IsolatedWorkerLiveProofError(
          "--evidence-json requires a JSON string.",
        );
      }
      evidenceJson = next;
      index++;
      continue;
    }

    throw new IsolatedWorkerLiveProofError(`Unknown argument: ${arg}`);
  }

  return {
    live,
    format,
    ...(evidenceJson ? { evidenceJson } : {}),
  };
}

function redactPath(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const normalized = value.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.at(-1) ?? value;
}

function evidenceLine(key: string, value: string | undefined) {
  return value ? `${key}=${value}` : undefined;
}

function check(
  id: string,
  label: string,
  status: CheckStatus,
  detail: string,
  evidence: Array<string | undefined> = [],
): IsolatedWorkerLiveProofCheck {
  return {
    id,
    label,
    status,
    detail,
    evidence: evidence.filter(
      (item): item is string => typeof item === "string",
    ),
  };
}

function validateEvidence(
  evidence: IsolatedWorkerLiveProofEvidence,
): IsolatedWorkerLiveProofCheck[] {
  const lifecycleStates = new Set(evidence.persistence.lifecycleStates);
  const checks: IsolatedWorkerLiveProofCheck[] = [
    check(
      "workspace_separation",
      "Workspace separation",
      evidence.parent.workspaceId !== evidence.child.workspaceId
        ? "passed"
        : "failed",
      evidence.parent.workspaceId !== evidence.child.workspaceId
        ? "Parent and child workspace identities differ."
        : "Parent and child workspace identities match.",
      [
        evidenceLine("parentWorkspaceId", evidence.parent.workspaceId),
        evidenceLine("childWorkspaceId", evidence.child.workspaceId),
        evidenceLine(
          "parentPathName",
          redactPath(evidence.parent.workspacePath),
        ),
        evidenceLine("childPathName", redactPath(evidence.child.workspacePath)),
      ],
    ),
    check(
      "source_linkage",
      "Source linkage",
      evidence.parent.sourceCommit &&
        evidence.child.sourceCommit &&
        evidence.parent.sourceCommit === evidence.child.sourceCommit
        ? "passed"
        : "blocked",
      evidence.parent.sourceCommit && evidence.child.sourceCommit
        ? "Parent and child source commits are linked."
        : "Source commit evidence was not captured for both workspaces.",
      [
        evidenceLine("parentRef", evidence.parent.sourceRef),
        evidenceLine("childRef", evidence.child.sourceRef),
        evidenceLine("sourceCommit", evidence.parent.sourceCommit),
      ],
    ),
    check(
      "marker_isolation",
      "Marker isolation",
      evidence.child.markerWriteSucceeded &&
        !evidence.parent.markerPresentBeforeIntegration
        ? "passed"
        : "failed",
      evidence.child.markerWriteSucceeded &&
        !evidence.parent.markerPresentBeforeIntegration
        ? "Child wrote marker and parent did not contain it before integration."
        : "Marker isolation failed.",
      [
        evidenceLine("markerPath", evidence.child.markerPath),
        `childWrite=${evidence.child.markerWriteSucceeded}`,
        `parentMarkerBeforeIntegration=${evidence.parent.markerPresentBeforeIntegration}`,
      ],
    ),
    check(
      "tool_execution",
      "Tool execution",
      evidence.child.toolExecutionSucceeded ? "passed" : "failed",
      evidence.child.toolExecutionSucceeded
        ? "Child tool execution succeeded."
        : "Child tool execution did not succeed.",
      [`workerId=${evidence.child.workerId}`],
    ),
    check(
      "lifecycle_persistence",
      "Lifecycle persistence",
      lifecycleStates.has("completed") &&
        evidence.persistence.terminalStatus === "completed"
        ? "passed"
        : "failed",
      lifecycleStates.has("completed") &&
        evidence.persistence.terminalStatus === "completed"
        ? "Persisted lifecycle reached completed terminal status."
        : "Persisted lifecycle did not reach completed terminal status.",
      [
        evidenceLine("runId", evidence.persistence.runId),
        `terminalStatus=${evidence.persistence.terminalStatus}`,
        `lifecycleStates=${evidence.persistence.lifecycleStates.join(",")}`,
        `evidenceRefs=${evidence.persistence.evidenceRefs.join(",")}`,
      ],
    ),
    check(
      "cleanup",
      "Cleanup",
      evidence.cleanup.status === "completed" ? "passed" : "blocked",
      evidence.cleanup.detail,
      [`cleanupStatus=${evidence.cleanup.status}`],
    ),
  ];

  return checks;
}

function statusFromChecks(checks: IsolatedWorkerLiveProofCheck[]): ProofStatus {
  if (checks.some((item) => item.status === "failed")) {
    return "failed";
  }
  if (checks.some((item) => item.status === "blocked")) {
    return "blocked";
  }
  return "passed";
}

function parseEvidenceJson(value: string): IsolatedWorkerLiveProofEvidence {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new IsolatedWorkerLiveProofError(
      "--evidence-json must contain valid JSON.",
    );
  }
  return isolatedWorkerLiveProofEvidenceSchema.parse(parsed);
}

function blockedPrerequisiteResult(params: {
  proofId: string;
  createdAt: string;
  env: Env;
}) {
  const liveEnabled = parseBoolean(
    params.env.ISOLATED_WORKER_LIVE_PROOF_ENABLED,
  );
  const checkStatus: CheckStatus = liveEnabled ? "blocked" : "blocked";
  const missing = [
    ...(!liveEnabled ? ["ISOLATED_WORKER_LIVE_PROOF_ENABLED=1"] : []),
    "real isolated workspace provisioner",
    "live sandbox execution hook",
  ];

  return {
    status: "blocked" as const,
    proofId: params.proofId,
    createdAt: params.createdAt,
    checks: [
      check(
        "live_prerequisites",
        "Live prerequisites",
        checkStatus,
        "Live isolated worker proof is not configured in this checkout.",
        missing.map((item) => `missing=${item}`),
      ),
    ],
    limitations: [
      "No live isolated workspace backend was executed by this command.",
      "This blocked result is valid evidence of missing prerequisites, not proof of workspace isolation.",
    ],
    nextSteps: [
      "Configure a real isolated workspace provisioner for the sandbox backend.",
      "Run this command with --live and ISOLATED_WORKER_LIVE_PROOF_ENABLED=1.",
      "Attach the generated evidence block to the PR or issue.",
    ],
  } satisfies IsolatedWorkerLiveProofResult;
}

export async function runIsolatedWorkerLiveProof(
  options: IsolatedWorkerLiveProofOptions,
  deps: ProofDeps = {},
): Promise<IsolatedWorkerLiveProofResult> {
  const env = deps.env ?? process.env;
  const proofId = deps.uuid?.() ?? randomUUID();
  const createdAt = (deps.now?.() ?? new Date()).toISOString();

  if (options.evidenceJson) {
    const evidence = parseEvidenceJson(options.evidenceJson);
    const checks = validateEvidence(evidence);
    return {
      status: statusFromChecks(checks),
      proofId: evidence.proofId,
      createdAt: evidence.createdAt,
      checks,
      evidence,
      limitations: evidence.limitations,
      nextSteps:
        statusFromChecks(checks) === "passed"
          ? ["Link this evidence from the PR and parent epic."]
          : ["Fix failed or blocked checks and rerun the proof."],
    };
  }

  if (!options.live || !parseBoolean(env.ISOLATED_WORKER_LIVE_PROOF_ENABLED)) {
    return blockedPrerequisiteResult({ proofId, createdAt, env });
  }

  if (!deps.runLiveSmoke) {
    return blockedPrerequisiteResult({ proofId, createdAt, env });
  }

  const evidence = isolatedWorkerLiveProofEvidenceSchema.parse(
    await deps.runLiveSmoke(),
  );
  const checks = validateEvidence(evidence);
  return {
    status: statusFromChecks(checks),
    proofId: evidence.proofId,
    createdAt: evidence.createdAt,
    checks,
    evidence,
    limitations: evidence.limitations,
    nextSteps:
      statusFromChecks(checks) === "passed"
        ? ["Link this evidence from the PR and parent epic."]
        : ["Fix failed or blocked checks and rerun the proof."],
  };
}

export function formatIsolatedWorkerLiveProof(
  result: IsolatedWorkerLiveProofResult,
): string {
  const lines = [
    `# Isolated Worker Live Proof`,
    "",
    `- status: ${result.status}`,
    `- proofId: ${result.proofId}`,
    `- createdAt: ${result.createdAt}`,
    "",
    "## Checks",
    ...result.checks.flatMap((item) => [
      `- ${item.status}: ${item.label} (${item.id})`,
      `  - ${item.detail}`,
      ...item.evidence.map((entry) => `  - ${entry}`),
    ]),
    "",
    "## Limitations",
    ...(result.limitations.length > 0
      ? result.limitations.map((item) => `- ${item}`)
      : ["- None"]),
    "",
    "## Next steps",
    ...result.nextSteps.map((item) => `- ${item}`),
  ];

  return `${lines.join("\n")}\n`;
}

if (import.meta.main) {
  try {
    loadLocalEnv();
    const options = parseArgs(process.argv.slice(2));
    const result = await runIsolatedWorkerLiveProof(options);
    if (options.format === "json") {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatIsolatedWorkerLiveProof(result));
    }
    process.exitCode = result.status === "failed" ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
