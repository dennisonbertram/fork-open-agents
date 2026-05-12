import "server-only";

import { z } from "zod";

const booleanStringSchema = z
  .string()
  .optional()
  .transform((value) => value === "true");

const optionalNonEmptyStringSchema = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
  });

const rawHarnessConfigSchema = z.object({
  HARNESS_ENABLED: booleanStringSchema,
  HARNESS_BASE_URL: optionalNonEmptyStringSchema,
  HARNESS_SERVICE_TOKEN: optionalNonEmptyStringSchema,
  HARNESS_TENANT_ID: optionalNonEmptyStringSchema,
  HARNESS_DEFAULT_PROJECT_ID: optionalNonEmptyStringSchema,
  HARNESS_ALLOWED_DIRECT_MODE: booleanStringSchema,
  HARNESS_LOG_JSON: booleanStringSchema,
  HARNESS_REQUEST_TIMEOUT_MS: z
    .string()
    .optional()
    .transform((value) => {
      if (!value || value.trim().length === 0) {
        return 15_000;
      }
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : Number.NaN;
    }),
  HARNESS_SSE_REPLAY_LIMIT: z
    .string()
    .optional()
    .transform((value) => {
      if (!value || value.trim().length === 0) {
        return 100;
      }
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : Number.NaN;
    }),
});

export type HarnessConfig =
  | {
      enabled: false;
      allowedDirectMode: boolean;
      logJson: boolean;
      requestTimeoutMs: number;
      sseReplayLimit: number;
    }
  | {
      enabled: true;
      baseUrl: string;
      serviceToken: string;
      tenantId: string;
      defaultProjectId?: string;
      allowedDirectMode: boolean;
      logJson: boolean;
      requestTimeoutMs: number;
      sseReplayLimit: number;
    };

export class HarnessConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarnessConfigError";
  }
}

function parseHarnessOrigin(rawBaseUrl: string | undefined): string {
  if (!rawBaseUrl) {
    throw new HarnessConfigError("HARNESS_BASE_URL is required when enabled");
  }

  let url: URL;
  try {
    url = new URL(rawBaseUrl);
  } catch {
    throw new HarnessConfigError("HARNESS_BASE_URL must be a valid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HarnessConfigError("HARNESS_BASE_URL must use http or https");
  }

  if (url.username || url.password) {
    throw new HarnessConfigError(
      "HARNESS_BASE_URL must not include credentials",
    );
  }

  const hasPath = url.pathname !== "" && url.pathname !== "/";
  if (hasPath || url.search || url.hash) {
    throw new HarnessConfigError("HARNESS_BASE_URL must be an origin only");
  }

  return url.origin;
}

function requireEnabledValue(value: string | undefined, name: string): string {
  if (!value) {
    throw new HarnessConfigError(`${name} is required when enabled`);
  }
  return value;
}

export function getHarnessConfig(
  env: NodeJS.ProcessEnv = process.env,
): HarnessConfig {
  const parsed = rawHarnessConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new HarnessConfigError("Harness environment is invalid");
  }

  const raw = parsed.data;
  if (Number.isNaN(raw.HARNESS_REQUEST_TIMEOUT_MS)) {
    throw new HarnessConfigError("HARNESS_REQUEST_TIMEOUT_MS must be positive");
  }
  if (Number.isNaN(raw.HARNESS_SSE_REPLAY_LIMIT)) {
    throw new HarnessConfigError("HARNESS_SSE_REPLAY_LIMIT must be positive");
  }

  const common = {
    allowedDirectMode: raw.HARNESS_ALLOWED_DIRECT_MODE,
    logJson: raw.HARNESS_LOG_JSON,
    requestTimeoutMs: raw.HARNESS_REQUEST_TIMEOUT_MS,
    sseReplayLimit: raw.HARNESS_SSE_REPLAY_LIMIT,
  };

  if (!raw.HARNESS_ENABLED) {
    return {
      enabled: false,
      ...common,
    };
  }

  return {
    enabled: true,
    baseUrl: parseHarnessOrigin(raw.HARNESS_BASE_URL),
    serviceToken: requireEnabledValue(
      raw.HARNESS_SERVICE_TOKEN,
      "HARNESS_SERVICE_TOKEN",
    ),
    tenantId: requireEnabledValue(raw.HARNESS_TENANT_ID, "HARNESS_TENANT_ID"),
    ...(raw.HARNESS_DEFAULT_PROJECT_ID
      ? { defaultProjectId: raw.HARNESS_DEFAULT_PROJECT_ID }
      : {}),
    ...common,
  };
}
