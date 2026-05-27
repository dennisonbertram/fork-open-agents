import { createHmac, randomUUID } from "crypto";
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";

const appRoot = join(import.meta.dirname, "..");
const DEFAULT_TIMEOUT_MS = 20_000;

export type GitHubProofEvent = "pull_request" | "issues" | "deployment_status";

export interface BackgroundDispatchResult {
  enabled: boolean;
  matched: number;
  created: number;
  duplicates: number;
  runIds: string[];
}

interface ProofConfig {
  baseUrl: URL;
  webhookSecret: string;
  event: GitHubProofEvent;
  payload: unknown;
  sendDuplicate: boolean;
  bypassSecret?: string;
}

interface ProofResponse {
  status: number;
  body: string;
  result: BackgroundDispatchResult;
}

type Env = Record<string, string | undefined>;

export class GitHubWebhookProofError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubWebhookProofError";
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
    throw new GitHubWebhookProofError(`${name} is required.`);
  }
  return value;
}

function optionalEnv(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value || undefined;
}

function getBaseUrl(env: Env): URL {
  const rawUrl = requireEnv(env, "BACKGROUND_AGENT_GITHUB_PROOF_BASE_URL");

  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new GitHubWebhookProofError(
        "BACKGROUND_AGENT_GITHUB_PROOF_BASE_URL must be an http(s) URL.",
      );
    }
    return url;
  } catch (error) {
    if (error instanceof GitHubWebhookProofError) {
      throw error;
    }
    throw new GitHubWebhookProofError(
      "BACKGROUND_AGENT_GITHUB_PROOF_BASE_URL is not a valid URL.",
    );
  }
}

