import { randomUUID } from "node:crypto";
import { redactOpsText } from "./ops-redaction";

type CanaryStatus =
  | "blocked_by_configuration"
  | "running"
  | "passed"
  | "failed"
  | "timed_out";

export interface CanaryConfig {
  targetUrl: string;
  testRepo: string;
  testIdentity: string;
  authCookie: string;
  timeoutMs: number;
}

export interface CanaryStep {
  name: string;
  status: CanaryStatus;
  evidence?: string;
  errorKind?: string;
}

export interface CanaryResult {
  requestId: string;
  status: CanaryStatus;
  targetUrl?: string;
  repo?: string;
  steps: CanaryStep[];
  sourceGap?: string;
}

function normalizeRepo(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  return /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(trimmed) ? trimmed : null;
}

export function readCanaryConfig(
  env: Record<string, string | undefined> = process.env,
): CanaryConfig | null {
  const targetUrl = env.PRODUCTION_CANARY_URL ?? env.PRODUCTION_URL;
  const testRepo = env.PRODUCTION_CANARY_REPO;
  const testIdentity = env.PRODUCTION_CANARY_IDENTITY;
  const authCookie = env.PRODUCTION_CANARY_AUTH_COOKIE;
  const timeoutMs = Number(env.PRODUCTION_CANARY_TIMEOUT_MS ?? "45000");
  if (!targetUrl || !testRepo || !testIdentity || !authCookie) {
    return null;
  }
  const normalizedRepo = normalizeRepo(testRepo);
  if (!normalizedRepo) {
    return null;
  }
  return {
    targetUrl,
    testRepo: normalizedRepo,
    testIdentity,
    authCookie,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 45_000,
  };
}

export function formatCanaryResult(result: CanaryResult): string {
  const lines = [
    "Production authenticated canary",
    `Request: ${result.requestId}`,
    `Status: ${result.status}`,
    ...(result.targetUrl ? [`Target: ${result.targetUrl}`] : []),
    ...(result.repo ? [`Repo: ${result.repo}`] : []),
    "",
  ];
  for (const step of result.steps) {
    lines.push(`${step.status} ${step.name}`);
    if (step.evidence) lines.push(`  ${redactOpsText(step.evidence)}`);
    if (step.errorKind) lines.push(`  errorKind=${step.errorKind}`);
  }
  if (result.sourceGap) {
    lines.push("");
    lines.push(`Source gap: ${result.sourceGap}`);
  }
  return lines.join("\n");
}

async function fetchJson(params: {
  url: string;
  cookie: string;
  signal: AbortSignal;
}): Promise<{ status: number; body: unknown }> {
  const response = await fetch(params.url, {
    headers: {
      Accept: "application/json",
      Cookie: params.cookie,
      "User-Agent": "open-agents-production-canary/1.0",
    },
    signal: params.signal,
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = await response.text();
  }
  return { status: response.status, body };
}

export async function runAuthenticatedCanary(
  config: CanaryConfig | null,
  requestId = randomUUID(),
): Promise<CanaryResult> {
  if (!config) {
    return {
      requestId,
      status: "blocked_by_configuration",
      steps: [],
      sourceGap:
        "Set PRODUCTION_CANARY_URL, PRODUCTION_CANARY_REPO, PRODUCTION_CANARY_IDENTITY, and PRODUCTION_CANARY_AUTH_COOKIE for the disposable test identity.",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const steps: CanaryStep[] = [];
  try {
    steps.push({ name: "auth", status: "running" });
    const account = await fetchJson({
      url: new URL("/api/account/status", config.targetUrl).toString(),
      cookie: config.authCookie,
      signal: controller.signal,
    });
    if (account.status !== 200) {
      steps[0] = {
        name: "auth",
        status: "failed",
        errorKind: "test_auth_missing",
        evidence: `account/status returned ${account.status}`,
      };
      return {
        requestId,
        status: "failed",
        targetUrl: config.targetUrl,
        repo: config.testRepo,
        steps,
      };
    }
    steps[0] = {
      name: "auth",
      status: "passed",
      evidence: "account/status accepted the test session.",
    };

    steps.push({ name: "diagnosis", status: "running" });
    const diagnosis = await fetchJson({
      url: new URL("/api/account/diagnosis", config.targetUrl).toString(),
      cookie: config.authCookie,
      signal: controller.signal,
    });
    steps[1] =
      diagnosis.status === 200
        ? {
            name: "diagnosis",
            status: "passed",
            evidence: "account diagnosis route returned readiness evidence.",
          }
        : {
            name: "diagnosis",
            status: "failed",
            errorKind: "github_installation_missing",
            evidence: `account/diagnosis returned ${diagnosis.status}`,
          };

    const status = steps.every((step) => step.status === "passed")
      ? "passed"
      : "failed";
    return {
      requestId,
      status,
      targetUrl: config.targetUrl,
      repo: config.testRepo,
      steps,
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      requestId,
      status: timedOut ? "timed_out" : "failed",
      targetUrl: config.targetUrl,
      repo: config.testRepo,
      steps,
      sourceGap: timedOut
        ? "poll_timeout"
        : redactOpsText(error instanceof Error ? error.message : String(error)),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runCanaryCli(): Promise<number> {
  const result = await runAuthenticatedCanary(readCanaryConfig());
  console.log(formatCanaryResult(result));
  return result.status === "passed" ||
    result.status === "blocked_by_configuration"
    ? 0
    : 1;
}

if (import.meta.main) {
  process.exit(await runCanaryCli());
}
