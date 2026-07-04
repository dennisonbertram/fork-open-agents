/**
 * Background agent manual-test proof harness.
 *
 * Drives the deployed (or local) manual-test trigger end-to-end and asserts a
 * durable run reaches a terminal status within a timeout — the CI-gated smoke
 * the background-agent review called for. Complements the webhook-proof and
 * github-webhook-proof harnesses, which prove trigger delivery + idempotency
 * but do not wait for the run to complete.
 *
 * Flow:
 *   1. POST /api/background-agents/[agentId]/test with an authenticated cookie.
 *   2. Assert the dispatch created a durable run (enabled + matched + created).
 *   3. Poll GET /api/background-agent-runs/[runId] until a terminal status or
 *      timeout.
 *   4. Print evidence: run id, final status, errorKind, event count, output PR
 *      URL, elapsed time. Never prints the cookie or any secret.
 *
 * Required env:
 *   BACKGROUND_AGENT_PROOF_BASE_URL      http(s) target origin
 *   BACKGROUND_AGENT_PROOF_AGENT_ID      existing background agent id to test
 *   BACKGROUND_AGENT_PROOF_COOKIE        authenticated session cookie
 *                                        (e.g. open_agents_test_user_id=<user>)
 *
 * Optional env:
 *   BACKGROUND_AGENT_PROOF_TIMEOUT_MS    run-completion timeout (default 120000)
 *   BACKGROUND_AGENT_PROOF_POLL_MS       poll interval (default 2000)
 *   VERCEL_AUTOMATION_BYPASS_SECRET      preview protection bypass
 *
 * Usage:
 *   bun run --cwd apps/web background-agents:test-proof
 *
 * Exits 0 when the run reaches a terminal status, 1 on any proof failure.
 * A failed run status is still proof success (the path ran end-to-end and
 * recorded a typed failure) unless REQUIRE_SUCCEEDED is set.
 */
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const appRoot = join(import.meta.dirname, "..");
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_MS = 2_000;
const REQUEST_TIMEOUT_MS = 20_000;

const TERMINAL_STATUSES = new Set([
  "succeeded",
  "failed",
  "skipped",
  "cancelled",
]);

export interface TestProofConfig {
  baseUrl: URL;
  agentId: string;
  cookie: string;
  timeoutMs: number;
  pollIntervalMs: number;
  requireSucceeded: boolean;
  bypassSecret?: string;
}

export interface TestDispatchResult {
  enabled: boolean;
  matched: number;
  created: number;
  duplicates: number;
  runIds: string[];
}

export interface RunSnapshot {
  run: {
    id: string;
    status: string;
    errorKind?: string | null;
    outputUrl?: string | null;
  };
  events: unknown[];
  /** Event names extracted from `events[*].eventName`, in order. Exposed so
   * proof assertions can require execution-path evidence (e.g. that the
   * workflow actually started) without callers re-parsing the raw events. */
  eventNames: string[];
  outputs: unknown[];
}

type Env = Record<string, string | undefined>;

export class BackgroundAgentTestProofError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackgroundAgentTestProofError";
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
    throw new BackgroundAgentTestProofError(`${name} is required.`);
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
    throw new BackgroundAgentTestProofError(
      `${label} must be a positive integer.`,
    );
  }
  return parsed;
}

export function getBaseUrl(env: Env): URL {
  const rawUrl = requireEnv(env, "BACKGROUND_AGENT_PROOF_BASE_URL");
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new BackgroundAgentTestProofError(
        "BACKGROUND_AGENT_PROOF_BASE_URL must be an http(s) URL.",
      );
    }
    return url;
  } catch (error) {
    if (error instanceof BackgroundAgentTestProofError) {
      throw error;
    }
    throw new BackgroundAgentTestProofError(
      "BACKGROUND_AGENT_PROOF_BASE_URL is not a valid URL.",
    );
  }
}

