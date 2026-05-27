import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dirname, "../../..");

type VercelEnvironment = "production" | "preview" | "development";
type ReadinessStatus = "ready" | "missing";

interface VercelEnvScope {
  environment: VercelEnvironment;
  branch?: string;
}

export interface VercelEnvEntry {
  name: string;
  scopes: VercelEnvScope[];
}

interface Requirement {
  id: string;
  label: string;
  detail: string;
  all?: string[];
  any?: string[];
}

export interface EnvAuditCheck {
  id: string;
  label: string;
  status: ReadinessStatus;
  detail: string;
  missing: string[];
  empty: string[];
}

export interface EnvAuditResult {
  environment: VercelEnvironment;
  branch?: string;
  ready: boolean;
  missing: string[];
  checks: EnvAuditCheck[];
  notes: string[];
}

class EnvAuditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvAuditError";
  }
}

const requirements: Requirement[] = [
  {
    id: "feature_flag",
    label: "Feature flag",
    detail: "Enables trigger dispatch for the proof environment.",
    all: ["BACKGROUND_AGENTS_ENABLED"],
  },
  {
    id: "auth_database",
    label: "Auth and database",
    detail: "Required for Settings, sessions, and durable run persistence.",
    all: ["POSTGRES_URL", "BETTER_AUTH_SECRET"],
  },
  {
    id: "vercel_oauth",
    label: "Vercel sign-in",
    detail: "Required for authenticated operator access.",
    all: ["NEXT_PUBLIC_VERCEL_APP_CLIENT_ID", "VERCEL_APP_CLIENT_SECRET"],
  },
  {
    id: "github_oauth",
    label: "GitHub OAuth",
    detail: "Required for repo connection and PR creation.",
    all: ["NEXT_PUBLIC_GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
  },
  {
    id: "github_app",
    label: "GitHub App",
    detail: "Required for webhook trust and installation repo access.",
    all: [
      "GITHUB_APP_ID",
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_WEBHOOK_SECRET",
      "NEXT_PUBLIC_GITHUB_APP_SLUG",
    ],
  },
  {
    id: "cron_secret",
    label: "Cron dispatch secret",
    detail: "Required for scheduled trigger dispatch.",
    any: ["BACKGROUND_AGENTS_CRON_SECRET", "CRON_SECRET"],
  },
  {
    id: "webhook_secret",
    label: "Generic webhook secret",
    detail: "Required for signed webhook.error triggers.",
    all: ["BACKGROUND_AGENTS_WEBHOOK_SECRET"],
  },
];

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

function parseScope(value: string): VercelEnvScope | null {
  const match = /^(Production|Preview|Development)(?:\s+\(([^)]+)\))?$/.exec(
    value.trim(),
  );
  if (!match) {
    return null;
  }
  const environment = normalizeEnvironment(match[1] ?? "");
  if (!environment) {
    return null;
  }
  return {
    environment,
    ...(match[2] ? { branch: match[2] } : {}),
  };
}

function parseScopes(value: string): VercelEnvScope[] {
  return value
    .split(",")
    .map((part) => parseScope(part))
    .filter((scope): scope is VercelEnvScope => scope !== null);
}

export function parseVercelEnvLs(output: string): VercelEnvEntry[] {
  const entries: VercelEnvEntry[] = [];

  for (const line of output.split(/\r?\n/)) {
    const match =
      /^\s*([A-Z][A-Z0-9_]*)\s+\S+\s+(.+?)\s+\d+[smhdwy]?\s+ago\s*$/.exec(line);
    if (!match) {
      continue;
    }

    const scopes = parseScopes(match[2] ?? "");
    if (scopes.length === 0) {
      continue;
    }

    entries.push({
      name: match[1] ?? "",
      scopes,
    });
  }

  return entries;
}

function entryAppliesToTarget(
  entry: VercelEnvEntry,
  environment: VercelEnvironment,
  branch?: string,
): boolean {
  return entry.scopes.some((scope) => {
    if (scope.environment !== environment) {
      return false;
    }
    if (environment !== "preview" || !scope.branch) {
      return true;
    }
    return scope.branch === branch;
  });
}

function hasEnvName(
  entries: VercelEnvEntry[],
  name: string,
  environment: VercelEnvironment,
  branch?: string,
): boolean {
  return entries.some(
    (entry) =>
      entry.name === name && entryAppliesToTarget(entry, environment, branch),
  );
}

function unquoteDotenvValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseDotenvValuePresence(input: string): Set<string> {
  const present = new Set<string>();

  for (const line of input.split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) {
      continue;
    }
    const index = line.indexOf("=");
    if (index === -1) {
      continue;
    }
    const name = line.slice(0, index).trim();
    const value = unquoteDotenvValue(line.slice(index + 1));
    if (name && value.trim()) {
      present.add(name);
    }
  }

  return present;
}

function getMissingOrEmptyNames(params: {
  names: string[];
  entries: VercelEnvEntry[];
  environment: VercelEnvironment;
  branch?: string;
  presentValues?: Set<string>;
}) {
  const missing: string[] = [];
  const empty: string[] = [];

  for (const name of params.names) {
    const hasName = hasEnvName(
      params.entries,
      name,
      params.environment,
      params.branch,
    );
    if (!hasName) {
      missing.push(name);
      continue;
    }
    if (params.presentValues && !params.presentValues.has(name)) {
      empty.push(name);
    }
  }

  return { missing, empty };
}

