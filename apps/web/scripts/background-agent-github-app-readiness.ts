import { createAppAuth } from "@octokit/auth-app";
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";

const appRoot = join(import.meta.dirname, "..");

type Env = Record<string, string | undefined>;
type CheckStatus = "ready" | "missing";

const requiredEvents = ["pull_request", "issues", "deployment_status"] as const;

const requiredPermissions = {
  contents: "write",
  pull_requests: "write",
  issues: "read",
  deployments: "read",
  statuses: "read",
  metadata: "read",
} as const;

type RequiredPermission =
  (typeof requiredPermissions)[keyof typeof requiredPermissions];

export type GitHubAppReadinessCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  missing: string[];
  evidence: string[];
};

export type GitHubAppReadinessResult = {
  ready: boolean;
  repo: string;
  checks: GitHubAppReadinessCheck[];
  notes: string[];
};

type GitHubAppMetadata = {
  slug?: string | null;
  events?: string[];
  permissions?: Record<string, string | undefined>;
};

type GitHubRepoInstallation = {
  ok: boolean;
  status: number;
  installationId?: number;
  repositorySelection?: string | null;
  accountLogin?: string | null;
};

type CliOptions = {
  repo?: string;
  envFile?: string;
  json: boolean;
};

export class GitHubAppReadinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubAppReadinessError";
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

function requireEnv(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new GitHubAppReadinessError(`${name} is required.`);
  }
  return value;
}

function parsePrivateKey(value: string): string {
  const unescaped = value.replace(/\\n/g, "\n").trim();
  if (unescaped.includes("BEGIN") && unescaped.includes("PRIVATE KEY")) {
    return unescaped;
  }

  const decoded = Buffer.from(value, "base64").toString("utf-8").trim();
  if (decoded.includes("BEGIN") && decoded.includes("PRIVATE KEY")) {
    return decoded;
  }

  throw new GitHubAppReadinessError("Invalid GITHUB_APP_PRIVATE_KEY format.");
}

export function parseRepo(value: string | undefined): string {
  const trimmed = value?.trim();
  const [owner, repo] = trimmed?.split("/") ?? [];
  const ownerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
  const repoPattern = /^[A-Za-z0-9_.-]+$/;
  if (
    !trimmed ||
    trimmed.split("/").length !== 2 ||
    !ownerPattern.test(owner ?? "") ||
    !repoPattern.test(repo ?? "")
  ) {
    throw new GitHubAppReadinessError("--repo must use owner/repo format.");
  }
  return trimmed;
}

function parseArgs(argv: string[]): CliOptions {
  let repo: string | undefined;
  let envFile: string | undefined;
  let json = false;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--repo") {
      if (!next) {
        throw new GitHubAppReadinessError("--repo requires owner/repo.");
      }
      repo = parseRepo(next);
      index++;
      continue;
    }

    if (arg === "--env-file") {
      if (!next) {
        throw new GitHubAppReadinessError("--env-file requires a file path.");
      }
      envFile = next;
      index++;
      continue;
    }

    if (arg === "--json") {
      json = true;
      continue;
    }

    throw new GitHubAppReadinessError(`Unknown argument: ${arg}`);
  }

  return { repo, envFile, json };
}

function permissionSatisfies(
  actual: string | undefined,
  required: RequiredPermission,
): boolean {
  if (required === "read") {
    return actual === "read" || actual === "write";
  }
  return actual === "write";
}