export function getProofConfig(env: Env): TestProofConfig {
  return {
    baseUrl: getBaseUrl(env),
    agentId: requireEnv(env, "BACKGROUND_AGENT_PROOF_AGENT_ID"),
    cookie: requireEnv(env, "BACKGROUND_AGENT_PROOF_COOKIE"),
    timeoutMs: parsePositiveInt(
      env.BACKGROUND_AGENT_PROOF_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      "BACKGROUND_AGENT_PROOF_TIMEOUT_MS",
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

export function buildProofAuthHeaders(
  config: Pick<TestProofConfig, "cookie" | "bypassSecret">,
): Headers {
  const headers = new Headers({
    "Content-Type": "application/json",
    "User-Agent": "open-agents-background-agent-test-proof/1.0",
    Cookie: config.cookie,
  });
  if (config.bypassSecret) {
    headers.set("x-vercel-protection-bypass", config.bypassSecret);
    headers.set("x-vercel-set-bypass-cookie", "true");
  }
  return headers;
}

function testEndpoint(config: TestProofConfig): URL {
  return new URL(
    `/api/background-agents/${config.agentId}/test`,
    config.baseUrl,
  );
}

function runEndpoint(config: TestProofConfig, runId: string): URL {
  return new URL(`/api/background-agent-runs/${runId}`, config.baseUrl);
}

export function parseTestDispatchResult(value: unknown): TestDispatchResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BackgroundAgentTestProofError(
      "Test dispatch response was not an object.",
    );
  }
  const result = value as Record<string, unknown>;
  const runIds = result.runIds;
  if (
    typeof result.enabled !== "boolean" ||
    typeof result.matched !== "number" ||
    typeof result.created !== "number" ||
    typeof result.duplicates !== "number" ||
    !Array.isArray(runIds) ||
    !runIds.every((runId) => typeof runId === "string")
  ) {
    throw new BackgroundAgentTestProofError(
      "Test dispatch response did not match the background dispatch result shape.",
    );
  }
  return {
    enabled: result.enabled,
    matched: result.matched,
    created: result.created,
    duplicates: result.duplicates,
    runIds,
  };
}

export function assertTestDispatch(result: TestDispatchResult): void {
  if (!result.enabled) {
    throw new BackgroundAgentTestProofError(
      "Background agents are disabled in the target environment.",
    );
  }
  if (result.matched < 1) {
    throw new BackgroundAgentTestProofError(
      "Manual test dispatch matched no enabled trigger for the agent.",
    );
  }
  if (result.created < 1 || result.runIds.length < 1) {
    throw new BackgroundAgentTestProofError(
      "Manual test dispatch did not create a durable background run.",
    );
  }
}

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function parseRunSnapshot(value: unknown): RunSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BackgroundAgentTestProofError(
      "Run detail response was not an object.",
    );
  }
  const body = value as Record<string, unknown>;
  const run = body.run;
  if (!run || typeof run !== "object" || Array.isArray(run)) {
    throw new BackgroundAgentTestProofError(
      "Run detail response is missing the run object.",
    );
  }
  const runRecord = run as Record<string, unknown>;
  if (
    typeof runRecord.id !== "string" ||
    typeof runRecord.status !== "string"
  ) {
    throw new BackgroundAgentTestProofError(
      "Run detail response has an invalid run id/status.",
    );
  }
  const events = Array.isArray(body.events) ? body.events : [];
  const outputs = Array.isArray(body.outputs) ? body.outputs : [];
  const eventNames = events
    .map((event) => {
      if (event && typeof event === "object" && !Array.isArray(event)) {
        const record = event as Record<string, unknown>;
        return typeof record.eventName === "string" ? record.eventName : null;
      }
      return null;
    })
    .filter((name): name is string => name !== null);
  return {
    run: {
      id: runRecord.id,
      status: runRecord.status,
      errorKind:
        typeof runRecord.errorKind === "string" ? runRecord.errorKind : null,
      outputUrl:
        typeof runRecord.outputUrl === "string" ? runRecord.outputUrl : null,
    },
    events,
    eventNames,
    outputs,
  };
}

export function summarizeRun(snapshot: RunSnapshot, elapsedMs: number): string {
  const parts: string[] = [
    `runId=${snapshot.run.id}`,
    `status=${snapshot.run.status}`,
    `events=${snapshot.events.length}`,
    `outputs=${snapshot.outputs.length}`,
    `elapsedMs=${elapsedMs}`,
  ];
  if (snapshot.run.errorKind) {
    parts.push(`errorKind=${snapshot.run.errorKind}`);
  }
  if (snapshot.run.outputUrl) {
    parts.push(`outputUrl=${snapshot.run.outputUrl}`);
  }
  return parts.join(" ");
}

/** The event the dispatcher records when `start(runBackgroundAgentWorkflow)`
 * succeeds. Its presence is the evidence that the workflow actually started —
 * the execution-path behavior this smoke is meant to prove. */
export const WORKFLOW_STARTED_EVENT = "background-agent.workflow.started";

/**
 * Assert the terminal run is real proof, not a false positive.
 *
 * A `workflow_failed` run means `start(runBackgroundAgentWorkflow, ...)` never
 * started the durable workflow — the exact execution-path regression this smoke
 * exists to catch. Reject it unconditionally, even with the default
 * `REQUIRE_SUCCEEDED=false`, so a broken workflow-start cannot print "proof
 * passed". Also require the `background-agent.workflow.started` event when the
 * timeline is populated, so a target that records a terminal status without
 * ever starting the workflow cannot pass either.
 */
