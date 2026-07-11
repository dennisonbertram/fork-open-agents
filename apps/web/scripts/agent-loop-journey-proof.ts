/**
 * Agent loop full journey proof harness.
 *
 * Drives the full first-time loop journey end-to-end: create a disposable
 * loop from an inline, inert definition, confirm it starts in `draft`,
 * activate it, dispatch a run ("run now"), poll the run to a terminal
 * status within a deadline, assert it is real proof (not a false
 * positive), and delete the loop whether the run passed or failed.
 * Sibling of background-agent-journey-proof.ts — mirrors its shape and
 * evidence-line/redaction discipline, but is self-contained (loops routes,
 * response shapes, and terminal-status semantics differ enough from
 * background agents that sharing code would cost more than it saves for
 * two scripts).
 *
 * Flow:
 *   1. POST /api/agent-loops (create a disposable loop, inline definition).
 *   2. Confirm it starts in draft status.
 *   3. PATCH /api/agent-loops/[loopId] { status: "active" }.
 *   4. POST /api/agent-loops/[loopId]/runs (dispatch a run now).
 *   5. Poll GET /api/agent-loop-runs/[runId] until a terminal status.
 *   6. Assert the run is real proof via assertLoopProofRun.
 *   7. DELETE /api/agent-loops/[loopId] in a finally block, then confirm
 *      via GET /api/agent-loops/[loopId] that it now 404s.
 *
 * Required env:
 *   LOOP_JOURNEY_PROOF_BASE_URL     http(s) target origin
 *   LOOP_JOURNEY_PROOF_COOKIE       authenticated session cookie
 *                                   (e.g. open_agents_test_user_id=<user>)
 *   LOOP_JOURNEY_PROOF_REPO_OWNER   disposable repo owner (no default —
 *                                   never point this at a real repo)
 *   LOOP_JOURNEY_PROOF_REPO_NAME    disposable repo name
 *
 * Optional env:
 *   LOOP_JOURNEY_PROOF_TIMEOUT_MS       run-completion timeout (default
 *                                       1_200_000ms / 20min — deliberately
 *                                       larger than the loop's own
 *                                       maxRunDurationMs/stepTimeoutMs so a
 *                                       guardrail-terminated run reaches a
 *                                       typed terminal status inside the
 *                                       harness window; sandbox
 *                                       provisioning inside a step has been
 *                                       observed to take 6+ minutes before
 *                                       the first turn)
 *   LOOP_JOURNEY_PROOF_POLL_MS           poll interval (default 2000)
 *   LOOP_JOURNEY_PROOF_REQUIRE_SUCCEEDED require status===completed (default false)
 *   VERCEL_AUTOMATION_BYPASS_SECRET      preview protection bypass
 *
 * Usage:
 *   bun run --cwd apps/web loops:journey-proof
 *
 * Exit codes:
 *   0 - the journey passed (cleanup may still have failed — see the
 *       WARNING line and the journey-summary JSON's "cleanup" field).
 *   1 - any journey step failed (a run that never reaches a terminal status
 *       by the deadline is a FAILURE, never a success), or the journey
 *       failed and cleanup also failed.
 *
 * A cleanup failure AFTER a passing journey is a loud WARNING, not a
 * failure exit — see docs/process/loops-live-proof.md.
 *
 * Never logs the cookie, bypass secret, request headers, or full response
 * bodies — only named evidence fields.
 */
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const appRoot = join(import.meta.dirname, "..");
const DEFAULT_TIMEOUT_MS = 1_200_000;
const DEFAULT_POLL_MS = 2_000;
const REQUEST_TIMEOUT_MS = 20_000;

const TERMINAL_LOOP_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "stalled",
]);

type Env = Record<string, string | undefined>;

export class AgentLoopJourneyProofError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentLoopJourneyProofError";
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
  loopId: string | null;
  runId: string | null;
  runStatus: string | null;
  errorKind: string | null;
  elapsedMs: number;
  journey: "passed" | "failed";
  cleanup: "deleted" | "failed" | "skipped";
  failedStep: string | null;
  failureMessage: string | null;
}

