import { APIError, getSessionFromCtx } from "better-auth/api";

const MCP_AUTHORIZE_PATH = "/mcp/authorize";
const MCP_TOKEN_PATH = "/mcp/token";
const OAUTH_CONSENT_PATH = "/oauth2/consent";

type VerificationValue = {
  requireConsent?: boolean;
  userId?: string;
};

type VerificationRecord = {
  value: string;
};

type InternalAdapter = {
  findVerificationValue: (
    identifier: string,
  ) => Promise<VerificationRecord | null>;
};

export type McpConsentHookContext = {
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  getSignedCookie?: (
    key: string,
    secret: string,
  ) => Promise<string | false | null>;
  context?: {
    internalAdapter?: InternalAdapter;
    secret?: string;
  };
};

type ForceConsentResult = { context: { query: Record<string, unknown> } };

function extractBodyRecord(body: unknown): Record<string, unknown> | undefined {
  // The router already normalizes FormData/urlencoded bodies into plain
  // objects before hooks run (see better-call's getBody), but the real
  // /mcp/token and /oauth2/consent handlers defensively re-check for
  // FormData too — mirror that here.
  if (body instanceof FormData) {
    return Object.fromEntries(body.entries());
  }
  if (body && typeof body === "object") {
    return body as Record<string, unknown>;
  }
  return undefined;
}

function readStringField(
  record: Record<string, unknown> | undefined,
  field: string,
): string | undefined {
  const value = record?.[field];
  return typeof value === "string" && value ? value : undefined;
}

/**
 * better-auth's /mcp/token body schema is `z.record(z.any(), z.any())` and its
 * handler redeems `code.toString()`, so a non-string `code` (for example
 * `{"code": ["<consent_code>"]}`) reaches the same verification row. Reading
 * only string-typed values here would let that shape walk straight past the
 * consent check, so mirror the endpoint's coercion exactly.
 */
function readCoercedCodeField(
  record: Record<string, unknown> | undefined,
  field: string,
): string | undefined {
  const value = record?.[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  return String(value) || undefined;
}

function parseVerificationValue(raw: string): VerificationValue | null {
  try {
    return JSON.parse(raw) as VerificationValue;
  } catch {
    return null;
  }
}

/**
 * F1: better-auth's /mcp/token handler (better-auth/dist/plugins/mcp/index.mjs)
 * redeems any unexpired verification code — it checks expiry, client_id,
 * redirect_uri, and PKCE, but never reads `value.requireConsent`. The
 * consent_code that lands in the victim's URL bar after the redirect to
 * /mcp/consent is itself a valid, redeemable authorization code for 600s.
 * Refuse redemption while requireConsent is still true. Read-only: the real
 * endpoint owns the verification record's lifecycle (deletes/rotates it).
 */
function refuseUnapprovedTokenRedemption(
  ctx: McpConsentHookContext,
): Promise<undefined> | undefined {
  const internalAdapter = ctx.context?.internalAdapter;
  const code = readCoercedCodeField(extractBodyRecord(ctx.body), "code");
  if (!(internalAdapter && code)) {
    return undefined;
  }

  return internalAdapter.findVerificationValue(code).then((record) => {
    const value = record ? parseVerificationValue(record.value) : null;
    if (value?.requireConsent) {
      throw new APIError("UNAUTHORIZED", {
        error: "invalid_grant",
        error_description:
          "This authorization code has not been approved by the user yet.",
      });
    }
    return undefined;
  });
}

async function resolveConsentCode(
  ctx: McpConsentHookContext,
  bodyConsentCode: string | undefined,
): Promise<string | undefined> {
  if (bodyConsentCode) {
    return bodyConsentCode;
  }
  const secret = ctx.context?.secret;
  if (!(ctx.getSignedCookie && secret)) {
    return undefined;
  }
  const cookieValue = await ctx.getSignedCookie("oidc_consent_prompt", secret);
  return cookieValue ? cookieValue : undefined;
}

/**
 * F2: /oauth2/consent (better-auth/dist/plugins/oidc-provider/index.mjs)
 * authenticates the caller via sessionMiddleware but never checks that the
 * consent_code belongs to that session — posting a victim's consent_code
 * with an attacker's own valid session approves access on the victim's
 * behalf. Resolve the session ourselves (sessionMiddleware only runs inside
 * the endpoint, after this hook) and require it to match value.userId.
 */
function refuseConsentForOtherUsers(
  ctx: McpConsentHookContext,
): Promise<undefined> | undefined {
  const internalAdapter = ctx.context?.internalAdapter;
  if (!internalAdapter) {
    return undefined;
  }
  const bodyConsentCode = readStringField(
    extractBodyRecord(ctx.body),
    "consent_code",
  );

  return resolveConsentCode(ctx, bodyConsentCode).then(async (consentCode) => {
    if (!consentCode) {
      return undefined;
    }
    const record = await internalAdapter.findVerificationValue(consentCode);
    const value = record ? parseVerificationValue(record.value) : null;
    if (!value?.userId) {
      return undefined;
    }
    const session = await getSessionFromCtx(
      ctx as unknown as Parameters<typeof getSessionFromCtx>[0],
    );
    if (!session || session.user.id !== value.userId) {
      throw new APIError("UNAUTHORIZED", {
        error: "invalid_grant",
        error_description: "This approval link belongs to a different account.",
      });
    }
    return undefined;
  });
}

/**
 * better-auth's /mcp/authorize only shows the consent page when the
 * incoming request already has `prompt=consent` — otherwise it redirects
 * straight to the client's redirect_uri with a code (see authorize.mjs).
 * Force it on every authorize request so no client can skip user approval.
 *
 * Also closes two gaps in the same request lifecycle: an unapproved
 * consent_code being redeemed directly at /mcp/token (F1), and an
 * approval request at /oauth2/consent whose consent_code belongs to a
 * different user's session (F2).
 */
export function forceMcpConsentPrompt(
  ctx: McpConsentHookContext,
): ForceConsentResult | undefined {
  if (ctx.path === MCP_AUTHORIZE_PATH) {
    return {
      context: {
        query: { ...ctx.query, prompt: "consent" },
      },
    };
  }

  if (ctx.path === MCP_TOKEN_PATH) {
    // Runs synchronously (returns undefined) whenever there's no runtime
    // context/code to check — exactly the shape the unit tests in
    // mcp-consent-gate.test.ts exercise. Against a real better-auth
    // instance it does an async verification lookup and returns a Promise
    // instead; createAuthMiddleware awaits the before-hook's return value
    // either way, so the declared synchronous return type here (matching
    // this function's pre-existing public signature) is safe to widen at
    // the call site.
    return refuseUnapprovedTokenRedemption(ctx) as
      | ForceConsentResult
      | undefined;
  }

  if (ctx.path === OAUTH_CONSENT_PATH) {
    return refuseConsentForOtherUsers(ctx) as ForceConsentResult | undefined;
  }

  return undefined;
}
