import { TEST_AUTH_COOKIE, TEST_AUTH_USER_ID } from "@/lib/session/test-auth";

/**
 * Shared client for the HTTP API contract tests. These run against a REAL
 * running server (not mocks) using the dev test-auth cookie, so they verify
 * the actual HTTP contract: status codes, response shapes, and auth/ownership
 * gating. Point them at a local dev server or a protected preview deployment:
 *
 *   CONTRACT_BASE_URL=http://localhost:3013 bun run test:contract
 *
 * The server must run with OPEN_AGENTS_ENABLE_TEST_AUTH=1 (dev does this by
 * default). For a protected Vercel preview, also set
 * VERCEL_AUTOMATION_BYPASS_SECRET so requests pass deployment protection.
 *
 * Without CONTRACT_BASE_URL the suites skip, so `bun run ci` stays green. Set
 * CONTRACT_REQUIRED=1 when the suite is required proof; missing capabilities
 * then fail before any suite can skip.
 */
export const CONTRACT_BASE_URL = (process.env.CONTRACT_BASE_URL ?? "").replace(
  /\/$/,
  "",
);
export const contractEnabled = CONTRACT_BASE_URL.length > 0;
export const contractRequired = process.env.CONTRACT_REQUIRED === "1";

export type ContractConfiguration = {
  required: boolean;
  baseUrl: string;
};

export function assertContractConfiguration({
  required,
  baseUrl,
}: ContractConfiguration): void {
  if (required && baseUrl.length === 0) {
    throw new Error(
      "contract_target_missing: CONTRACT_BASE_URL is required when CONTRACT_REQUIRED=1; set it to a reachable contract-test target",
    );
  }
}

assertContractConfiguration({
  required: contractRequired,
  baseUrl: CONTRACT_BASE_URL,
});

const authCookie = `${TEST_AUTH_COOKIE}=${encodeURIComponent(TEST_AUTH_USER_ID)}`;
// Bypasses Vercel deployment protection on protected previews. Sent on every
// request (it gates the platform, not the app session) when configured.
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();

export type ApiFetchOptions = {
  method?: string;
  body?: unknown;
  /** Send the test-auth cookie (app session). Defaults to true. */
  auth?: boolean;
  headers?: Record<string, string>;
  /**
   * Retry on a transient network error or 5xx. Use ONLY for idempotent reads
   * (GET) — a freshly-forked preview Neon branch can blip on its first
   * connection (DNS/cold pool). Defaults to 0.
   */
  retries?: number;
};

export function isRetryableContractRequest(
  method: string | undefined,
  status: number,
): boolean {
  return (method ?? "GET").toUpperCase() === "GET" && status >= 500;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function apiFetch(
  path: string,
  options: ApiFetchOptions = {},
): Promise<Response> {
  const { method = "GET", body, auth = true, headers = {} } = options;
  const finalHeaders: Record<string, string> = { ...headers };
  if (body !== undefined) {
    finalHeaders["Content-Type"] = "application/json";
  }
  if (auth) {
    finalHeaders.Cookie = authCookie;
  }
  if (bypassSecret) {
    finalHeaders["x-vercel-protection-bypass"] = bypassSecret;
  }
  return fetch(`${CONTRACT_BASE_URL}${path}`, {
    method,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function apiJson<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<{ status: number; data: T }> {
  const method = options.method ?? "GET";
  const retries = method.toUpperCase() === "GET" ? (options.retries ?? 0) : 0;
  let lastStatus = 0;
  let lastData: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await apiFetch(path, options);
      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (
        !isRetryableContractRequest(method, res.status) ||
        attempt === retries
      ) {
        return { status: res.status, data: data as T };
      }
      lastStatus = res.status;
      lastData = data;
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
    }
    await delay(500 * (attempt + 1));
  }

  return { status: lastStatus, data: lastData as T };
}

/**
 * Probe whether the target accepts the test-auth cookie. A target without
 * OPEN_AGENTS_ENABLE_TEST_AUTH (or missing the dev user) will 401 even with the
 * cookie — in that case the authenticated suites skip rather than fail, while
 * the unauthenticated auth-gating suite still runs. Evaluated once at import.
 */
async function probeAuthAvailable(): Promise<boolean> {
  if (!contractEnabled) {
    return false;
  }
  try {
    const { status } = await apiJson("/api/settings/preferences", {
      retries: 3,
    });
    return status === 200;
  } catch {
    return false;
  }
}

export const authAvailable = await probeAuthAvailable();

if (contractRequired && !authAvailable) {
  throw new Error(
    "test_auth_unavailable: CONTRACT_REQUIRED=1 requires the target to accept the fixed test-auth identity",
  );
}
