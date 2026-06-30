import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type EnvironmentName = "production" | "preview" | "development" | "dev";
type IsolationStatus =
  | "isolated"
  | "isolation_violation"
  | "missing"
  | "unverified_sensitive_value";

export interface EnvFingerprint {
  name: string;
  status: IsolationStatus;
  production?: string;
  compare?: string;
  detail: string;
}

const repoRoot = join(import.meta.dirname, "../../..");

const criticalNames = [
  "POSTGRES_URL",
  "DATABASE_URL",
  "REDIS_URL",
  "KV_URL",
  "KV_REST_API_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL",
  "NEXT_PUBLIC_VERCEL_APP_CLIENT_ID",
  "VERCEL_APP_CLIENT_SECRET",
  "NEXT_PUBLIC_GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "NEXT_PUBLIC_GITHUB_APP_SLUG",
  "GITHUB_WEBHOOK_SECRET",
] as const;

const mustDiffer = new Set([
  "POSTGRES_URL",
  "DATABASE_URL",
  "REDIS_URL",
  "KV_URL",
  "KV_REST_API_URL",
]);

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function parseDotenvValues(input: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of input.split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const name = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (name) values.set(name, value);
  }
  return values;
}

export function compareEnvFingerprints(params: {
  production: Map<string, string>;
  compare: Map<string, string>;
  compareEnvironment: string;
  names?: readonly string[];
}): EnvFingerprint[] {
  const names = params.names ?? criticalNames;
  return names.map((name) => {
    const production = params.production.get(name);
    const compare = params.compare.get(name);
    if (!production || !compare) {
      return {
        name,
        status: "missing",
        detail: `Missing ${!production ? "production" : params.compareEnvironment} value.`,
      };
    }
    const productionHash = fingerprint(production);
    const compareHash = fingerprint(compare);
    if (mustDiffer.has(name) && productionHash === compareHash) {
      return {
        name,
        status: "isolation_violation",
        production: productionHash,
        compare: compareHash,
        detail: `${name} matches production but must differ for safe destructive tests.`,
      };
    }
    return {
      name,
      status:
        productionHash === compareHash
          ? "unverified_sensitive_value"
          : "isolated",
      production: productionHash,
      compare: compareHash,
      detail:
        productionHash === compareHash
          ? `${name} matches production; manually confirm this shared value is intentional.`
          : `${name} differs from production.`,
    };
  });
}

export function formatEnvIsolationReport(params: {
  compareEnvironment: string;
  results: EnvFingerprint[];
}): string {
  const hasViolation = params.results.some(
    (result) => result.status === "isolation_violation",
  );
  const lines = [
    "Production env isolation audit",
    `Compare: ${params.compareEnvironment} vs production`,
    `Status: ${hasViolation ? "isolation_violation" : "isolated_or_unverified"}`,
    "",
  ];
  for (const result of params.results) {
    lines.push(`${result.status} ${result.name}`);
    lines.push(`  ${result.detail}`);
    if (result.production && result.compare) {
      lines.push(
        `  fingerprints: production=${result.production} compare=${result.compare}`,
      );
    }
  }
  lines.push("");
  lines.push(
    "No raw env values were printed. Temporary pull files were deleted.",
  );
  return lines.join("\n");
}

function pullEnv(
  environment: EnvironmentName,
  branch?: string,
): Map<string, string> {
  const tempDir = mkdtempSync(join(tmpdir(), "open-agents-env-isolation-"));
  const tempFile = join(tempDir, ".env.audit");
  const args = ["env", "pull", tempFile, "--environment", environment, "--yes"];
  if (branch) args.push("--git-branch", branch);
  try {
    const result = spawnSync("vercel", args, {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 30_000,
    });
    if (result.status !== 0) {
      throw new Error(
        result.stderr || result.stdout || "vercel env pull failed.",
      );
    }
    return parseDotenvValues(readFileSync(tempFile, "utf8"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function parseArgs(argv: string[]) {
  let compareEnvironment: EnvironmentName = "preview";
  let branch: string | undefined;
  let json = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--compare") {
      if (!next) throw new Error("--compare requires an environment.");
      compareEnvironment = next as EnvironmentName;
      index++;
      continue;
    }
    if (arg === "--branch") {
      if (!next) throw new Error("--branch requires a value.");
      branch = next;
      index++;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return { compareEnvironment, branch, json };
}

export function runEnvIsolation(argv = process.argv.slice(2)): number {
  try {
    const args = parseArgs(argv);
    const production = pullEnv("production");
    const compare = pullEnv(args.compareEnvironment, args.branch);
    const results = compareEnvFingerprints({
      production,
      compare,
      compareEnvironment: args.compareEnvironment,
    });
    console.log(
      args.json
        ? JSON.stringify(
            { compareEnvironment: args.compareEnvironment, results },
            null,
            2,
          )
        : formatEnvIsolationReport({
            compareEnvironment: args.compareEnvironment,
            results,
          }),
    );
    return results.some((result) => result.status === "isolation_violation")
      ? 1
      : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.main) {
  process.exit(runEnvIsolation());
}
