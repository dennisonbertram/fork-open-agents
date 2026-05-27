import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

export function auditVercelEnvNames(params: {
  entries: VercelEnvEntry[];
  environment: VercelEnvironment;
  branch?: string;
}): EnvAuditResult {
  const checks = requirements.map((requirement): EnvAuditCheck => {
    if (requirement.all) {
      const missing = requirement.all.filter(
        (name) =>
          !hasEnvName(params.entries, name, params.environment, params.branch),
      );
      return {
        id: requirement.id,
        label: requirement.label,
        status: missing.length === 0 ? "ready" : "missing",
        detail: requirement.detail,
        missing,
      };
    }

    const anyNames = requirement.any ?? [];
    const configured = anyNames.some((name) =>
      hasEnvName(params.entries, name, params.environment, params.branch),
    );

    return {
      id: requirement.id,
      label: requirement.label,
      status: configured ? "ready" : "missing",
      detail: requirement.detail,
      missing: configured ? [] : anyNames,
    };
  });
  const missing = Array.from(
    new Set(checks.flatMap((check) => check.missing)),
  ).sort();

  return {
    environment: params.environment,
    ...(params.branch ? { branch: params.branch } : {}),
    ready: checks.every((check) => check.status === "ready"),
    missing,
    checks,
    notes: [
      "This audit checks Vercel env names only; it never reads or prints secret values.",
      "Sandbox runtime and AI Gateway OIDC readiness are verified by the hosted readiness route.",
    ],
  };
}

function parseArgs(argv: string[]) {
  let environment: VercelEnvironment = "preview";
  let branch: string | undefined;
  let input: string | undefined;
  let json = false;

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

    throw new EnvAuditError(`Unknown argument: ${arg}`);
  }

  return { environment, branch, input, json };
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
    const result = auditVercelEnvNames({
      entries: parseVercelEnvLs(output),
      environment: args.environment,
      branch: args.branch,
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
