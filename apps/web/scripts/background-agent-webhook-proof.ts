import { createHmac, randomUUID } from "crypto";
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";

const appRoot = join(import.meta.dirname, "..");
const DEFAULT_TIMEOUT_MS = 20_000;

export interface BackgroundAgentWebhookPayload {
  externalId: string;
  repoOwner?: string;
  repoName?: string;
  severity?: string;
  title?: string;
  message?: string;
  url?: string;
  actor?: string;
  occurredAt?: string;
}

export interface BackgroundDispatchResult {
  enabled: boolean;
  matched: number;
  created: number;
  duplicates: number;
  runIds: string[];
}

interface ProofConfig {
  baseUrl: URL;
  webhookPublicId: string;
  webhookSecret: string;
  payload: BackgroundAgentWebhookPayload;
  sendDuplicate: boolean;
  bypassSecret?: string;
}

interface ProofResponse {
  status: number;
  body: string;
  result: BackgroundDispatchResult;
}

type Env = Record<string, string | undefined>;

export class BackgroundAgentProofError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackgroundAgentProofError";
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
    throw new BackgroundAgentProofError(`${name} is required.`);
  }
  return value;
}

function optionalEnv(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value || undefined;
}

function getBaseUrl(env: Env): URL {
  const rawUrl = requireEnv(env, "BACKGROUND_AGENT_PROOF_BASE_URL");

  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new BackgroundAgentProofError(
        "BACKGROUND_AGENT_PROOF_BASE_URL must be an http(s) URL.",
      );
    }
    return url;
  } catch (error) {
    if (error instanceof BackgroundAgentProofError) {
      throw error;
    }
    throw new BackgroundAgentProofError(
      "BACKGROUND_AGENT_PROOF_BASE_URL is not a valid URL.",
    );
  }
}