export function auditVercelEnvNames(params: {
  entries: VercelEnvEntry[];
  environment: VercelEnvironment;
  branch?: string;
  presentValues?: Set<string>;
}): EnvAuditResult {
  const checks = requirements.map((requirement): EnvAuditCheck => {
    if (requirement.all) {
      const { missing, empty } = getMissingOrEmptyNames({
        names: requirement.all,
        entries: params.entries,
        environment: params.environment,
        branch: params.branch,
        presentValues: params.presentValues,
      });
      return {
        id: requirement.id,
        label: requirement.label,
        status:
          missing.length === 0 && empty.length === 0 ? "ready" : "missing",
        detail: requirement.detail,
        missing,
        empty,
      };
    }

    const anyNames = requirement.any ?? [];
    const configured = anyNames.some((name) => {
      const hasName = hasEnvName(
        params.entries,
        name,
        params.environment,
        params.branch,
      );
      return (
        hasName && (!params.presentValues || params.presentValues.has(name))
      );
    });
    const { missing, empty } = getMissingOrEmptyNames({
      names: anyNames,
      entries: params.entries,
      environment: params.environment,
      branch: params.branch,
      presentValues: params.presentValues,
    });

    return {
      id: requirement.id,
      label: requirement.label,
      status: configured ? "ready" : "missing",
      detail: requirement.detail,
      missing: configured ? [] : missing,
      empty: configured ? [] : empty,
    };
  });
  const missing = Array.from(
    new Set(checks.flatMap((check) => [...check.missing, ...check.empty])),
  ).sort();

  return {
    environment: params.environment,
    ...(params.branch ? { branch: params.branch } : {}),
    ready: checks.every((check) => check.status === "ready"),
    missing,
    checks,
    notes: [
      params.presentValues
        ? "Value presence was checked with a temporary Vercel env pull; values were not printed and the temp file was deleted."
        : "This audit checks Vercel env names only; it never reads or prints secret values.",
      params.presentValues
        ? "Empty means Vercel env pull returned a blank value; confirm in Vercel UI or the hosted readiness route before live proof."
        : "Use --verify-values to check for blank pulled values without printing them.",
      "Set BACKGROUND_AGENTS_ALLOWED_REPOS=owner/repo to limit production proof to a disposable repository.",
      "Sandbox runtime and AI Gateway OIDC readiness are verified by the hosted readiness route.",
    ],
  };
}

function parseArgs(argv: string[]) {
  let environment: VercelEnvironment = "preview";
  let branch: string | undefined;
  let input: string | undefined;
  let json = false;
  let verifyValues = false;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--environment") {
      if (!next) {
        throw new EnvAuditError("--environment requires a value.");
      }
      const parsed = normalizeEnvironment(next);
      if (!parsed) {
        throw new EnvAuditError(
          "--environment must be production, preview, or development.",
        );
      }
      environment = parsed;
      index++;
      continue;
    }

    if (arg === "--branch") {
      if (!next) {
        throw new EnvAuditError("--branch requires a value.");
      }
      branch = next;
      index++;
      continue;
    }

    if (arg === "--input") {
      if (!next) {
        throw new EnvAuditError("--input requires a file path.");
      }
      input = next;
      index++;
      continue;
    }

    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "--verify-values") {
      verifyValues = true;
      continue;
    }

    throw new EnvAuditError(`Unknown argument: ${arg}`);
  }

  return { environment, branch, input, json, verifyValues };
}

function readVercelEnvLs(input?: string): string {
  if (input) {
    return readFileSync(input, "utf8");
  }

  const result = spawnSync("vercel", ["env", "ls"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  if (result.status !== 0) {
    throw new EnvAuditError(output.trim() || "Failed to run `vercel env ls`.");
  }

  return output;
}

function readPulledEnvValuePresence(params: {
  environment: VercelEnvironment;
  branch?: string;
}): Set<string> {
  const tempDir = mkdtempSync(join(tmpdir(), "open-agents-env-audit-"));
  const tempFile = join(tempDir, ".env.audit");
  const args = [
    "env",
    "pull",
    tempFile,
    "--environment",
    params.environment,
    "--yes",
  ];
  if (params.branch) {
    args.push("--git-branch", params.branch);
  }

  try {
    const result = spawnSync("vercel", args, {
      cwd: repoRoot,
      encoding: "utf8",
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    if (result.status !== 0) {
      throw new EnvAuditError(
        output.trim() || "Failed to run `vercel env pull`.",
      );
    }

    return parseDotenvValuePresence(readFileSync(tempFile, "utf8"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function formatAudit(result: EnvAuditResult): string {
  const lines = [
    "Background agents Vercel env audit",
    `Target: ${result.environment}${result.branch ? ` (${result.branch})` : ""}`,
    `Status: ${result.ready ? "ready" : "missing prerequisites"}`,
    "",
  ];

  for (const check of result.checks) {
    lines.push(`${check.status === "ready" ? "OK" : "MISSING"} ${check.label}`);
    lines.push(`  ${check.detail}`);
    if (check.missing.length > 0) {
      lines.push(`  Missing: ${check.missing.join(", ")}`);
    }
    if (check.empty.length > 0) {
      lines.push(`  Empty: ${check.empty.join(", ")}`);
    }
  }

  lines.push("");
  for (const note of result.notes) {
    lines.push(`Note: ${note}`);
  }

  return lines.join("\n");
}

export function runEnvAudit(argv = process.argv.slice(2)): number {
  try {
    const args = parseArgs(argv);
    const output = readVercelEnvLs(args.input);
    const presentValues = args.verifyValues
      ? readPulledEnvValuePresence({
          environment: args.environment,
          branch: args.branch,
        })
      : undefined;
    const result = auditVercelEnvNames({
      entries: parseVercelEnvLs(output),
      environment: args.environment,
      branch: args.branch,
      presentValues,
    });

    console.log(
      args.json ? JSON.stringify(result, null, 2) : formatAudit(result),
    );
    return result.ready ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.main) {
  process.exit(runEnvAudit());
}
