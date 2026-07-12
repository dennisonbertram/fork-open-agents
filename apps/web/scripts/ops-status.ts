import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { redactOpsText } from "./ops-redaction";

type SourceStatus = "healthy" | "degraded" | "blocked" | "unknown";

export interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface OpsStatusSnapshot {
  requestedAt: string;
  environment: string;
  productionUrl: string;
  deployment: {
    status: SourceStatus;
    id?: string;
    url?: string;
    commitSha?: string;
    sourceGap?: string;
  };
  publicSmoke: {
    status: SourceStatus;
    summary?: string;
    sourceGap?: string;
  };
  logs: {
    status: SourceStatus;
    window: string;
    errorCount: number;
    samples: string[];
    sourceGap?: string;
  };
  github: {
    status: SourceStatus;
    openPrBlockers: string[];
    latestProductionSmoke?: string;
    sourceGap?: string;
  };
  nextAction: string;
}

const defaultProductionUrl = "https://open-agents-azure-xi.vercel.app";
const repoRoot = join(import.meta.dirname, "../../..");

interface VercelTarget {
  scope: string;
  project: string;
}

type VercelTargetResolution =
  | (VercelTarget & {
      status: "resolved";
      source: "explicit" | "environment" | "linked-project";
    })
  | { status: "blocked"; sourceGap: string };

