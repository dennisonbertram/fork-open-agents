/**
 * Background agent full journey proof harness.
 *
 * Drives the full first-time background-agent journey end-to-end: create a
 * disposable agent, confirm it starts disabled, enable it, dispatch a manual
 * test (reusing background-agent-test-proof.ts's dispatch/poll core), poll
 * the resulting run to a terminal status within a deadline, assert it is
 * real proof (not a false positive), and delete the agent whether the run
 * passed or failed. Complements background-agent-test-proof.ts, which
 * requires an existing, already-enabled agent — this harness proves
 * create -> enable -> run -> cleanup as one sequence.
 *
 * Flow:
 *   1. POST /api/background-agents (create a disposable agent).
 *   2. Confirm it starts disabled.
 *   3. PATCH /api/background-agents/[agentId] (enable it).
 *   4. Reuse dispatchAndPollToTerminal (dispatch + poll to terminal status).
 *   5. Assert the run is real proof via assertProofRun.
 *   6. DELETE /api/background-agents/[agentId] in a finally block, then
 *      confirm via GET /api/background-agents that it no longer appears.
 *
 * Required env:
 *   BACKGROUND_AGENT_PROOF_BASE_URL       http(s) target origin
 *   BACKGROUND_AGENT_PROOF_COOKIE         authenticated session cookie
 *                                         (e.g. open_agents_test_user_id=<user>)
 *   BACKGROUND_AGENT_JOURNEY_REPO_OWNER   disposable repo owner (no default —
 *                                         never point this at a real repo)
 *   BACKGROUND_AGENT_JOURNEY_REPO_NAME    disposable repo name
 *
 * Optional env:
 *   BACKGROUND_AGENT_JOURNEY_TIMEOUT_MS       run-completion timeout (default 120000)
 *   BACKGROUND_AGENT_PROOF_POLL_MS            poll interval (default 2000)
 *   BACKGROUND_AGENT_PROOF_REQUIRE_SUCCEEDED  require status===succeeded (default false)
 *   VERCEL_AUTOMATION_BYPASS_SECRET           preview protection bypass
 *
 * Usage:
 *   bun run --cwd apps/web background-agents:journey-proof
 *
 * Exit codes:
 *   0 - the journey passed (cleanup may still have failed — see the
 *       WARNING line and the journey-summary JSON's "cleanup" field).
 *   1 - any journey step failed (a run that never reaches a terminal status
 *       by the deadline is a FAILURE, never a success), or the journey
 *       failed and cleanup also failed.
 *
 * A cleanup failure AFTER a passing journey is a loud WARNING, not a
 * failure exit — see docs/process/background-agents-live-proof.md.
 */
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  assertProofRun,
  buildProofAuthHeaders,
  dispatchAndPollToTerminal,
  getBaseUrl,
  summarizeRun,
  type TestProofConfig,
} from "./background-agent-test-proof";

const appRoot = join(import.meta.dirname, "..");
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_MS = 2_000;
const REQUEST_TIMEOUT_MS = 20_000;

type Env = Record<string, string | undefined>;

export class BackgroundAgentJourneyProofError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackgroundAgentJourneyProofError";
  }
}

export interface JourneyConfig {
  baseUrl: URL;
  cookie: string;
  repoOwner: string;
  repoName: string;
  timeoutMs: number;
  pollIntervalMs: number;
  requireSucceeded: boolean;
  bypassSecret?: string;
}

export interface JourneySummary {
  agentId: string | null;
  runId: string | null;
  runStatus: string | null;
  errorKind: string | null;
  elapsedMs: number;
  journey: "passed" | "failed";
  cleanup: "deleted" | "failed" | "skipped";
  failedStep: string | null;
  failureMessage: string | null;
}

interface CreatedAgent {
  id: string;
  status: string;
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
    throw new BackgroundAgentJourneyProofError(`${name} is required.`);
  }
  return value;
}

function optionalEnv(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value || undefined;
}