interface CreatedLoop {
  id: string;
  status: string;
}

interface RunDetail {
  run: { id: string; status: string; errorKind?: string };
  steps: Array<{ errorKind?: string }>;
  eventNames: string[];
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
    throw new AgentLoopJourneyProofError(`${name} is required.`);
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
    throw new AgentLoopJourneyProofError(
      `${label} must be a positive integer.`,
    );
  }
  return parsed;
}

function parseBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AgentLoopJourneyProofError(
      "LOOP_JOURNEY_PROOF_BASE_URL must be a valid http(s) URL.",
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AgentLoopJourneyProofError(
      "LOOP_JOURNEY_PROOF_BASE_URL must be a valid http(s) URL.",
    );
  }
  return url;
}

export function getJourneyConfig(env: Env): JourneyConfig {
  const baseUrl = parseBaseUrl(requireEnv(env, "LOOP_JOURNEY_PROOF_BASE_URL"));
  return {
    baseUrl,
    cookie: requireEnv(env, "LOOP_JOURNEY_PROOF_COOKIE"),
    repoOwner: requireEnv(env, "LOOP_JOURNEY_PROOF_REPO_OWNER"),
    repoName: requireEnv(env, "LOOP_JOURNEY_PROOF_REPO_NAME"),
    timeoutMs: parsePositiveInt(
      env.LOOP_JOURNEY_PROOF_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      "LOOP_JOURNEY_PROOF_TIMEOUT_MS",
    ),
    pollIntervalMs: parsePositiveInt(
      env.LOOP_JOURNEY_PROOF_POLL_MS,
      DEFAULT_POLL_MS,
      "LOOP_JOURNEY_PROOF_POLL_MS",
    ),
    requireSucceeded: parseBoolean(
      env.LOOP_JOURNEY_PROOF_REQUIRE_SUCCEEDED,
      false,
    ),
    bypassSecret: optionalEnv(env, "VERCEL_AUTOMATION_BYPASS_SECRET"),
  };
}

export function buildJourneyLoopPayload(params: {
  repoOwner: string;
  repoName: string;
  now?: Date;
}): unknown {
  const now = params.now ?? new Date();
  return {
    name: `Loop journey proof ${now.toISOString()}`.slice(0, 100),
    description:
      "Disposable loop created by loops:journey-proof — safe to delete.",
    repoOwner: params.repoOwner,
    repoName: params.repoName,
    definition: {
      nodes: [
        {
          id: "start",
          kind: "start",
          label: "Start",
          position: { x: 0, y: 0 },
        },
        {
          id: "report",
          kind: "agent_step",
          label: "Report",
          position: { x: 260, y: 0 },
          instructions:
            "Journey proof: reply with a one-sentence status report confirming you can see the repository. Do not modify any files, branches, PRs, or issues. Do not run any write commands.",
          permissions: { github: { contents: "read" } },
        },
        { id: "end", kind: "end", label: "Done", position: { x: 520, y: 0 } },
      ],
      edges: [
        {
          id: "start-report",
          source: "start",
          target: "report",
          when: "always",
        },
        { id: "report-end", source: "report", target: "end", when: "success" },
      ],
    },
    guardrails: {
      maxStepsPerRun: 5,
      maxIterations: 1,
      maxRunDurationMs: 1_080_000,
      stepTimeoutMs: 900_000,
      maxAgentTurnsPerStep: 4,
    },
    permissions: {},
  };
}

export function parseCreatedLoop(value: unknown): CreatedLoop {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentLoopJourneyProofError("Create response was not an object.");
  }
  const body = value as Record<string, unknown>;
  const loop = body.loop;
  if (!loop || typeof loop !== "object" || Array.isArray(loop)) {
    throw new AgentLoopJourneyProofError(
      "Create response is missing the loop object.",
    );
  }
  const record = loop as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.status !== "string") {
    throw new AgentLoopJourneyProofError(
      "Create response has an invalid loop id/status.",
    );
  }
  return { id: record.id, status: record.status };
}