interface LinkedVercelProject {
  orgId?: string;
  projectId?: string;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveVercelTarget(params: {
  explicit?: { scope?: string; project?: string };
  env?: Record<string, string | undefined>;
  linkedProject?: LinkedVercelProject | null;
}): VercelTargetResolution {
  const explicitScope = nonEmpty(params.explicit?.scope);
  const explicitProject = nonEmpty(params.explicit?.project);
  if (explicitScope || explicitProject) {
    return explicitScope && explicitProject
      ? {
          status: "resolved",
          scope: explicitScope,
          project: explicitProject,
          source: "explicit",
        }
      : {
          status: "blocked",
          sourceGap: "Both --scope and --project are required together.",
        };
  }

  const envScope = nonEmpty(params.env?.VERCEL_ORG_ID);
  const envProject = nonEmpty(params.env?.VERCEL_PROJECT_ID);
  if (envScope || envProject) {
    return envScope && envProject
      ? {
          status: "resolved",
          scope: envScope,
          project: envProject,
          source: "environment",
        }
      : {
          status: "blocked",
          sourceGap:
            "VERCEL_ORG_ID and VERCEL_PROJECT_ID are required together.",
        };
  }

  const linkedScope = nonEmpty(params.linkedProject?.orgId);
  const linkedProject = nonEmpty(params.linkedProject?.projectId);
  if (linkedScope || linkedProject) {
    return linkedScope && linkedProject
      ? {
          status: "resolved",
          scope: linkedScope,
          project: linkedProject,
          source: "linked-project",
        }
      : {
          status: "blocked",
          sourceGap:
            "Linked .vercel/project.json must include both orgId and projectId.",
        };
  }

  return {
    status: "blocked",
    sourceGap:
      "Vercel target unavailable. Pass --scope and --project, set VERCEL_ORG_ID and VERCEL_PROJECT_ID, or run vercel link.",
  };
}

function readLinkedVercelProject(): LinkedVercelProject | null {
  try {
    const parsed = JSON.parse(
      readFileSync(join(repoRoot, ".vercel/project.json"), "utf8"),
    ) as unknown;
    const record = asRecord(parsed);
    if (!record) return null;
    return {
      ...(typeof record.orgId === "string" ? { orgId: record.orgId } : {}),
      ...(typeof record.projectId === "string"
        ? { projectId: record.projectId }
        : {}),
    };
  } catch {
    return null;
  }
}

export function buildVercelInspectArgs(
  productionUrl: string,
  target: VercelTarget,
): string[] {
  return ["inspect", productionUrl, "--scope", target.scope, "--json"];
}

export function buildVercelLogsArgs(
  since: string,
  target: VercelTarget,
): string[] {
  return [
    "logs",
    "--scope",
    target.scope,
    "--project",
    target.project,
    "--environment",
    "production",
    "--status-code",
    "500,502,503,504",
    "--since",
    since,
  ];
}

function runCommand(command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 20_000,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function readJsonPayload(output: string): unknown | null {
  const trimmed = output.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    } catch {
      return null;
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseVercelInspect(output: string): {
  id?: string;
  url?: string;
  commitSha?: string;
} {
  const payload = asRecord(readJsonPayload(output));
  if (!payload) {
    return {};
  }
  const meta = asRecord(payload.meta);
  const githubSha =
    typeof meta?.githubCommitSha === "string" ? meta.githubCommitSha : null;
  return {
    ...(typeof payload.id === "string" ? { id: payload.id } : {}),
    ...(typeof payload.url === "string" ? { url: payload.url } : {}),
    ...(githubSha ? { commitSha: githubSha } : {}),
  };
}

export function parseVercelLogs(output: string): {
  errorCount: number;
  samples: string[];
} {
  const samples = output
    .split(/\r?\n/)
    .map((line) => redactOpsText(line.trim()))
    .filter(Boolean)
    .slice(0, 5);
  return { errorCount: samples.length, samples };
}

export function parseGhRuns(output: string): string | undefined {
  const payload = readJsonPayload(output);
  if (!Array.isArray(payload)) {
    return undefined;
  }
  const first =
    payload.find((entry) => {
      const record = asRecord(entry);
      return record && record.conclusion !== "skipped";
    }) ?? payload.find((entry) => asRecord(entry));
  const record = asRecord(first);
  if (!record) {
    return undefined;
  }
  const status = String(record.status ?? "unknown");
  const conclusion = String(record.conclusion ?? "unknown");
  const url = typeof record.url === "string" ? record.url : undefined;
  return `Production Smoke ${status}/${conclusion}${url ? ` (${url})` : ""}`;
}

export function parseLatestProductionDeploymentSha(
  output: string,
): string | undefined {
  const payload = readJsonPayload(output);
  if (!Array.isArray(payload)) return undefined;
  const deployment = asRecord(payload[0]);
  return typeof deployment?.sha === "string" ? deployment.sha : undefined;
}

export function formatOpsStatus(snapshot: OpsStatusSnapshot): string {
  const lines = [
    "Production ops status",
    `Requested: ${snapshot.requestedAt}`,
    `Environment: ${snapshot.environment}`,
    "",
    "Live version",
    `  Deployment: ${snapshot.deployment.id ?? snapshot.deployment.status}`,
    `  URL: ${snapshot.deployment.url ?? snapshot.productionUrl}`,
    `  SHA: ${snapshot.deployment.commitSha ?? "unknown"}`,
    "",
    "Public smoke",
    `  Status: ${snapshot.publicSmoke.status}`,
    `  Summary: ${snapshot.publicSmoke.summary ?? snapshot.publicSmoke.sourceGap ?? "not run"}`,
    "",
    "Recent production logs",
    `  Window: ${snapshot.logs.window}`,
    `  Status: ${snapshot.logs.status}`,
    `  5xx/error samples: ${snapshot.logs.errorCount}`,
    ...snapshot.logs.samples.map((sample) => `  - ${sample}`),
    ...(snapshot.logs.errorCount === 0
      ? ["  No recent 5xx/error logs found."]
      : []),
    "",
    "Open PR blockers",
    ...(snapshot.github.openPrBlockers.length > 0
      ? snapshot.github.openPrBlockers.map((line) => `  - ${line}`)
      : ["  No open PR blockers found."]),
    "",
    "Deploy checks",
    `  ${snapshot.github.latestProductionSmoke ?? snapshot.github.sourceGap ?? "unknown"}`,
    "",
    "Source gaps",
    ...[
      snapshot.deployment.sourceGap,
      snapshot.publicSmoke.sourceGap,
      snapshot.logs.sourceGap,
      snapshot.github.sourceGap,
    ]
      .filter(Boolean)
      .map(String)
      .map((gap) => `  - ${gap}`),
    "",
    "Next action",
    `  ${snapshot.nextAction}`,
  ];
  return lines.join("\n");
}

export async function collectOpsStatusSnapshot(params?: {
  productionUrl?: string;
  since?: string;
  run?: (command: string, args: string[]) => CommandResult;
  now?: Date;
  vercelTarget?: { scope?: string; project?: string };
}): Promise<OpsStatusSnapshot> {
  const productionUrl =
    params?.productionUrl ?? process.env.PRODUCTION_URL ?? defaultProductionUrl;
  const since = params?.since ?? "30m";
  const run = params?.run ?? runCommand;
  const requestedAt = (params?.now ?? new Date()).toISOString();
  const target = resolveVercelTarget({
    explicit: params?.vercelTarget,
    env: process.env,
    linkedProject: readLinkedVercelProject(),
  });

  const deploymentResult =
    target.status === "resolved"
      ? run("vercel", buildVercelInspectArgs(productionUrl, target))
      : null;
  const parsedDeployment =
    deploymentResult?.status === 0
      ? {
          status: "healthy" as const,
          ...parseVercelInspect(deploymentResult.stdout),
        }
      : {
          status: "blocked" as const,
          sourceGap: redactOpsText(
            deploymentResult?.stderr ||
              (target.status === "blocked"
                ? target.sourceGap
                : "Vercel inspect access unavailable."),
          ),
        };

  const githubDeploymentResult = run("gh", [
    "api",
    "repos/dennisonbertram/fork-open-agents/deployments?environment=Production&per_page=1",
  ]);
  const fallbackCommitSha =
    githubDeploymentResult.status === 0
      ? parseLatestProductionDeploymentSha(githubDeploymentResult.stdout)
      : undefined;
  const deployment = {
    ...parsedDeployment,
    ...(!("commitSha" in parsedDeployment) && fallbackCommitSha
      ? { commitSha: fallbackCommitSha }
      : {}),
  };

  const smokeResult = await runPreviewSmoke(productionUrl);
  const publicSmoke =
    smokeResult.status === 0
      ? {
          status: "healthy" as const,
          summary: redactOpsText(smokeResult.stdout.trim()),
        }
      : {
          status: "degraded" as const,
          sourceGap: redactOpsText(smokeResult.stderr || smokeResult.stdout),
        };

  const logsResult =
    target.status === "resolved"
      ? run("vercel", buildVercelLogsArgs(since, target))
      : null;
  const parsedLogs = parseVercelLogs(logsResult?.stdout ?? "");
  const logs =
    logsResult?.status === 0
      ? {
          status:
            parsedLogs.errorCount > 0
              ? ("degraded" as const)
              : ("healthy" as const),
          window: since,
          ...parsedLogs,
        }
      : {
          status: "blocked" as const,
          window: since,
          errorCount: 0,
          samples: [],
          sourceGap: redactOpsText(
            logsResult?.stderr ||
              (target.status === "blocked"
                ? target.sourceGap
                : "Vercel logs access unavailable."),
          ),
        };

  const prResult = run("gh", [
    "pr",
    "list",
    "--repo",
    "dennisonbertram/fork-open-agents",
    "--state",
    "open",
    "--json",
    "number,title,isDraft,reviewDecision,mergeable,url",
  ]);
  const runResult = run("gh", [
    "run",
    "list",
    "--repo",
    "dennisonbertram/fork-open-agents",
    "--workflow",
    "Production Smoke",
    "--limit",
    "5",
    "--json",
    "status,conclusion,url",
  ]);
  const github =
    prResult.status === 0
      ? {
          status: "healthy" as const,
          openPrBlockers: parsePrBlockers(prResult.stdout),
          latestProductionSmoke:
            runResult.status === 0 ? parseGhRuns(runResult.stdout) : undefined,
          ...(runResult.status !== 0
            ? {
                sourceGap: redactOpsText(
                  runResult.stderr || "GitHub run read failed.",
                ),
              }
            : {}),
        }
      : {
          status: "blocked" as const,
          openPrBlockers: [],
          sourceGap: redactOpsText(
            prResult.stderr || "GitHub access unavailable.",
          ),
        };

  const degraded =
    deployment.status !== "healthy" ||
    publicSmoke.status !== "healthy" ||
    logs.status !== "healthy" ||
    github.status !== "healthy";

  return {
    requestedAt,
    environment: "production",
    productionUrl,
    deployment,
    publicSmoke,
    logs,
    github,
    nextAction: degraded
      ? target.status === "resolved"
        ? `Inspect the named source gap, then run vercel logs --scope ${target.scope} --project ${target.project} --environment production --status-code 500,502,503,504 --since ${since}.`
        : "Inspect the named source gap, then rerun ops:status with paired --scope and --project values."
      : "Production public status looks healthy; run ops:authenticated-canary for product-path proof.",
  };
}

function parsePrBlockers(output: string): string[] {
  const payload = readJsonPayload(output);
  if (!Array.isArray(payload)) {
    return ["Could not parse open PR list."];
  }
  return payload
    .map((entry) => asRecord(entry))
    .filter(Boolean)
    .map((entry) => entry as Record<string, unknown>)
    .filter(
      (entry) => entry.isDraft === true || entry.mergeable === "CONFLICTING",
    )
    .map((entry) => `#${entry.number} ${entry.title} (${entry.url})`);
}

async function runPreviewSmoke(productionUrl: string): Promise<CommandResult> {
  const result = spawnSync(
    "bun",
    ["run", "--cwd", "apps/web", "preview:smoke"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, DEPLOYMENT_URL: productionUrl },
      timeout: 30_000,
    },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function parseArgs(argv: string[]) {
  let productionUrl: string | undefined;
  let since = "30m";
  let json = false;
  let strict = false;
  let scope: string | undefined;
  let project: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--url") {
      if (!next) throw new Error("--url requires a value.");
      productionUrl = next;
      index++;
      continue;
    }
    if (arg === "--since") {
      if (!next) throw new Error("--since requires a value.");
      since = next;
      index++;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--strict") {
      strict = true;
      continue;
    }
    if (arg === "--scope") {
      if (!next) throw new Error("--scope requires a value.");
      scope = next;
      index++;
      continue;
    }
    if (arg === "--project") {
      if (!next) throw new Error("--project requires a value.");
      project = next;
      index++;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return {
    productionUrl,
    since,
    json,
    strict,
    vercelTarget: { scope, project },
  };
}

export function isOpsStatusHealthy(snapshot: OpsStatusSnapshot): boolean {
  return (
    snapshot.deployment.status === "healthy" &&
    snapshot.publicSmoke.status === "healthy" &&
    snapshot.logs.status === "healthy" &&
    snapshot.github.status === "healthy"
  );
}

export async function runOpsStatus(
  argv = process.argv.slice(2),
): Promise<number> {
  try {
    const args = parseArgs(argv);
    const snapshot = await collectOpsStatusSnapshot(args);
    console.log(
      args.json ? JSON.stringify(snapshot, null, 2) : formatOpsStatus(snapshot),
    );
    return args.strict && !isOpsStatusHealthy(snapshot) ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.main) {
  process.exit(await runOpsStatus());
}
