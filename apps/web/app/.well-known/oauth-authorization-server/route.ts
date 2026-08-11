import { auth } from "@/lib/auth/config";

// OAuth 2.0 Authorization Server Metadata (RFC 8414), required by MCP
// clients to discover the authorize/token endpoints. No auth required.
//
// better-auth's own handler for this document (`oAuthDiscoveryMetadata`,
// backed by `getMCPProviderMetadata`) computes the `issuer` claim from
// `ctx.context.options.baseURL` with a bare `typeof === "string"` check.
// This app's `baseURL` is the dynamic `{ allowedHosts, fallback }` form (see
// lib/auth/config.ts), which is never a string, so that check always fails,
// the endpoint throws APIError("INTERNAL_SERVER_ERROR"), and better-auth's
// own catch block swallows it and returns HTTP 200 with body `null` — no
// MCP client can ever discover the authorize/token/registration endpoints.
//
// Build the metadata ourselves instead. The origin is resolved the same way
// better-auth resolves it for every other MCP endpoint: via
// `getMCPProtectedResource`, which reads `ctx.context.baseURL` (correctly
// resolved per-request against `allowedHosts`/`fallback`), not the raw
// `options.baseURL` config object.
export async function GET(request: Request): Promise<Response> {
  const protectedResource = await auth.api.getMCPProtectedResource({
    request,
    asResponse: false,
  });

  const origin = protectedResource.resource;
  // `auth.options` is inferred from the literal config object, which never
  // sets `basePath`, so the property is absent from its type even though
  // better-auth reads it at runtime. Narrow rather than assume, so this keeps
  // working if the config ever does set one.
  const basePath =
    (auth.options as { basePath?: string }).basePath ?? "/api/auth";
  const authBase = `${origin}${basePath}`;

  const metadata = {
    issuer: origin,
    authorization_endpoint: `${authBase}/mcp/authorize`,
    token_endpoint: `${authBase}/mcp/token`,
    userinfo_endpoint: `${authBase}/mcp/userinfo`,
    jwks_uri: `${authBase}/mcp/jwks`,
    registration_endpoint: `${authBase}/mcp/register`,
    scopes_supported: protectedResource.scopes_supported,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    acr_values_supported: [
      "urn:mace:incommon:iap:silver",
      "urn:mace:incommon:iap:bronze",
    ],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256", "none"],
    token_endpoint_auth_methods_supported: [
      "client_secret_basic",
      "client_secret_post",
      "none",
    ],
    code_challenge_methods_supported: ["S256"],
    claims_supported: [
      "sub",
      "iss",
      "aud",
      "exp",
      "nbf",
      "iat",
      "jti",
      "email",
      "email_verified",
      "name",
    ],
  };

  return new Response(JSON.stringify(metadata), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}