export function assertLoopDraft(loop: CreatedLoop): void {
  if (loop.status !== "draft") {
    throw new AgentLoopJourneyProofError(
      `Loop ${loop.id} did not start in draft status (status=${loop.status}).`,
    );
  }
}

export function assertLoopActive(loop: CreatedLoop): void {
  if (loop.status !== "active") {
    throw new AgentLoopJourneyProofError(
      `Loop ${loop.id} was not activated (status=${loop.status}).`,
    );
  }
}

export function parseRunDetail(value: unknown): RunDetail {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentLoopJourneyProofError(
      "Run detail response was not an object.",
    );
  }
  const body = value as Record<string, unknown>;
  const run = body.run;
  if (!run || typeof run !== "object" || Array.isArray(run)) {
    throw new AgentLoopJourneyProofError(
      "Run detail response is missing the run object.",
    );
  }
  const runRecord = run as Record<string, unknown>;
  if (
    typeof runRecord.id !== "string" ||
    typeof runRecord.status !== "string"
  ) {
    throw new AgentLoopJourneyProofError(
      "Run detail response has an invalid run id/status.",
    );
  }
  const steps = Array.isArray(body.steps)
    ? (body.steps as Array<Record<string, unknown>>).map((step) => ({
        errorKind:
          typeof step.errorKind === "string" ? step.errorKind : undefined,
      }))
    : [];
  const events = Array.isArray(body.events)
    ? (body.events as Array<Record<string, unknown>>)
    : [];
  const eventNames = events
    .map((event) =>
      typeof event.eventName === "string" ? event.eventName : null,
    )
    .filter((name): name is string => name !== null);
  return {
    run: {
      id: runRecord.id,
      status: runRecord.status,
      errorKind:
        typeof runRecord.errorKind === "string"
          ? runRecord.errorKind
          : undefined,
    },
    steps,
    eventNames,
  };
}

export function isTerminalLoopStatus(status: string): boolean {
  return TERMINAL_LOOP_STATUSES.has(status);
}

export function summarizeLoopRun(detail: RunDetail, elapsedMs: number): string {
  const failedSteps = detail.steps.filter((step) => step.errorKind).length;
  return `assert: runId=${detail.run.id} status=${detail.run.status} errorKind=${
    detail.run.errorKind ?? "none"
  } stepCount=${detail.steps.length} failedSteps=${failedSteps} elapsedMs=${elapsedMs}`;
}

export function assertLoopProofRun(
  detail: RunDetail,
  options: { requireSucceeded?: boolean },
): void {
  if (detail.run.errorKind === "dispatch_failed") {
    throw new AgentLoopJourneyProofError(
      `Run ${detail.run.id} failed to dispatch (errorKind=dispatch_failed).`,
    );
  }
  if (detail.run.errorKind === "turn_budget_exceeded") {
    throw new AgentLoopJourneyProofError(
      `Run ${detail.run.id} exhausted its turn budget (errorKind=turn_budget_exceeded).`,
    );
  }
  if (detail.steps.some((step) => step.errorKind === "turn_budget_exceeded")) {
    throw new AgentLoopJourneyProofError(
      `Run ${detail.run.id} has a step that exhausted its turn budget (errorKind=turn_budget_exceeded).`,
    );
  }
  if (
    detail.eventNames.length > 0 &&
    !detail.eventNames.includes("agent-loop.run.started")
  ) {
    throw new AgentLoopJourneyProofError(
      `Run ${detail.run.id} has events but is missing agent-loop.run.started.`,
    );
  }
  if (options.requireSucceeded && detail.run.status !== "completed") {
    throw new AgentLoopJourneyProofError(
      `Run ${detail.run.id} did not complete (status=${detail.run.status}).`,
    );
  }
}

