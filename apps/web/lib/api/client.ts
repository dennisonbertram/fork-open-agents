import createClient, { type Client } from "openapi-fetch";
import type { paths } from "./openapi-types";

/**
 * Typed HTTP client for the Open Agents API, generated from the OpenAPI
 * contract (openapi.json ← lib/api/openapi-spec.ts ← route Zod schemas). The
 * frontend should call the API through this so request/response types stay in
 * lockstep with the backend contract:
 *
 *   const api = createOpenAgentsApiClient();
 *   const { data, error } = await api.GET("/api/settings/skills");
 *   //      ^? { skills: UserSkill[] } | undefined
 *
 * Paths, methods, params, request bodies, and response shapes are all checked
 * against the spec at compile time.
 */
export type OpenAgentsApiClient = Client<paths>;

export type CreateApiClientOptions = {
  /** Base URL. Defaults to "" (same-origin — correct in the browser). */
  baseUrl?: string;
  /** Override fetch (tests / server-side). Defaults to global fetch. */
  fetch?: (request: Request) => Promise<Response>;
};

export function createOpenAgentsApiClient(
  options: CreateApiClientOptions = {},
): OpenAgentsApiClient {
  return createClient<paths>({
    baseUrl: options.baseUrl ?? "",
    fetch: options.fetch,
  });
}