export function assessGitHubAppReadiness(params: {
  repo: string;
  app: GitHubAppMetadata;
  installation: GitHubRepoInstallation;
}): GitHubAppReadinessResult {
  const events = new Set(params.app.events);
  const permissions = params.app.permissions ?? {};
  const missingEvents = requiredEvents
    .filter((event) => !events.has(event))
    .map((event) => `event:${event}`);
  const missingPermissions = Object.entries(requiredPermissions)
    .filter(
      ([permission, required]) =>
        !permissionSatisfies(permissions[permission], required),
    )
    .map(([permission, required]) => `permission:${permission}=${required}`);

  const checks: GitHubAppReadinessCheck[] = [
    {
      id: "installation",
      label: "Repo installation",
      status: params.installation.ok ? "ready" : "missing",
      detail: params.installation.ok
        ? "GitHub App installation covers the disposable repo."
        : "GitHub App installation does not cover the disposable repo.",
      missing: params.installation.ok ? [] : ["repo_installation"],
      evidence: [
        `repo=${params.repo}`,
        params.installation.installationId
          ? `installationId=${params.installation.installationId}`
          : `status=${params.installation.status}`,
        params.installation.repositorySelection
          ? `repositorySelection=${params.installation.repositorySelection}`
          : "",
        params.installation.accountLogin
          ? `account=${params.installation.accountLogin}`
          : "",
      ].filter(Boolean),
    },
    {
      id: "event_subscriptions",
      label: "Event subscriptions",
      status: missingEvents.length === 0 ? "ready" : "missing",
      detail:
        missingEvents.length === 0
          ? "GitHub App subscribes to the background-agent event types."
          : "GitHub App must subscribe to pull request, issue, and deployment-status events.",
      missing: missingEvents,
      evidence: requiredEvents.map(
        (event) => `${event}=${events.has(event) ? "yes" : "no"}`,
      ),
    },
    {
      id: "permissions",
      label: "Repo permissions",
      status: missingPermissions.length === 0 ? "ready" : "missing",
      detail:
        missingPermissions.length === 0
          ? "GitHub App has the repo permissions needed for live proof."
          : "GitHub App is missing required repo permissions for live proof.",
      missing: missingPermissions,
      evidence: Object.keys(requiredPermissions).map(
        (permission) => `${permission}=${permissions[permission] ?? "missing"}`,
      ),
    },
  ];

  return {
    ready: checks.every((check) => check.status === "ready"),
    repo: params.repo,
    checks,
    notes: [
      "This command never prints GitHub App private keys, webhook secrets, or tokens.",
      "Event subscription changes must be made in GitHub App settings when sudo mode is required.",
    ],
  };
}

async function getAppJwt(env: Env): Promise<string> {
  const appId = requireEnv(env, "GITHUB_APP_ID");
  const privateKey = parsePrivateKey(requireEnv(env, "GITHUB_APP_PRIVATE_KEY"));
  const auth = createAppAuth({ appId, privateKey });
  const appAuth = await auth({ type: "app" });
  return appAuth.token;
}

async function fetchGitHubJson<T>(
  url: string,
  appJwt: string,
): Promise<{ ok: boolean; status: number; body: T | null }> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${appJwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  const body = response.ok ? ((await response.json()) as T) : null;
  return { ok: response.ok, status: response.status, body };
}

export async function runGitHubAppReadiness(params: {
  repo: string;
  env: Env;
}): Promise<GitHubAppReadinessResult> {
  const appJwt = await getAppJwt(params.env);
  const [owner, repoName] = params.repo.split("/");
  const [installationResponse, appResponse] = await Promise.all([
    fetchGitHubJson<{
      id?: number;
      repository_selection?: string | null;
      account?: { login?: string | null };
    }>(
      `https://api.github.com/repos/${owner}/${repoName}/installation`,
      appJwt,
    ),
    fetchGitHubJson<GitHubAppMetadata>("https://api.github.com/app", appJwt),
  ]);

  return assessGitHubAppReadiness({
    repo: params.repo,
    app: appResponse.body ?? {},
    installation: {
      ok: installationResponse.ok,
      status: installationResponse.status,
      installationId: installationResponse.body?.id,
      repositorySelection:
        installationResponse.body?.repository_selection ?? null,
      accountLogin: installationResponse.body?.account?.login ?? null,
    },
  });
}

function formatResult(result: GitHubAppReadinessResult): string {
  const lines = [
    "Background agents GitHub App readiness",
    `Repo: ${result.repo}`,
    `Status: ${result.ready ? "ready" : "missing prerequisites"}`,
    "",
  ];

  for (const check of result.checks) {
    lines.push(`${check.status === "ready" ? "OK" : "MISSING"} ${check.label}`);
    lines.push(`  ${check.detail}`);
    if (check.missing.length > 0) {
      lines.push(`  Missing: ${check.missing.join(", ")}`);
    }
    for (const evidence of check.evidence) {
      lines.push(`  ${evidence}`);
    }
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
    const options = parseArgs(argv);
    if (options.envFile) {
      loadEnv({ path: options.envFile, override: true });
    }
    const repo = parseRepo(
      options.repo ?? process.env.BACKGROUND_AGENT_GITHUB_APP_READINESS_REPO,
    );
    const result = await runGitHubAppReadiness({
      repo,
      env: process.env,
    });
    console.log(
      options.json ? JSON.stringify(result, null, 2) : formatResult(result),
    );
    return result.ready ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.main) {
  process.exit(await main());
}
