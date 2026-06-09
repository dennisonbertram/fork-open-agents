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
 * default). Without CONTRACT_BASE_URL the suites skip, so `bun run ci` stays
 * green.
 */
export const CONTRACT_BASE_URL = (process.env.CONTRACT_BASE_URL ?? "").replace(
  /\/$/,
  "",
);
export const contractEnabled = CONTRACT_BASE_URL.length > 0;

const authCookie = `${TEST_AUTH_COOKIE}=${encodeURIComponent(TEST_AUTH_USER_ID)}`;

export type ApiFetchOptions = {
  method?: string;
  body?: unknown;
  /** Send the test-auth cookie. Defaults to true. */
  auth?: boolean;
  headers?: Record<string, string>;
};

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
  const res = await apiFetch(path, options);
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data: data as T };
}