function parseBoolean(value: string | undefined, defaultValue: boolean) {
  if (!value) {
    return defaultValue;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parsePositiveInt(
  value: string | undefined,
  defaultValue: number,
  label: string,
): number {
  if (!value) {
    return defaultValue;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BackgroundAgentJourneyProofError(
      `${label} must be a positive integer.`,
    );
  }
  return parsed;
}

export function getJourneyConfig(env: Env): JourneyConfig {
  let baseUrl: URL;
  try {
    baseUrl = getBaseUrl(env);
  } catch {
    throw new BackgroundAgentJourneyProofError(
      "BACKGROUND_AGENT_PROOF_BASE_URL must be a valid http(s) URL.",
    );
  }
  return {
    baseUrl,
    cookie: requireEnv(env, "BACKGROUND_AGENT_PROOF_COOKIE"),
    repoOwner: requireEnv(env, "BACKGROUND_AGENT_JOURNEY_REPO_OWNER"),
    repoName: requireEnv(env, "BACKGROUND_AGENT_JOURNEY_REPO_NAME"),
    timeoutMs: parsePositiveInt(
      env.BACKGROUND_AGENT_JOURNEY_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      "BACKGROUND_AGENT_JOURNEY_TIMEOUT_MS",
    ),
    pollIntervalMs: parsePositiveInt(
      env.BACKGROUND_AGENT_PROOF_POLL_MS,
      DEFAULT_POLL_MS,
      "BACKGROUND_AGENT_PROOF_POLL_MS",
    ),
    requireSucceeded: parseBoolean(
      env.BACKGROUND_AGENT_PROOF_REQUIRE_SUCCEEDED,
      false,
    ),
    bypassSecret: optionalEnv(env, "VERCEL_AUTOMATION_BYPASS_SECRET"),
  };
}

export function buildJourneyAgentPayload(params: {
  repoOwner: string;
  repoName: string;
  now?: Date;
}): unknown {
  const now = params.now ?? new Date();
  return {
    name: `Journey proof ${now.toISOString()}`.slice(0, 100),
    description:
      "Disposable agent created by background-agents:journey-proof — safe to delete.",
    repoOwner: params.repoOwner,
    repoName: params.repoName,
    instructions:
      "Journey proof: report the repository status. Do not modify any files, branches, PRs, or issues.",
    permissions: {},
    githubActions: {},
    triggers: [
      {
        name: "journey-proof-manual",
        kind: "github.issue",
        conditions: { labels: ["journey-proof-never"] },
      },
    ],
  };
}

export function parseCreatedAgent(value: unknown): CreatedAgent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BackgroundAgentJourneyProofError(
      "Create response was not an object.",
    );
  }
  const body = value as Record<string, unknown>;
  const agent = body.agent;
  if (!agent || typeof agent !== "object" || Array.isArray(agent)) {
    throw new BackgroundAgentJourneyProofError(
      "Create response is missing the agent object.",
    );
  }
  const record = agent as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.status !== "string") {
    throw new BackgroundAgentJourneyProofError(
      "Create response has an invalid agent id/status.",
    );
  }
  return { id: record.id, status: record.status };
}

export function assertAgentDisabled(agent: CreatedAgent): void {
  if (agent.status !== "disabled") {
    throw new BackgroundAgentJourneyProofError(
      `Agent ${agent.id} did not start disabled (status=${agent.status}).`,
    );
  }
}

export function assertAgentEnabled(agent: CreatedAgent): void {
  if (agent.status !== "enabled") {
    throw new BackgroundAgentJourneyProofError(
      `Agent ${agent.id} was not enabled (status=${agent.status}).`,
    );
  }
}

export function parseAgentListIds(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BackgroundAgentJourneyProofError(
      "Agent list response was not an object.",
    );
  }
  const body = value as Record<string, unknown>;
  const agents = body.agents;
  if (!Array.isArray(agents)) {
    throw new BackgroundAgentJourneyProofError(
      "Agent list response is missing the agents array.",
    );
  }
  return agents
    .map((agent) => {
      if (agent && typeof agent === "object" && !Array.isArray(agent)) {
        const record = agent as Record<string, unknown>;
        return typeof record.id === "string" ? record.id : null;
      }
      return null;
    })
    .filter((id): id is string => id !== null);
}

function toTestProofConfig(
  config: JourneyConfig,
  agentId: string,
): TestProofConfig {
  return {
    baseUrl: config.baseUrl,
    agentId,
    cookie: config.cookie,
    timeoutMs: config.timeoutMs,
    pollIntervalMs: config.pollIntervalMs,
    requireSucceeded: config.requireSucceeded,
    bypassSecret: config.bypassSecret,
  };
}