export function assertProofRun(
  snapshot: RunSnapshot,
  options?: { requireSucceeded?: boolean },
): void {
  if (
    snapshot.run.status === "failed" &&
    snapshot.run.errorKind === "workflow_failed"
  ) {
    throw new BackgroundAgentTestProofError(
      `Run ${snapshot.run.id} failed to start the background agent workflow (errorKind=workflow_failed). The execution path is broken — this is not proof.`,
    );
  }
  if (
    snapshot.eventNames.length > 0 &&
    !snapshot.eventNames.includes(WORKFLOW_STARTED_EVENT)
  ) {
    throw new BackgroundAgentTestProofError(
      `Run ${snapshot.run.id} reached terminal status without a ${WORKFLOW_STARTED_EVENT} event. The workflow did not start — this is not proof.`,
    );
  }
  if (options?.requireSucceeded && snapshot.run.status !== "succeeded") {
    throw new BackgroundAgentTestProofError(
      `Run ${snapshot.run.id} terminated with status ${snapshot.run.status} (REQUIRE_SUCCEEDED was set).`,
    );
  }
}

async function fetchJson(
  url: URL,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: number; body: string; parsed: unknown }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
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
    return { status: response.status, body, parsed };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new BackgroundAgentTestProofError(
        `Request to ${url.toString()} timed out after ${timeoutMs}ms.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function postTestTrigger(
  config: TestProofConfig,
  requestId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TestDispatchResult> {
  // Pass the Headers object directly — spreading a Headers into a plain object
  // drops the headers (object spread uses own properties, not the iterator),
  // which would silently strip the auth cookie.
  const headers = buildProofAuthHeaders(config);
  headers.set("x-request-id", requestId);
  const { status, parsed } = await fetchJson(
    testEndpoint(config),
    {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    },
    REQUEST_TIMEOUT_MS,
    fetchImpl,
  );

  if (status < 200 || status >= 300) {
    const message =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `status ${status}`;
    throw new BackgroundAgentTestProofError(
      `Manual test trigger failed with ${message}.`,
    );
  }
  return parseTestDispatchResult(parsed);
}

async function fetchRunSnapshot(
  config: TestProofConfig,
  runId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RunSnapshot> {
  const { status, parsed } = await fetchJson(
    runEndpoint(config, runId),
    { method: "GET", headers: buildProofAuthHeaders(config) },
    REQUEST_TIMEOUT_MS,
    fetchImpl,
  );
  if (status < 200 || status >= 300) {
    throw new BackgroundAgentTestProofError(
      `Run detail fetch for ${runId} failed with status ${status}.`,
    );
  }
  return parseRunSnapshot(parsed);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollRunUntilTerminal(
  config: TestProofConfig,
  runId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RunSnapshot> {
  const startedAt = Date.now();
  let snapshot = await fetchRunSnapshot(config, runId, fetchImpl);
  while (!isTerminalStatus(snapshot.run.status)) {
    const elapsed = Date.now() - startedAt;
    if (elapsed > config.timeoutMs) {
      throw new BackgroundAgentTestProofError(
        `Run ${runId} did not reach a terminal status within ${config.timeoutMs}ms (last status: ${snapshot.run.status}).`,
      );
    }
    await sleep(config.pollIntervalMs);
    snapshot = await fetchRunSnapshot(config, runId, fetchImpl);
  }
  return snapshot;
}

/**
 * Dispatch a manual test trigger and poll the resulting run to a terminal
 * status. Extracted (#864) so the journey-proof harness can reuse the exact
 * same evidence lines and hard-deadline semantics instead of duplicating
 * this logic.
 */
export async function dispatchAndPollToTerminal(
  config: TestProofConfig,
  options?: {
    requestId?: string;
    log?: (line: string) => void;
    fetchImpl?: typeof fetch;
  },
): Promise<{
  dispatch: TestDispatchResult;
  snapshot: RunSnapshot;
  elapsedMs: number;
}> {
  const log = options?.log ?? console.log;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const requestId = options?.requestId ?? `test-proof-${randomUUID()}`;
  const startedAt = Date.now();

  const dispatch = await postTestTrigger(config, requestId, fetchImpl);
  assertTestDispatch(dispatch);
  const runId = dispatch.runIds[0];
  log(
    `dispatch: matched=${dispatch.matched} created=${dispatch.created} duplicates=${dispatch.duplicates} runId=${runId}`,
  );

  log(
    `Polling run ${runId} until terminal status (timeout ${config.timeoutMs}ms).`,
  );
  const snapshot = await pollRunUntilTerminal(config, runId, fetchImpl);
  return { dispatch, snapshot, elapsedMs: Date.now() - startedAt };
}

async function main(): Promise<void> {
  loadLocalEnv();
  const config = getProofConfig(process.env);

  console.log(
    `Posting manual test trigger for agent ${config.agentId} to ${config.baseUrl.origin}.`,
  );
  const { snapshot, elapsedMs } = await dispatchAndPollToTerminal(config);
  console.log(summarizeRun(snapshot, elapsedMs));

  // Assert the run is real proof, not a false positive: a workflow_failed run
  // or a terminal run with no workflow.started event means the execution path
  // is broken and the smoke must not print "proof passed".
  assertProofRun(snapshot, { requireSucceeded: config.requireSucceeded });

  console.log(
    `Background agent test proof passed. Inspect run ${snapshot.run.id} at /background-runs/${snapshot.run.id}.`,
  );
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Background agent test proof failed: ${message}`);
    process.exit(1);
  });
}
