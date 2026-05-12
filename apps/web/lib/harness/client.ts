import type { HarnessConfig } from "./config";
import { getHarnessConfig } from "./config";
import { HarnessClientError } from "./client-error";
import type {
  HarnessJsonObject,
  HarnessReadiness,
  HarnessRequestContext,
  HarnessRunResponse,
  HarnessUiManifest,
} from "./types";

type FetchLike = typeof fetch;

function toErrorCode(status: number): string {
  if (status === 401) {
    return "harness_unauthorized";
  }
  if (status === 403) {
    return "harness_forbidden";
  }
  if (status === 400 || status === 422) {
    return "harness_invalid_request";
  }
  if (status === 413) {
    return "harness_payload_too_large";
  }
  if (status >= 500) {
    return "harness_internal_error";
  }
  return "harness_unavailable";
}

function buildUrl(baseUrl: string, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

async function readJsonObject(response: Response): Promise<HarnessJsonObject> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return {};
  }
  const parsed = (await response.json()) as unknown;
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as HarnessJsonObject)
    : {};
}

export class HarnessClient {
  private readonly config: Extract<HarnessConfig, { enabled: true }>;
  private readonly fetchImpl: FetchLike;

  constructor(
    config: Extract<HarnessConfig, { enabled: true }>,
    fetchImpl: FetchLike = fetch,
  ) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  private buildHeaders(context: HarnessRequestContext, json = true): Headers {
    const headers = new Headers();
    if (json) {
      headers.set("Content-Type", "application/json");
      headers.set("Accept", "application/json");
    } else {
      headers.set("Accept", "text/event-stream");
    }
    headers.set("Authorization", `Bearer ${this.config.serviceToken}`);
    headers.set("X-Open-Agents-Tenant", context.tenantId);
    if (context.projectId) {
      headers.set("X-Open-Agents-Project", context.projectId);
    }
    headers.set("X-Open-Agents-Actor", context.actorId);
    headers.set("X-Request-ID", context.requestId);
    return headers;
  }

  async requestJson<T extends HarnessJsonObject>(
    path: string,
    init: Omit<RequestInit, "headers" | "signal"> & {
      headers?: Record<string, string>;
    },
    context: HarnessRequestContext,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.requestTimeoutMs,
    );

    let response: Response;
    try {
      const headers = this.buildHeaders(context);
      for (const [key, value] of Object.entries(init.headers ?? {})) {
        headers.set(key, value);
      }

      response = await this.fetchImpl(buildUrl(this.config.baseUrl, path), {
        ...init,
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      throw new HarnessClientError({
        status: 504,
        code:
          error instanceof Error && error.name === "AbortError"
            ? "harness_timeout"
            : "harness_unavailable",
        message: "Verified Build harness is unavailable",
        requestId: context.requestId,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new HarnessClientError({
        status: response.status,
        code: toErrorCode(response.status),
        message: "Verified Build harness request failed",
        requestId: context.requestId,
      });
    }

    return (await readJsonObject(response)) as T;
  }

  async checkReadiness(
    context: HarnessRequestContext,
  ): Promise<HarnessReadiness> {
    const [health, ready, openapi, uiManifest] = await Promise.all([
      this.requestJson("/health", { method: "GET" }, context),
      this.requestJson("/ready", { method: "GET" }, context),
      this.requestJson("/openapi.json", { method: "GET" }, context),
      this.requestJson("/ui-manifest.json", { method: "GET" }, context),
    ]);

    return {
      enabled: true,
      requestId: context.requestId,
      health,
      ready,
      openapi,
      uiManifest: uiManifest as HarnessUiManifest,
    };
  }

  async createRun(params: {
    context: HarnessRequestContext;
    idempotencyKey: string;
    body: HarnessJsonObject;
  }): Promise<HarnessRunResponse> {
    return this.requestJson<HarnessRunResponse>(
      "/runs",
      {
        method: "POST",
        body: JSON.stringify(params.body),
        headers: {
          "Idempotency-Key": params.idempotencyKey,
        },
      },
      params.context,
    );
  }

  async getRun(params: {
    context: HarnessRequestContext;
    harnessRunId: string;
  }): Promise<HarnessRunResponse> {
    return this.requestJson<HarnessRunResponse>(
      `/runs/${encodeURIComponent(params.harnessRunId)}`,
      { method: "GET" },
      params.context,
    );
  }

  async runAction(params: {
    context: HarnessRequestContext;
    harnessRunId: string;
    action: "approve" | "cancel" | "repair";
    body?: HarnessJsonObject;
  }): Promise<HarnessJsonObject> {
    return this.requestJson(
      `/runs/${encodeURIComponent(params.harnessRunId)}/${params.action}`,
      {
        method: "POST",
        body: JSON.stringify(params.body ?? {}),
      },
      params.context,
    );
  }

  async getRunResource(params: {
    context: HarnessRequestContext;
    harnessRunId: string;
    resource: "artifacts" | "capsules" | "audit" | "trace";
  }): Promise<HarnessJsonObject> {
    return this.requestJson(
      `/runs/${encodeURIComponent(params.harnessRunId)}/${params.resource}`,
      { method: "GET" },
      params.context,
    );
  }

  async getTraceExportPlan(params: {
    context: HarnessRequestContext;
    harnessRunId: string;
  }): Promise<HarnessJsonObject> {
    return this.requestJson(
      `/runs/${encodeURIComponent(params.harnessRunId)}/trace/export-plan`,
      { method: "GET" },
      params.context,
    );
  }

  async getWorkcell(params: {
    context: HarnessRequestContext;
    workcellId: string;
  }): Promise<HarnessJsonObject> {
    return this.requestJson(
      `/workcells/${encodeURIComponent(params.workcellId)}`,
      { method: "GET" },
      params.context,
    );
  }

  async getArtifact(params: {
    context: HarnessRequestContext;
    artifactId: string;
  }): Promise<HarnessJsonObject> {
    return this.requestJson(
      `/artifacts/${encodeURIComponent(params.artifactId)}`,
      { method: "GET" },
      params.context,
    );
  }

  async openRunEvents(params: {
    context: HarnessRequestContext;
    harnessRunId: string;
    afterEventId?: string | null;
    replayLimit: number;
    signal?: AbortSignal;
  }): Promise<Response> {
    const url = new URL(
      buildUrl(
        this.config.baseUrl,
        `/runs/${encodeURIComponent(params.harnessRunId)}/events`,
      ),
    );
    if (params.afterEventId) {
      url.searchParams.set("after_event_id", params.afterEventId);
    }
    url.searchParams.set("limit", String(params.replayLimit));

    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: this.buildHeaders(params.context, false),
      signal: params.signal,
    });

    if (!response.ok || !response.body) {
      throw new HarnessClientError({
        status: response.status,
        code: toErrorCode(response.status),
        message: "Verified Build event stream failed",
        requestId: params.context.requestId,
      });
    }

    return response;
  }
}

export function createHarnessClient(
  config = getHarnessConfig(),
  fetchImpl?: FetchLike,
): HarnessClient {
  if (!config.enabled) {
    throw new HarnessClientError({
      status: 503,
      code: "harness_disabled",
      message: "Verified Build harness is disabled",
      requestId: crypto.randomUUID(),
    });
  }
  return new HarnessClient(config, fetchImpl);
}

export { HarnessClientError } from "./client-error";