function parseBoolean(value: string | undefined, defaultValue: boolean) {
  if (!value) {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function getProofEvent(env: Env): GitHubProofEvent {
  const event =
    optionalEnv(env, "BACKGROUND_AGENT_GITHUB_PROOF_EVENT") ?? "pull_request";
  if (
    event !== "pull_request" &&
    event !== "issues" &&
    event !== "deployment_status"
  ) {
    throw new GitHubWebhookProofError(
      "BACKGROUND_AGENT_GITHUB_PROOF_EVENT must be pull_request, issues, or deployment_status.",
    );
  }
  return event;
}

function fixtureNumber(env: Env, name: string, fallback: number): number {
  const value = optionalEnv(env, name);
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new GitHubWebhookProofError(`${name} must be a number.`);
  }
  return parsed;
}

function labels(env: Env): Array<{ name: string }> {
  return (
    optionalEnv(env, "BACKGROUND_AGENT_GITHUB_PROOF_LABELS")
      ?.split(",")
      .map((label) => label.trim())
      .filter(Boolean) ?? ["background-proof"]
  ).map((name) => ({ name }));
}

function buildPullRequestPayload(env: Env, proofId: string) {
  const owner = requireEnv(env, "BACKGROUND_AGENT_GITHUB_PROOF_REPO_OWNER");
  const repo = requireEnv(env, "BACKGROUND_AGENT_GITHUB_PROOF_REPO_NAME");
  const prNumber = fixtureNumber(
    env,
    "BACKGROUND_AGENT_GITHUB_PROOF_PR_NUMBER",
    7,
  );
  const sha =
    optionalEnv(env, "BACKGROUND_AGENT_GITHUB_PROOF_SHA") ??
    `proof-${proofId.slice(0, 12)}`;
  const headRef =
    optionalEnv(env, "BACKGROUND_AGENT_GITHUB_PROOF_HEAD_REF") ??
    `background-proof-${proofId.slice(0, 8)}`;
  const baseRef =
    optionalEnv(env, "BACKGROUND_AGENT_GITHUB_PROOF_BASE_REF") ?? "main";

  return {
    action:
      optionalEnv(env, "BACKGROUND_AGENT_GITHUB_PROOF_ACTION") ?? "opened",
    repository: {
      name: repo,
      owner: { login: owner },
    },
    sender: {
      login:
        optionalEnv(env, "BACKGROUND_AGENT_GITHUB_PROOF_ACTOR") ??
        "open-agents-proof",
    },
    pull_request: {
      id: fixtureNumber(env, "BACKGROUND_AGENT_GITHUB_PROOF_PR_ID", 100_001),
      number: prNumber,
      title:
        optionalEnv(env, "BACKGROUND_AGENT_GITHUB_PROOF_TITLE") ??
        "Background agent GitHub webhook proof",
      html_url:
        optionalEnv(env, "BACKGROUND_AGENT_GITHUB_PROOF_URL") ??
        `https://github.com/${owner}/${repo}/pull/${prNumber}`,
      merged: false,
      head: {
        ref: headRef,
        sha,
      },
      base: {
        ref: baseRef,
      },
      labels: labels(env),
    },
  };
}

function buildIssuePayload(env: Env) {
  const owner = requireEnv(env, "BACKGROUND_AGENT_GITHUB_PROOF_REPO_OWNER");
  const repo = requireEnv(env, "BACKGROUND_AGENT_GITHUB_PROOF_REPO_NAME");
  const issueNumber = fixtureNumber(
    env,
    "BACKGROUND_AGENT_GITHUB_PROOF_ISSUE_NUMBER",
    9,
  );

  return {
    action:
      optionalEnv(env, "BACKGROUND_AGENT_GITHUB_PROOF_ACTION") ?? "opened",
    repository: {
      name: repo,
      owner: { login: owner },
    },
    sender: {
      login:
        optionalEnv(env, "BACKGROUND_AGENT_GITHUB_PROOF_ACTOR") ??
        "open-agents-proof",
    },
    issue: {
      id: fixtureNumber(env, "BACKGROUND_AGENT_GITHUB_PROOF_ISSUE_ID", 200_001),
      number: issueNumber,
      title:
        optionalEnv(env, "BACKGROUND_AGENT_GITHUB_PROOF_TITLE") ??
        "Background agent issue proof",
      html_url:
        optionalEnv(env, "BACKGROUND_AGENT_GITHUB_PROOF_URL") ??
        `https://github.com/${owner}/${repo}/issues/${issueNumber}`,
      labels: labels(env),
    },
  };
}

function buildDeploymentStatusPayload(env: Env) {
  const owner = requireEnv(env, "BACKGROUND_AGENT_GITHUB_PROOF_REPO_OWNER");
  const repo = requireEnv(env, "BACKGROUND_AGENT_GITHUB_PROOF_REPO_NAME");
  const deploymentId = fixtureNumber(
    env,
    "BACKGROUND_AGENT_GITHUB_PROOF_DEPLOYMENT_ID",
    300_001,
  );
  const statusId = fixtureNumber(
    env,
    "BACKGROUND_AGENT_GITHUB_PROOF_DEPLOYMENT_STATUS_ID",
    400_001,
  );
  const ref = optionalEnv(env, "BACKGROUND_AGENT_GITHUB_PROOF_REF") ?? "main";

  return {
    action: "created",
    repository: {
      name: repo,
      owner: { login: owner },
    },
    sender: {
      login:
        optionalEnv(env, "BACKGROUND_AGENT_GITHUB_PROOF_ACTOR") ??
        "open-agents-proof",
    },
    deployment: {
      id: deploymentId,
      ref,
      sha: optionalEnv(env, "BACKGROUND_AGENT_GITHUB_PROOF_SHA") ?? "proof-sha",
      environment:
        optionalEnv(env, "BACKGROUND_AGENT_GITHUB_PROOF_ENVIRONMENT") ??
        "Preview",
    },
    deployment_status: {
      id: statusId,
      state:
        optionalEnv(env, "BACKGROUND_AGENT_GITHUB_PROOF_DEPLOYMENT_STATE") ??
        "success",
      target_url:
        optionalEnv(env, "BACKGROUND_AGENT_GITHUB_PROOF_URL") ??
        "https://example.com/background-agent-proof",
      environment:
        optionalEnv(env, "BACKGROUND_AGENT_GITHUB_PROOF_ENVIRONMENT") ??
        "Preview",
    },
  };
}

function buildPayload(env: Env, event: GitHubProofEvent, proofId: string) {
  if (event === "pull_request") {
    return buildPullRequestPayload(env, proofId);
  }
  if (event === "issues") {
    return buildIssuePayload(env);
  }
  return buildDeploymentStatusPayload(env);
}

export function signPayload(payload: string, secret: string): string {
  const digest = createHmac("sha256", secret).update(payload).digest("hex");
  return `sha256=${digest}`;
}

export function getProofConfig(
  env: Env,
  options: { uuid?: () => string } = {},
): ProofConfig {
  const uuid = options.uuid ?? randomUUID;
  const proofId =
    optionalEnv(env, "BACKGROUND_AGENT_GITHUB_PROOF_ID") ?? uuid();
  const event = getProofEvent(env);

  return {
    baseUrl: getBaseUrl(env),
    webhookSecret: requireEnv(env, "GITHUB_WEBHOOK_SECRET"),
    event,
    payload: buildPayload(env, event, proofId),
    sendDuplicate: parseBoolean(
      env.BACKGROUND_AGENT_GITHUB_PROOF_DUPLICATE,
      true,
    ),
    bypassSecret: optionalEnv(env, "VERCEL_AUTOMATION_BYPASS_SECRET"),
  };
}

function webhookUrl(config: ProofConfig): URL {
  return new URL("/api/github/webhook", config.baseUrl);
}

function parseDispatchResult(value: unknown): BackgroundDispatchResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GitHubWebhookProofError("Webhook response was not an object.");
  }
  const response = value as Record<string, unknown>;
  const result = response.backgroundAgents;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new GitHubWebhookProofError(
      "Webhook response did not include backgroundAgents.",
    );
  }
  const fields = result as Record<string, unknown>;
  const runIds = fields.runIds;
  if (
    typeof fields.enabled !== "boolean" ||
    typeof fields.matched !== "number" ||
    typeof fields.created !== "number" ||
    typeof fields.duplicates !== "number" ||
    !Array.isArray(runIds) ||
    !runIds.every((runId) => typeof runId === "string")
  ) {
    throw new GitHubWebhookProofError(
      "backgroundAgents did not match the dispatch result shape.",
    );
  }

  return {
    enabled: fields.enabled,
    matched: fields.matched,
    created: fields.created,
    duplicates: fields.duplicates,
    runIds,
  };
}