function buildAuthHeaders(config: JourneyConfig): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "open-agents-agent-loop-journey-proof/1.0",
    Cookie: config.cookie,
  };
  if (config.bypassSecret) {
    headers["x-vercel-protection-bypass"] = config.bypassSecret;
    headers["x-vercel-set-bypass-cookie"] = "true";
  }
  return headers;
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
      throw new AgentLoopJourneyProofError(
        `Request to ${url.toString()} timed out after ${REQUEST_TIMEOUT_MS}ms.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function errorMessageFromBody(status: number, parsed: unknown): string {
  if (parsed && typeof parsed === "object") {
    const body = parsed as Record<string, unknown>;
    if (typeof body.message === "string") {
      return body.message;
    }
    if (typeof body.error === "string") {
      return body.error;
    }
    if (typeof body.errorKind === "string") {
      return body.errorKind;
    }
  }
  return `status ${status}`;
}

/**
 * Best-effort cleanup, isolated in its own function (rather than inline in a
 * `finally` block) so a cleanup failure can never mask or overwrite the
 * journey's own outcome/error.
 */
async function cleanupLoop(
  config: JourneyConfig,
  loopId: string,
  fetchImpl: typeof fetch,
  log: (line: string) => void,
): Promise<"deleted" | "failed"> {
  try {
    const deleteResult = await fetchJson(
      new URL(`/api/agent-loops/${loopId}`, config.baseUrl),
      { method: "DELETE", headers: buildAuthHeaders(config) },
      fetchImpl,
    );
    if (deleteResult.status < 200 || deleteResult.status >= 300) {
      throw new AgentLoopJourneyProofError(
        `Delete agent loop failed with ${errorMessageFromBody(deleteResult.status, deleteResult.parsed)}.`,
      );
    }
    const absenceResult = await fetchJson(
      new URL(`/api/agent-loops/${loopId}`, config.baseUrl),
      { method: "GET", headers: buildAuthHeaders(config) },
      fetchImpl,
    );
    const verifiedAbsent = absenceResult.status === 404;
    log(
      `cleanup: loopId=${loopId} deleted=true verifiedAbsent=${verifiedAbsent}`,
    );
    if (!verifiedAbsent) {
      throw new AgentLoopJourneyProofError(
        `Delete agent loop returned success but loop ${loopId} still exists (GET returned ${absenceResult.status}, absence check failed).`,
      );
    }
    return "deleted";
  } catch (cleanupError) {
    const message =
      cleanupError instanceof Error
        ? cleanupError.message
        : String(cleanupError);
    log(
      `WARNING: cleanup failed — manually delete loop ${loopId} (${message})`,
    );
    return "failed";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runJourney(
  config: JourneyConfig,
  deps?: { fetchImpl?: typeof fetch; log?: (line: string) => void },
): Promise<JourneySummary> {
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const log = deps?.log ?? console.log;
  const startedAt = Date.now();

  let loopId: string | null = null;
  let runId: string | null = null;
  let runStatus: string | null = null;
  let errorKind: string | null = null;
  let journey: "passed" | "failed" = "failed";
  let failedStep: string | null = null;
  let failureMessage: string | null = null;
  let cleanup: "deleted" | "failed" | "skipped" = "skipped";

  try {
    // 1. create
    const createHeaders = buildAuthHeaders(config);
    const createPayload = buildJourneyLoopPayload({
      repoOwner: config.repoOwner,
      repoName: config.repoName,
    });
    const createResult = await fetchJson(
      new URL("/api/agent-loops", config.baseUrl),
      {
        method: "POST",
        headers: createHeaders,
        body: JSON.stringify(createPayload),
      },
      fetchImpl,
    );
    if (createResult.status < 200 || createResult.status >= 300) {
      failedStep = "create";
      throw new AgentLoopJourneyProofError(
        `Create agent loop failed with ${errorMessageFromBody(createResult.status, createResult.parsed)}.`,
      );
    }
    const created = parseCreatedLoop(createResult.parsed);
    loopId = created.id;
    log(
      `create: loopId=${created.id} status=${created.status} repo=${config.repoOwner}/${config.repoName}`,
    );

    // 2. confirm-draft
    failedStep = "confirm-draft";
    assertLoopDraft(created);
    log(`confirm-draft: loopId=${created.id} status=draft`);

    // 3. activate
    failedStep = "activate";
    const activateResult = await fetchJson(
      new URL(`/api/agent-loops/${created.id}`, config.baseUrl),
      {
        method: "PATCH",
        headers: buildAuthHeaders(config),
        body: JSON.stringify({ status: "active" }),
      },
      fetchImpl,
    );
    if (activateResult.status < 200 || activateResult.status >= 300) {
      throw new AgentLoopJourneyProofError(
        `Activate agent loop failed with ${errorMessageFromBody(activateResult.status, activateResult.parsed)}.`,
      );
    }
    const activated = parseCreatedLoop(activateResult.parsed);
    assertLoopActive(activated);
    log(`activate: loopId=${activated.id} status=active`);

    // 4. dispatch
    failedStep = "dispatch";
    const dispatchResult = await fetchJson(
      new URL(`/api/agent-loops/${created.id}/runs`, config.baseUrl),
      {
        method: "POST",
        headers: {
          ...buildAuthHeaders(config),
          "x-request-id": `loop-journey-proof-${randomUUID()}`,
        },
      },
      fetchImpl,
    );
    if (dispatchResult.status !== 202) {
      throw new AgentLoopJourneyProofError(
        `Dispatch loop run failed with ${errorMessageFromBody(dispatchResult.status, dispatchResult.parsed)}.`,
      );
    }
    const dispatchBody = dispatchResult.parsed as
      | { runId?: unknown; created?: unknown }
      | undefined;
    if (
      typeof dispatchBody?.runId !== "string" ||
      dispatchBody.created !== true
    ) {
      throw new AgentLoopJourneyProofError(
        "Dispatch loop run response was missing runId or created!==true.",
      );
    }
    runId = dispatchBody.runId;
    log(`dispatch: loopId=${created.id} runId=${runId} created=true`);

    // 5. poll
    failedStep = "poll";
    let detail: RunDetail | null = null;
    const deadline = Date.now() + config.timeoutMs;
    let lastStatus: string | null = null;
    while (Date.now() < deadline) {
      const pollResult = await fetchJson(
        new URL(`/api/agent-loop-runs/${runId}`, config.baseUrl),
        { method: "GET", headers: buildAuthHeaders(config) },
        fetchImpl,
      );
      if (pollResult.status < 200 || pollResult.status >= 300) {
        throw new AgentLoopJourneyProofError(
          `Poll loop run failed with ${errorMessageFromBody(pollResult.status, pollResult.parsed)}.`,
        );
      }
      const parsed = parseRunDetail(pollResult.parsed);
      if (parsed.run.status !== lastStatus) {
        log(
          `poll: loopId=${created.id} runId=${runId} status=${parsed.run.status}`,
        );
        lastStatus = parsed.run.status;
      }
      if (isTerminalLoopStatus(parsed.run.status)) {
        detail = parsed;
        break;
      }
      await sleep(config.pollIntervalMs);
    }
    if (!detail) {
      throw new AgentLoopJourneyProofError(
        `Run ${runId} never reached a terminal status while still ${lastStatus ?? "unknown"} after ${config.timeoutMs}ms (poll timed out).`,
      );
    }
    runStatus = detail.run.status;
    errorKind = detail.run.errorKind ?? null;

    // 6. assert
    failedStep = "assert";
    log(summarizeLoopRun(detail, Date.now() - startedAt));
    assertLoopProofRun(detail, { requireSucceeded: config.requireSucceeded });

    journey = "passed";
    failedStep = null;
  } catch (error) {
    journey = "failed";
    failureMessage = error instanceof Error ? error.message : String(error);
  } finally {
    if (loopId) {
      cleanup = await cleanupLoop(config, loopId, fetchImpl, log);
    }
  }

  const summary: JourneySummary = {
    loopId,
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
    console.error(`Agent loop journey proof failed: ${message}`);
    process.exit(1);
  });
}