async function fetchJson(
  url: URL,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<{ status: number; parsed: unknown }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
    const body = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body) as unknown;
    } catch {
      parsed = undefined;
    }
    return { status: response.status, parsed };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new BackgroundAgentJourneyProofError(
        `Request to ${url.toString()} timed out after ${REQUEST_TIMEOUT_MS}ms.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function errorMessageFromBody(status: number, parsed: unknown): string {
  if (parsed && typeof parsed === "object" && "error" in parsed) {
    return String((parsed as { error: unknown }).error);
  }
  return `status ${status}`;
}

/**
 * Best-effort cleanup, isolated in its own function (rather than inline in a
 * `finally` block) so a cleanup failure can never mask or overwrite the
 * journey's own outcome/error.
 */
async function cleanupAgent(
  config: JourneyConfig,
  agentId: string,
  fetchImpl: typeof fetch,
  log: (line: string) => void,
): Promise<"deleted" | "failed"> {
  try {
    const deleteResult = await fetchJson(
      new URL(`/api/background-agents/${agentId}`, config.baseUrl),
      { method: "DELETE", headers: buildProofAuthHeaders(config) },
      fetchImpl,
    );
    if (deleteResult.status < 200 || deleteResult.status >= 300) {
      throw new BackgroundAgentJourneyProofError(
        `Delete background agent failed with ${errorMessageFromBody(deleteResult.status, deleteResult.parsed)}.`,
      );
    }
    const listResult = await fetchJson(
      new URL("/api/background-agents", config.baseUrl),
      { method: "GET", headers: buildProofAuthHeaders(config) },
      fetchImpl,
    );
    const remainingIds = parseAgentListIds(listResult.parsed);
    const verifiedAbsent = !remainingIds.includes(agentId);
    log(
      `cleanup: agentId=${agentId} deleted=true verifiedAbsent=${verifiedAbsent}`,
    );
    if (!verifiedAbsent) {
      throw new BackgroundAgentJourneyProofError(
        `Delete background agent returned success but agent ${agentId} still appears in the agent list (absence check failed).`,
      );
    }
    return "deleted";
  } catch (cleanupError) {
    const message =
      cleanupError instanceof Error
        ? cleanupError.message
        : String(cleanupError);
    log(
      `WARNING: cleanup failed — manually delete agent ${agentId} (${message})`,
    );
    return "failed";
  }
}

export async function runJourney(
  config: JourneyConfig,
  deps?: { fetchImpl?: typeof fetch; log?: (line: string) => void },
): Promise<JourneySummary> {
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const log = deps?.log ?? console.log;
  const startedAt = Date.now();

  let agentId: string | null = null;
  let runId: string | null = null;
  let runStatus: string | null = null;
  let errorKind: string | null = null;
  let journey: "passed" | "failed" = "failed";
  let failedStep: string | null = null;
  let failureMessage: string | null = null;
  let cleanup: "deleted" | "failed" | "skipped" = "skipped";

  try {
    // 1. create
    const createHeaders = buildProofAuthHeaders(config);
    const createPayload = buildJourneyAgentPayload({
      repoOwner: config.repoOwner,
      repoName: config.repoName,
    });
    const createResult = await fetchJson(
      new URL("/api/background-agents", config.baseUrl),
      {
        method: "POST",
        headers: createHeaders,
        body: JSON.stringify(createPayload),
      },
      fetchImpl,
    );
    if (createResult.status < 200 || createResult.status >= 300) {
      failedStep = "create";
      throw new BackgroundAgentJourneyProofError(
        `Create background agent failed with ${errorMessageFromBody(createResult.status, createResult.parsed)}.`,
      );
    }
    const created = parseCreatedAgent(createResult.parsed);
    agentId = created.id;
    log(
      `create: agentId=${created.id} status=${created.status} repo=${config.repoOwner}/${config.repoName}`,
    );

    // 2. confirm-disabled
    failedStep = "confirm-disabled";
    assertAgentDisabled(created);
    log(`confirm-disabled: agentId=${created.id} status=disabled`);

    // 3. enable
    failedStep = "enable";
    const enableResult = await fetchJson(
      new URL(`/api/background-agents/${created.id}`, config.baseUrl),
      {
        method: "PATCH",
        headers: buildProofAuthHeaders(config),
        body: JSON.stringify({ status: "enabled" }),
      },
      fetchImpl,
    );
    if (enableResult.status < 200 || enableResult.status >= 300) {
      throw new BackgroundAgentJourneyProofError(
        `Enable background agent failed with ${errorMessageFromBody(enableResult.status, enableResult.parsed)}.`,
      );
    }
    const enabled = parseCreatedAgent(enableResult.parsed);
    assertAgentEnabled(enabled);
    log(`enable: agentId=${enabled.id} status=enabled`);

    // 4. dispatch + poll (reuses the existing script's evidence lines)
    failedStep = "dispatch+poll";
    const { snapshot } = await dispatchAndPollToTerminal(
      toTestProofConfig(config, created.id),
      {
        requestId: `journey-proof-${randomUUID()}`,
        log,
        fetchImpl,
      },
    );
    runId = snapshot.run.id;
    runStatus = snapshot.run.status;
    errorKind = snapshot.run.errorKind ?? null;

    // 5. assert
    failedStep = "assert";
    log(summarizeRun(snapshot, Date.now() - startedAt));
    assertProofRun(snapshot, { requireSucceeded: config.requireSucceeded });

    journey = "passed";
    failedStep = null;
  } catch (error) {
    journey = "failed";
    failureMessage = error instanceof Error ? error.message : String(error);
  } finally {
    if (agentId) {
      cleanup = await cleanupAgent(config, agentId, fetchImpl, log);
    }
  }

  const summary: JourneySummary = {
    agentId,
    runId,
    runStatus,
    errorKind,
    elapsedMs: Date.now() - startedAt,
    journey,
    cleanup,
    failedStep,
    failureMessage,
  };
  log(`journey-summary: ${JSON.stringify(summary)}`);
  return summary;
}

async function main(): Promise<void> {
  loadLocalEnv();
  const config = getJourneyConfig(process.env);
  const summary = await runJourney(config);
  process.exit(summary.journey === "passed" ? 0 : 1);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Background agent journey proof failed: ${message}`);
    process.exit(1);
  });
}