async function postGitHubWebhook(
  config: ProofConfig,
  requestId: string,
): Promise<ProofResponse> {
  const body = JSON.stringify(config.payload);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const headers = new Headers({
    "Content-Type": "application/json",
    "User-Agent": "open-agents-background-agent-github-proof/1.0",
    "x-github-event": config.event,
    "x-hub-signature-256": signPayload(body, config.webhookSecret),
    "x-request-id": requestId,
  });

  if (config.bypassSecret) {
    headers.set("x-vercel-protection-bypass", config.bypassSecret);
    headers.set("x-vercel-set-bypass-cookie", "true");
  }

  try {
    const response = await fetch(webhookUrl(config), {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    const responseBody = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(responseBody) as unknown;
    } catch {
      throw new GitHubWebhookProofError(
        `GitHub webhook response was not valid JSON (status ${response.status}).`,
      );
    }

    if (response.status < 200 || response.status >= 300) {
      const message =
        parsed && typeof parsed === "object" && "error" in parsed
          ? String((parsed as { error: unknown }).error)
          : responseBody;
      throw new GitHubWebhookProofError(
        `GitHub webhook proof request failed with status ${response.status}: ${message}`,
      );
    }

    return {
      status: response.status,
      body: responseBody,
      result: parseDispatchResult(parsed),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new GitHubWebhookProofError(
        `GitHub webhook proof request timed out after ${DEFAULT_TIMEOUT_MS}ms.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function assertFirstDispatch(result: BackgroundDispatchResult): void {
  if (!result.enabled) {
    throw new GitHubWebhookProofError(
      "Background agents are disabled in the target environment.",
    );
  }
  if (result.matched < 1) {
    throw new GitHubWebhookProofError(
      "No enabled GitHub trigger matched the proof payload.",
    );
  }
  if (result.created < 1 || result.runIds.length < 1) {
    throw new GitHubWebhookProofError(
      "The first GitHub webhook proof delivery did not create a durable background run.",
    );
  }
}

export function assertDuplicateDispatch(
  first: BackgroundDispatchResult,
  duplicate: BackgroundDispatchResult,
): void {
  if (!duplicate.enabled || duplicate.matched < 1) {
    throw new GitHubWebhookProofError(
      "Duplicate GitHub delivery did not match an enabled trigger.",
    );
  }
  if (duplicate.created !== 0 || duplicate.duplicates < 1) {
    throw new GitHubWebhookProofError(
      "Duplicate GitHub delivery created new work instead of returning an existing run.",
    );
  }
  if (first.runIds[0] !== duplicate.runIds[0]) {
    throw new GitHubWebhookProofError(
      "Duplicate GitHub delivery returned a different run ID.",
    );
  }
}

function summarize(label: string, response: ProofResponse): string {
  return `${label}: status=${response.status} matched=${response.result.matched} created=${response.result.created} duplicates=${response.result.duplicates} runIds=${response.result.runIds.join(",")}`;
}

async function main(): Promise<void> {
  loadLocalEnv();
  const config = getProofConfig(process.env);
  const firstRequestId = `github-proof-${randomUUID()}`;

  console.log(
    `Posting signed GitHub ${config.event} proof to ${webhookUrl(config).origin}.`,
  );
  const first = await postGitHubWebhook(config, firstRequestId);
  assertFirstDispatch(first.result);
  console.log(summarize("first delivery", first));

  if (config.sendDuplicate) {
    const duplicate = await postGitHubWebhook(
      config,
      `duplicate-${firstRequestId}`,
    );
    assertDuplicateDispatch(first.result, duplicate.result);
    console.log(summarize("duplicate delivery", duplicate));
  }

  console.log(
    `Background agent GitHub webhook proof passed. Inspect run ${first.result.runIds[0]} at /background-runs/${first.result.runIds[0]}.`,
  );
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Background agent GitHub webhook proof failed: ${message}`);
    process.exit(1);
  });
}
