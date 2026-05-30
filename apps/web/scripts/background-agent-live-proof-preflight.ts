import { spawnSync } from "node:child_process";
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { EnvAuditResult } from "./background-agent-vercel-env-audit";

const appRoot = join(import.meta.dirname, "..");
const DEFAULT_TIMEOUT_MS = 20_000;

type VercelEnvironment = "production" | "preview" | "development";
type CheckStatus = "ready" | "missing" | "manual";

type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

export type LiveProofPreflightOptions = {
  environment: VercelEnvironment;
  branch?: string;
  repo?: string;
  baseUrl?: string;
  verifyValues: boolean;
};

type PreflightCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  missing: string[];
  evidence: string[];
};

type RepoAccessReadiness = {
  ready?: boolean;
  repoOwner?: string;
  repoName?: string;
  requiredUserPermission?: string;
  reason?: string | null;
  message?: string;
  installationId?: number | null;
  repositoryId?: number | null;
  defaultBranch?: string | null;
};

type HostedReadinessCheck = {
  id?: string;
  status?: string;
  missing?: string[];
};

type ReadinessResponse = {
  checks?: HostedReadinessCheck[];
  repoAccess?: RepoAccessReadiness;
};

export type LiveProofPreflightResult = {
  ready: boolean;
  options: LiveProofPreflightOptions;
  checks: PreflightCheck[];
  notes: string[];
  nextSteps: string[];
};

type PreflightDeps = {
  runCommand?: (command: string, args: string[]) => CommandResult;
  fetch?: (
    input: URL | Request | string,
    init?: RequestInit,
  ) => Promise<Response>;
};

class LiveProofPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveProofPreflightError";
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

function runCommand(command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, {
    cwd: appRoot,
    encoding: "utf8",
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function normalizeEnvironment(value: string): VercelEnvironment | null {
  const lower = value.trim().toLowerCase();
  if (
    lower === "production" ||
    lower === "preview" ||
    lower === "development"
  ) {
    return lower;
  }
  return null;
}

function parseRepo(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) {
    throw new LiveProofPreflightError("--repo must use owner/repo format.");
  }
  return trimmed;
}

function parseBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new LiveProofPreflightError("--base-url must be a valid URL.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new LiveProofPreflightError("--base-url must be an http(s) URL.");
  }

  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function parseArgs(argv: string[]): LiveProofPreflightOptions {
  let environment: VercelEnvironment = "production";
  let branch: string | undefined;
  let repo: string | undefined;
  let baseUrl: string | undefined;
  let verifyValues = false;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--environment") {
      if (!next) {
        throw new LiveProofPreflightError("--environment requires a value.");
      }
      const parsed = normalizeEnvironment(next);
      if (!parsed) {
        throw new LiveProofPreflightError(
          "--environment must be production, preview, or development.",
        );
      }
      environment = parsed;
      index++;
      continue;
    }

    if (arg === "--branch") {
      if (!next) {
        throw new LiveProofPreflightError("--branch requires a value.");
      }
      branch = next;
      index++;
      continue;
    }

    if (arg === "--repo") {
      if (!next) {
        throw new LiveProofPreflightError("--repo requires owner/repo.");
      }
      repo = parseRepo(next) ?? undefined;
      index++;
      continue;
    }

    if (arg === "--base-url") {
      if (!next) {
        throw new LiveProofPreflightError("--base-url requires a URL.");
      }
      baseUrl = parseBaseUrl(next);
      index++;
      continue;
    }

    if (arg === "--verify-values") {
      verifyValues = true;
      continue;
    }

    throw new LiveProofPreflightError(`Unknown argument: ${arg}`);
  }

  return {
    environment,
    ...(branch ? { branch } : {}),
    ...(repo ? { repo } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    verifyValues,
  };
}

function getJsonFromCommand<T>(result: CommandResult): T {
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    const output = `${result.stdout}\n${result.stderr}`.trim();
    throw new LiveProofPreflightError(
      output || "Command did not return valid JSON.",
    );
  }
}

function firstLine(value: string): string {
  return value.trim().split(/\r?\n/)[0]?.trim() ?? "";
}