function parseBoolean(value: string | undefined, defaultValue: boolean) {
  if (!value) {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function signPayload(payload: string, secret: string): string {
  const digest = createHmac("sha256", secret).update(payload).digest("hex");
  return `sha256=${digest}`;
}

export function getProofConfig(
  env: Env,
  options: { now?: Date; uuid?: () => string } = {},
): ProofConfig {
  const now = options.now ?? new Date();
  const uuid = options.uuid ?? randomUUID;
  const externalId =
    optionalEnv(env, "BACKGROUND_AGENT_PROOF_EXTERNAL_ID") ??
    `proof:${now.toISOString()}:${uuid()}`;
  const payload: BackgroundAgentWebhookPayload = {
    externalId,
    severity: optionalEnv(env, "BACKGROUND_AGENT_PROOF_SEVERITY") ?? "critical",
    title:
      optionalEnv(env, "BACKGROUND_AGENT_PROOF_TITLE") ??
      "Background agent live proof fixture",
    message:
      optionalEnv(env, "BACKGROUND_AGENT_PROOF_MESSAGE") ??
      "Signed webhook.error fixture for background-agent live proof.",
    occurredAt:
      optionalEnv(env, "BACKGROUND_AGENT_PROOF_OCCURRED_AT") ??
      now.toISOString(),
    ...(optionalEnv(env, "BACKGROUND_AGENT_PROOF_REPO_OWNER")
      ? { repoOwner: optionalEnv(env, "BACKGROUND_AGENT_PROOF_REPO_OWNER") }
      : {}),
    ...(optionalEnv(env, "BACKGROUND_AGENT_PROOF_REPO_NAME")
      ? { repoName: optionalEnv(env, "BACKGROUND_AGENT_PROOF_REPO_NAME") }
      : {}),
    ...(optionalEnv(env, "BACKGROUND_AGENT_PROOF_URL")
      ? { url: optionalEnv(env, "BACKGROUND_AGENT_PROOF_URL") }
      : {}),
    ...(optionalEnv(env, "BACKGROUND_AGENT_PROOF_ACTOR")
      ? { actor: optionalEnv(env, "BACKGROUND_AGENT_PROOF_ACTOR") }
      : {}),
  };

  return {
    baseUrl: getBaseUrl(env),
    webhookPublicId: requireEnv(
      env,
      "BACKGROUND_AGENT_PROOF_WEBHOOK_PUBLIC_ID",
    ),
    webhookSecret: requireEnv(env, "BACKGROUND_AGENTS_WEBHOOK_SECRET"),
    payload,
    sendDuplicate: parseBoolean(env.BACKGROUND_AGENT_PROOF_DUPLICATE, true),
    bypassSecret: optionalEnv(env, "VERCEL_AUTOMATION_BYPASS_SECRET"),
  };
}

function webhookUrl(config: ProofConfig): URL {
  return new URL(
    `/api/background-agents/webhook/${config.webhookPublicId}`,
    config.baseUrl,
  );
}

function parseDispatchResult(value: unknown): BackgroundDispatchResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BackgroundAgentProofError("Webhook response was not an object.");
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
    throw new BackgroundAgentProofError(
      "Webhook response did not match the background dispatch result shape.",
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

async function postWebhook(
  config: ProofConfig,
  requestId: string,
): Promise<ProofResponse> {
  const body = JSON.stringify(config.payload);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const headers = new Headers({
    "Content-Type": "application/json",
    "User-Agent": "open-agents-background-agent-proof/1.0",
    "x-open-agents-signature": signPayload(body, config.webhookSecret),
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
      throw new BackgroundAgentProofError(
        `Webhook response was not valid JSON (status ${response.status}).`,
      );
    }

    if (response.status < 200 || response.status >= 300) {
      const message =
        parsed && typeof parsed === "object" && "error" in parsed
          ? String((parsed as { error: unknown }).error)
          : responseBody;
      throw new BackgroundAgentProofError(
        `Webhook proof request failed with status ${response.status}: ${message}`,
      );
    }

    return {
      status: response.status,
      body: responseBody,
      result: parseDispatchResult(parsed),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new BackgroundAgentProofError(
        `Webhook proof request timed out after ${DEFAULT_TIMEOUT_MS}ms.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function assertFirstDispatch(result: BackgroundDispatchResult): void {
  if (!result.enabled) {
    throw new BackgroundAgentProofError(
      "Background agents are disabled in the target environment.",
    );
  }
  if (result.matched < 1) {
    throw new BackgroundAgentProofError(
      "No enabled webhook.error trigger matched the provided public ID.",
    );
  }
  if (result.created < 1 || result.runIds.length < 1) {
    throw new BackgroundAgentProofError(
      "The first signed webhook did not create a durable background run.",
    );
  }
}

export function assertDuplicateDispatch(
  first: BackgroundDispatchResult,
  duplicate: BackgroundDispatchResult,
): void {
  if (!duplicate.enabled || duplicate.matched < 1) {
    throw new BackgroundAgentProofError(
      "Duplicate delivery did not match the enabled webhook trigger.",
    );
  }
  if (duplicate.created !== 0 || duplicate.duplicates < 1) {
    throw new BackgroundAgentProofError(
      "Duplicate delivery created new work instead of returning an existing run.",
    );
  }
  if (first.runIds[0] !== duplicate.runIds[0]) {
    throw new BackgroundAgentProofError(
      "Duplicate delivery returned a different run ID.",
    );
  }
}

function summarize(label: string, response: ProofResponse): string {
  return `${label}: status=${response.status} matched=${response.result.matched} created=${response.result.created} duplicates=${response.result.duplicates} runIds=${response.result.runIds.join(",")}`;
}

async function main(): Promise<void> {
  loadLocalEnv();
  const config = getProofConfig(process.env);
  const firstRequestId = `proof-${randomUUID()}`;

  console.log(
    `Posting signed webhook.error proof to ${webhookUrl(config).origin} with externalId ${config.payload.externalId}.`,
  );
  const first = await postWebhook(config, firstRequestId);
  assertFirstDispatch(first.result);
  console.log(summarize("first delivery", first));

  if (config.sendDuplicate) {
    const duplicate = await postWebhook(config, `duplicate-${firstRequestId}`);
    assertDuplicateDispatch(first.result, duplicate.result);
    console.log(summarize("duplicate delivery", duplicate));
  }

  console.log(
    `Background agent webhook proof passed. Inspect run ${first.result.runIds[0]} at /background-runs/${first.result.runIds[0]}.`,
  );
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Background agent webhook proof failed: ${message}`);
    process.exit(1);
  });
}
