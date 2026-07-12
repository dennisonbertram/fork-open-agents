import { randomUUID } from "node:crypto";
import { redactOpsText } from "./ops-redaction";

export type CanaryStatus =
  | "blocked_by_configuration"
  | "running"
  | "passed"
  | "failed"
  | "timed_out";

export type CanaryClassification =
  | "passed"
  | "failed"
  | "blocked_by_configuration";

export type CanaryExitCode = 0 | 1 | 2;

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

export function isCanaryConfigRequired(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.PRODUCTION_CANARY_REQUIRE_CONFIG?.trim().toLowerCase() === "true";
}

export function classifyCanaryStatus(
  status: CanaryStatus,
): CanaryClassification {
  if (status === "passed") {
    return "passed";
  }
  if (status === "blocked_by_configuration") {
    return "blocked_by_configuration";
  }
  return "failed";
}

export function canaryExitCodeForStatus(
  status: CanaryStatus,
  requireConfig: boolean,
): CanaryExitCode {
  const classification = classifyCanaryStatus(status);
  if (classification === "passed") {
    return 0;
  }
  if (classification === "blocked_by_configuration") {
    return requireConfig ? 2 : 0;
  }
  return 1;
}

function normalizeRepo(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  return /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(trimmed) ? trimmed : null;
}

function normalizeTargetUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

export function readCanaryConfig(
  env: Record<string, string | undefined> = process.env,
): CanaryConfig | null {
  const targetUrl = env.PRODUCTION_CANARY_URL ?? env.PRODUCTION_URL;
  const testRepo = env.PRODUCTION_CANARY_REPO;
  const testIdentity = env.PRODUCTION_CANARY_IDENTITY;
  const authCookie = env.PRODUCTION_CANARY_AUTH_COOKIE;
  const timeoutMs = Number(env.PRODUCTION_CANARY_TIMEOUT_MS ?? "45000");
  if (!targetUrl || !testRepo || !testIdentity?.trim() || !authCookie?.trim()) {
    return null;
  }
  const normalizedTargetUrl = normalizeTargetUrl(targetUrl);
  const normalizedRepo = normalizeRepo(testRepo);
  if (!normalizedTargetUrl || !normalizedRepo) {
    return null;
  }
  const normalizedTimeoutMs = Number(timeoutMs);
  if (!Number.isFinite(normalizedTimeoutMs) || normalizedTimeoutMs <= 0) {
    return null;
  }
  return {
    targetUrl: normalizedTargetUrl,
    testRepo: normalizedRepo,
    testIdentity: testIdentity.trim(),
    authCookie: authCookie.trim(),
    timeoutMs: normalizedTimeoutMs,
  };
}

export function formatCanaryResult(result: CanaryResult): string {
  const classification = classifyCanaryStatus(result.status);
  const lines = [
    "Production authenticated canary",
    `Request: ${result.requestId}`,
    `Status: ${result.status}`,
    `Classification: ${classification}`,
    ...(classification === "blocked_by_configuration"
      ? ["Proof: No production proof occurred."]
      : []),
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

const diagnosisSections = [
  "needsAttention",
  "running",
  "recentlyCompleted",
  "waitingOnUser",
  "stale",
] as const;

const diagnosisSources = new Set([
  "session",
  "chat_workflow",
  "background_agent",
  "agent_loop",
]);

export function findDiagnosisHref(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const snapshot = body as Record<string, unknown>;
  for (const section of diagnosisSections) {
    const items = snapshot[section];
    if (!Array.isArray(items)) {
      continue;
    }

    for (const item of items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }
      const href = (item as Record<string, unknown>).diagnosisHref;
      if (typeof href !== "string") {
        continue;
      }

      try {
        const url = new URL(href, "https://canary.invalid");
        const source = url.searchParams.get("source");
        const id = url.searchParams.get("id");
        if (
          url.origin === "https://canary.invalid" &&
          url.pathname === "/api/account/diagnosis" &&
          source &&
          diagnosisSources.has(source) &&
          id
        ) {
          return `${url.pathname}${url.search}`;
        }
      } catch {
        continue;
      }
    }
  }

  return null;
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

    const diagnosisHref = findDiagnosisHref(account.body);
    if (!diagnosisHref) {
      steps.push({
        name: "diagnosis",
        status: "passed",
        evidence:
          "Account snapshot is healthy and has no diagnosable work item yet.",
      });
      return {
        requestId,
        status: "passed",
        targetUrl: config.targetUrl,
        repo: config.testRepo,
        steps,
      };
    }

    steps.push({ name: "diagnosis", status: "running" });
    const diagnosis = await fetchJson({
      url: new URL(diagnosisHref, config.targetUrl).toString(),
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
            errorKind: "account_diagnosis_unavailable",
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

export async function runCanaryCli(deps?: {
  env?: Record<string, string | undefined>;
  log?: (line: string) => void;
}): Promise<CanaryExitCode> {
  const env = deps?.env ?? process.env;
  const log = deps?.log ?? console.log;
  const result = await runAuthenticatedCanary(readCanaryConfig(env));
  log(formatCanaryResult(result));
  return canaryExitCodeForStatus(result.status, isCanaryConfigRequired(env));
}

if (import.meta.main) {
  process.exit(await runCanaryCli());
}