function buildEnvAuditCheck(
  audit: EnvAuditResult,
  commandResult: CommandResult,
): PreflightCheck {
  const missing = audit.missing;
  return {
    id: "vercel_env",
    label: "Vercel env",
    status: audit.ready ? "ready" : "missing",
    detail:
      "Required hosted env names and optional value presence for background-agent live proof.",
    missing,
    evidence: [
      `environment=${audit.environment}`,
      ...(audit.branch ? [`branch=${audit.branch}`] : []),
      `requireAllowlist=${audit.requireAllowlist}`,
      `exit=${commandResult.status ?? "unknown"}`,
      ...audit.notes.map((note) => `note=${note}`),
    ],
  };
}

function getPreflightCookie(): string | undefined {
  return process.env.BACKGROUND_AGENT_PREFLIGHT_COOKIE?.trim() || undefined;
}

function setBypassHeaders(headers: Headers) {
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (bypassSecret) {
    headers.set("x-vercel-protection-bypass", bypassSecret);
  }
}

async function checkReadinessRoute(params: {
  baseUrl?: string;
  fetchImpl: (
    input: URL | Request | string,
    init?: RequestInit,
  ) => Promise<Response>;
}): Promise<PreflightCheck> {
  if (!params.baseUrl) {
    return {
      id: "readiness_route",
      label: "Hosted readiness route",
      status: "missing",
      detail:
        "Provide --base-url to verify /api/background-agents/readiness is deployed and auth-protected.",
      missing: ["target deployment URL"],
      evidence: [],
    };
  }

  const url = new URL("/api/background-agents/readiness", params.baseUrl);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const headers = new Headers({
    "User-Agent": "open-agents-background-agent-preflight/1.0",
  });
  setBypassHeaders(headers);

  try {
    const response = await params.fetchImpl(url, {
      headers,
      signal: controller.signal,
    });
    const status = response.status;

    return {
      id: "readiness_route",
      label: "Hosted readiness route",
      status: status === 401 ? "ready" : "missing",
      detail:
        status === 401
          ? "Readiness route is deployed and auth-protected."
          : "Expected unauthenticated readiness route access to return 401.",
      missing: status === 401 ? [] : ["auth-protected readiness route"],
      evidence: [`url=${url.toString()}`, `status=${status}`],
    };
  } catch (error) {
    return {
      id: "readiness_route",
      label: "Hosted readiness route",
      status: "missing",
      detail: "Could not reach the hosted readiness route.",
      missing: ["reachable target deployment"],
      evidence: [
        `url=${url.toString()}`,
        `error=${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseRepoParts(repo: string | undefined) {
  if (!repo) {
    return null;
  }
  const [owner, name] = repo.split("/");
  return owner && name ? { owner, name } : null;
}

async function checkAuthenticatedRepoReadiness(params: {
  baseUrl?: string;
  repo?: string;
  fetchImpl: (
    input: URL | Request | string,
    init?: RequestInit,
  ) => Promise<Response>;
}): Promise<PreflightCheck> {
  if (!params.baseUrl || !params.repo) {
    return {
      id: "repo_readiness",
      label: "Authenticated repo readiness",
      status: "manual",
      detail:
        "Pass --base-url, --repo, and BACKGROUND_AGENT_PREFLIGHT_COOKIE to verify user access plus GitHub App repo coverage through the hosted app.",
      missing: [],
      evidence: [],
    };
  }

  const cookie = getPreflightCookie();
  if (!cookie) {
    return {
      id: "repo_readiness",
      label: "Authenticated repo readiness",
      status: "manual",
      detail:
        "Set BACKGROUND_AGENT_PREFLIGHT_COOKIE to verify user access plus GitHub App repo coverage through the hosted app.",
      missing: [],
      evidence: [
        "No cookie was sent or printed; confirm repo readiness from the authenticated Settings panel if you do not use the CLI cookie check.",
      ],
    };
  }

  const repo = parseRepoParts(params.repo);
  if (!repo) {
    return {
      id: "repo_readiness",
      label: "Authenticated repo readiness",
      status: "missing",
      detail: "Repo readiness requires owner/repo.",
      missing: ["disposable owner/repo"],
      evidence: [],
    };
  }

  const url = new URL("/api/background-agents/readiness", params.baseUrl);
  url.searchParams.set("repoOwner", repo.owner);
  url.searchParams.set("repoName", repo.name);
  url.searchParams.set("permission", "write");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const headers = new Headers({
    Cookie: cookie,
    "User-Agent": "open-agents-background-agent-preflight/1.0",
  });
  setBypassHeaders(headers);

  try {
    const response = await params.fetchImpl(url, {
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        id: "repo_readiness",
        label: "Authenticated repo readiness",
        status: "missing",
        detail:
          "Hosted repo readiness did not accept the provided authentication.",
        missing: ["authenticated repo readiness"],
        evidence: [`url=${url.toString()}`, `status=${response.status}`],
      };
    }

    const body = (await response.json()) as ReadinessResponse;
    const repoAccess = body.repoAccess;
    const appWebhookCheck = body.checks?.find(
      (check) => check.id === "github_app_webhooks",
    );
    if (!repoAccess) {
      return {
        id: "repo_readiness",
        label: "Authenticated repo readiness",
        status: "missing",
        detail: "Hosted readiness response did not include repoAccess.",
        missing: ["repoAccess readiness"],
        evidence: [`url=${url.toString()}`],
      };
    }

    const appWebhookReady =
      !appWebhookCheck || appWebhookCheck.status === "ready";
    const missing = [
      ...(repoAccess.ready ? [] : [repoAccess.reason ?? "repo_readiness"]),
      ...(appWebhookReady ? [] : (appWebhookCheck?.missing ?? [])),
    ];

    return {
      id: "repo_readiness",
      label: "Authenticated repo readiness",
      status: repoAccess.ready && appWebhookReady ? "ready" : "missing",
      detail:
        repoAccess.ready && appWebhookReady
          ? "Hosted app verified user write access, GitHub App repo coverage, and GitHub App webhook readiness."
          : appWebhookReady
            ? (repoAccess.message ??
              "Hosted app could not verify repo access and GitHub App coverage.")
            : "Hosted readiness reports missing GitHub App webhook subscriptions or permissions.",
      missing,
      evidence: [
        `repo=${repoAccess.repoOwner ?? repo.owner}/${repoAccess.repoName ?? repo.name}`,
        `requiredUserPermission=${repoAccess.requiredUserPermission ?? "write"}`,
        appWebhookCheck ? `githubAppWebhooks=${appWebhookCheck.status}` : "",
        repoAccess.installationId
          ? `installationId=${repoAccess.installationId}`
          : "",
        repoAccess.repositoryId
          ? `repositoryId=${repoAccess.repositoryId}`
          : "",
        repoAccess.defaultBranch
          ? `defaultBranch=${repoAccess.defaultBranch}`
          : "",
      ].filter(Boolean),
    };
  } catch (error) {
    return {
      id: "repo_readiness",
      label: "Authenticated repo readiness",
      status: "missing",
      detail: "Could not reach authenticated repo readiness.",
      missing: ["authenticated repo readiness"],
      evidence: [
        `url=${url.toString()}`,
        `error=${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function checkRepo(params: {
  repo?: string;
  run: (command: string, args: string[]) => CommandResult;
}): PreflightCheck {
  if (!params.repo) {
    return {
      id: "disposable_repo",
      label: "Disposable repo",
      status: "missing",
      detail:
        "Provide --repo owner/repo for the disposable repository used by live proof.",
      missing: ["disposable owner/repo"],
      evidence: [],
    };
  }

  const result = params.run("gh", [
    "repo",
    "view",
    params.repo,
    "--json",
    "nameWithOwner,url,isPrivate,defaultBranchRef",
  ]);
  if (result.status !== 0) {
    return {
      id: "disposable_repo",
      label: "Disposable repo",
      status: "missing",
      detail: "The disposable repository could not be loaded with gh.",
      missing: ["accessible disposable repository"],
      evidence: [
        `repo=${params.repo}`,
        `exit=${result.status ?? "unknown"}`,
        firstLine(result.stderr || result.stdout),
      ].filter(Boolean),
    };
  }

  const repo = getJsonFromCommand<{
    nameWithOwner?: string;
    url?: string;
    isPrivate?: boolean;
    defaultBranchRef?: { name?: string } | null;
  }>(result);

  return {
    id: "disposable_repo",
    label: "Disposable repo",
    status: "ready",
    detail: "The disposable repository is accessible to the GitHub CLI.",
    missing: [],
    evidence: [
      `repo=${repo.nameWithOwner ?? params.repo}`,
      repo.url ? `url=${repo.url}` : "",
      `visibility=${repo.isPrivate ? "private" : "public"}`,
      repo.defaultBranchRef?.name
        ? `defaultBranch=${repo.defaultBranchRef.name}`
        : "",
    ].filter(Boolean),
  };
}

function buildNextSteps(checks: PreflightCheck[]) {
  const nextSteps: string[] = [];
  const envCheck = checks.find((check) => check.id === "vercel_env");
  if (envCheck && envCheck.missing.length > 0) {
    nextSteps.push(
      `Set or confirm these Vercel env names without exposing values: ${envCheck.missing.join(", ")}.`,
    );
  }
  if (
    checks.some(
      (check) => check.id === "readiness_route" && check.status !== "ready",
    )
  ) {
    nextSteps.push(
      "Pass --base-url https://<target-host> after the hosted deployment is available.",
    );
  }
  if (
    checks.some(
      (check) => check.id === "disposable_repo" && check.status !== "ready",
    )
  ) {
    nextSteps.push(
      "Pass --repo <owner>/<repo> for a disposable repository owned by Dennison's workspace.",
    );
  }
  if (checks.some((check) => check.id === "repo_readiness")) {
    nextSteps.push(
      "Confirm authenticated repo readiness from the Settings panel or rerun preflight with BACKGROUND_AGENT_PREFLIGHT_COOKIE.",
    );
  }
  return nextSteps;
}

export async function runLiveProofPreflight(
  options: LiveProofPreflightOptions,
  deps: PreflightDeps = {},
): Promise<LiveProofPreflightResult> {
  const run = deps.runCommand ?? runCommand;
  const fetchImpl = deps.fetch ?? fetch;
  const envArgs = [
    "run",
    "scripts/background-agent-vercel-env-audit.ts",
    "--environment",
    options.environment,
    "--json",
    "--require-allowlist",
  ];
  if (options.branch) {
    envArgs.push("--branch", options.branch);
  }
  if (options.verifyValues) {
    envArgs.push("--verify-values");
  }

  const envCommand = run("bun", envArgs);
  const envAudit = getJsonFromCommand<EnvAuditResult>(envCommand);
  const checks = [
    buildEnvAuditCheck(envAudit, envCommand),
    await checkReadinessRoute({ baseUrl: options.baseUrl, fetchImpl }),
    checkRepo({ repo: options.repo, run }),
    await checkAuthenticatedRepoReadiness({
      baseUrl: options.baseUrl,
      repo: options.repo,
      fetchImpl,
    }),
  ];

  const blockingChecks = checks.filter((check) => check.status !== "manual");
  return {
    ready: blockingChecks.every((check) => check.status === "ready"),
    options,
    checks,
    notes: [
      "This preflight does not read or print secret values.",
      "A ready preflight means the automated prerequisites are present; it does not replace the live GitHub delivery, sandbox, ready PR, duplicate, and failure proofs.",
    ],
    nextSteps: buildNextSteps(checks),
  };
}

function formatPreflight(result: LiveProofPreflightResult): string {
  const lines = [
    "Background agents live proof preflight",
    `Target: ${result.options.environment}${result.options.branch ? ` (${result.options.branch})` : ""}`,
    `Status: ${result.ready ? "ready for live proof setup" : "missing prerequisites"}`,
    "",
  ];

  for (const check of result.checks) {
    const label =
      check.status === "ready"
        ? "OK"
        : check.status === "manual"
          ? "MANUAL"
          : "MISSING";
    lines.push(`${label} ${check.label}`);
    lines.push(`  ${check.detail}`);
    if (check.missing.length > 0) {
      lines.push(`  Missing: ${check.missing.join(", ")}`);
    }
    for (const evidence of check.evidence) {
      lines.push(`  ${evidence}`);
    }
  }

  lines.push("", "Next steps:");
  for (const step of result.nextSteps) {
    lines.push(`- ${step}`);
  }

  lines.push("");
  for (const note of result.notes) {
    lines.push(`Note: ${note}`);
  }

  return lines.join("\n");
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    loadLocalEnv();
    const result = await runLiveProofPreflight(parseArgs(argv));
    console.log(formatPreflight(result));
    return result.ready ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.main) {
  process.exit(await main());
}
