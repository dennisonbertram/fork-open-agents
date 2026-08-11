import { createHash, randomBytes } from "node:crypto";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuthMiddleware } from "better-auth/api";
import { mcp } from "better-auth/plugins";
import { beforeAll, describe, expect, test } from "bun:test";
import { MCP_SCOPES } from "@/lib/mcp-server/context";
import { forceMcpConsentPrompt } from "./mcp-consent-hook";

/**
 * These tests drive a REAL better-auth instance (memory adapter + the real
 * mcp plugin + the real forceMcpConsentPrompt hook, wired the same way
 * config.ts wires them) through real Request objects. Unlike
 * mcp-consent-gate.test.ts (which only unit-tests the pure hook function),
 * these fail if the hooks.before wiring is ever deleted from config.ts,
 * or if the consent gate at /mcp/token and /oauth2/consent is missing.
 *
 * Cases 3 and 5 are expected to FAIL until F1 and F2 are fixed.
 */

const BASE_URL = "http://localhost:3100";
const BASE_PATH = "/api/auth";
const REDIRECT_URI = "https://mcp-client.example.com/callback";

function endpointUrl(path: string): string {
  return `${BASE_URL}${BASE_PATH}${path}`;
}

function createTestAuth() {
  const db = {
    user: [],
    session: [],
    account: [],
    verification: [],
    oauthApplication: [],
    oauthAccessToken: [],
    oauthConsent: [],
  };

  return betterAuth({
    secret: "mcp-consent-flow-test-secret",
    baseURL: BASE_URL,
    basePath: BASE_PATH,
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    // Same wiring as apps/web/lib/auth/config.ts: the real hook, forcing
    // consent on every /mcp/authorize request.
    hooks: {
      before: createAuthMiddleware(async (ctx) => forceMcpConsentPrompt(ctx)),
    },
    plugins: [
      mcp({
        loginPage: "/mcp/login",
        oidcConfig: {
          loginPage: "/mcp/login",
          consentPage: "/mcp/consent",
          scopes: [...MCP_SCOPES],
          defaultScope: "sessions:read",
          requirePKCE: true,
          allowPlainCodeChallengeMethod: false,
        },
      }),
    ],
  });
}

type Auth = ReturnType<typeof createTestAuth>;

function extractCookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((raw) => raw.split(";")[0])
    .join("; ");
}

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function signUpUser(auth: Auth, email: string): Promise<string> {
  const response = await auth.handler(
    new Request(endpointUrl("/sign-up/email"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: email,
        email,
        password: "correct-horse-battery-staple",
      }),
    }),
  );
  if (response.status !== 200) {
    throw new Error(
      `sign-up failed: ${response.status} ${await response.text()}`,
    );
  }
  return extractCookieHeader(response);
}

async function registerClient(auth: Auth): Promise<string> {
  const response = await auth.handler(
    new Request(endpointUrl("/mcp/register"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: "none",
      }),
    }),
  );
  if (response.status !== 201) {
    throw new Error(
      `client registration failed: ${response.status} ${await response.text()}`,
    );
  }
  const body = (await response.json()) as { client_id: string };
  return body.client_id;
}

function authorizeQuery(
  clientId: string,
  challenge: string,
  extraRaw?: string,
): string {
  const base = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: "sessions:read",
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return extraRaw ? `${base}&${extraRaw}` : base;
}

async function authorize(
  auth: Auth,
  cookie: string,
  query: string,
): Promise<Response> {
  return auth.handler(
    new Request(`${endpointUrl("/mcp/authorize")}?${query}`, {
      method: "GET",
      headers: { cookie },
    }),
  );
}

function consentCodeFromLocation(location: string): string {
  const value = new URL(location, BASE_URL).searchParams.get("consent_code");
  if (!value) {
    throw new Error(`no consent_code in Location header: ${location}`);
  }
  return value;
}

/**
 * True only if the redirect carries a real OAuth authorization "code"
 * param. Deliberately NOT a substring check on "code=" — the consent
 * redirect legitimately carries "consent_code=", which contains that
 * substring, so a naive substring check would false-fail the happy path.
 */
function hasAuthorizationCodeParam(location: string): boolean {
  return new URL(location, BASE_URL).searchParams.has("code");
}

async function redeemToken(
  auth: Auth,
  clientId: string,
  code: string,
  verifier: string,
): Promise<Response> {
  return auth.handler(
    new Request(endpointUrl("/mcp/token"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: clientId,
        code_verifier: verifier,
      }),
    }),
  );
}

async function postConsent(
  auth: Auth,
  cookie: string,
  consentCode: string,
  accept: boolean,
): Promise<Response> {
  return auth.handler(
    new Request(endpointUrl("/oauth2/consent"), {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ accept, consent_code: consentCode }),
    }),
  );
}

describe("mcp consent flow (real better-auth instance)", () => {
  let auth: Auth;
  let ownerCookie: string;
  let attackerCookie: string;
  let clientId: string;

  beforeAll(async () => {
    auth = createTestAuth();
    ownerCookie = await signUpUser(auth, "owner@example.com");
    attackerCookie = await signUpUser(auth, "attacker@example.com");
    clientId = await registerClient(auth);
  });

  test("1. authorize redirects to /mcp/consent, never to the client redirect_uri with a code", async () => {
    const { challenge } = pkcePair();
    const response = await authorize(
      auth,
      ownerCookie,
      authorizeQuery(clientId, challenge),
    );

    expect(response.status).toBe(302);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("/mcp/consent");
    expect(location).not.toContain(REDIRECT_URI);
    expect(hasAuthorizationCodeParam(location)).toBe(false);
  });

  test("2. prompt=none, and duplicated prompt=none&prompt=none, both still land on /mcp/consent", async () => {
    const { challenge: challengeA } = pkcePair();
    const responseA = await authorize(
      auth,
      ownerCookie,
      authorizeQuery(clientId, challengeA, "prompt=none"),
    );
    expect(responseA.status).toBe(302);
    const locationA = responseA.headers.get("location") ?? "";
    expect(locationA).toContain("/mcp/consent");
    expect(hasAuthorizationCodeParam(locationA)).toBe(false);

    const { challenge: challengeB } = pkcePair();
    const responseB = await authorize(
      auth,
      ownerCookie,
      authorizeQuery(clientId, challengeB, "prompt=none&prompt=none"),
    );
    expect(responseB.status).toBe(302);
    const locationB = responseB.headers.get("location") ?? "";
    expect(locationB).toContain("/mcp/consent");
    expect(hasAuthorizationCodeParam(locationB)).toBe(false);
  });

  test("3. [F1] redeeming the raw consent_code at /mcp/token WITHOUT approval must not mint an access token", async () => {
    const { verifier, challenge } = pkcePair();
    const authorizeResponse = await authorize(
      auth,
      ownerCookie,
      authorizeQuery(clientId, challenge),
    );
    const consentCode = consentCodeFromLocation(
      authorizeResponse.headers.get("location") ?? "",
    );

    // No POST to /oauth2/consent happened. This is the raw code that sat
    // in the victim's URL bar after the 302 to /mcp/consent.
    const tokenResponse = await redeemToken(
      auth,
      clientId,
      consentCode,
      verifier,
    );
    const tokenBody = await tokenResponse.json().catch(() => null);

    expect(tokenResponse.status).not.toBe(200);
    expect(tokenBody?.access_token).toBeUndefined();
  });

  test("3b. [F1] a non-string code cannot smuggle the same consent_code past the gate", async () => {
    // better-auth's /mcp/token body schema is z.record(z.any(), z.any()) and
    // its handler redeems code.toString(), so {"code": ["<consent_code>"]}
    // reaches the same verification row. A gate that only inspects
    // string-typed values is bypassed by one pair of brackets.
    const { verifier, challenge } = pkcePair();
    const authorizeResponse = await authorize(
      auth,
      ownerCookie,
      authorizeQuery(clientId, challenge),
    );
    const consentCode = consentCodeFromLocation(
      authorizeResponse.headers.get("location") ?? "",
    );

    const tokenResponse = await auth.handler(
      new Request(endpointUrl("/mcp/token"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code: [consentCode],
          redirect_uri: REDIRECT_URI,
          client_id: clientId,
          code_verifier: verifier,
        }),
      }),
    );
    const tokenBody = await tokenResponse.json().catch(() => null);

    expect(tokenResponse.status).not.toBe(200);
    expect(tokenBody?.access_token).toBeUndefined();
  });

  test("4. after Approve, the rotated code redeems successfully (happy path preserved)", async () => {
    const { verifier, challenge } = pkcePair();
    const authorizeResponse = await authorize(
      auth,
      ownerCookie,
      authorizeQuery(clientId, challenge),
    );
    const consentCode = consentCodeFromLocation(
      authorizeResponse.headers.get("location") ?? "",
    );

    const consentResponse = await postConsent(
      auth,
      ownerCookie,
      consentCode,
      true,
    );
    expect(consentResponse.status).toBe(200);
    const consentBody = (await consentResponse.json()) as {
      redirectURI: string;
    };
    const rotatedCode = new URL(consentBody.redirectURI).searchParams.get(
      "code",
    );
    expect(rotatedCode).toBeTruthy();

    const tokenResponse = await redeemToken(
      auth,
      clientId,
      rotatedCode as string,
      verifier,
    );
    expect(tokenResponse.status).toBe(200);
    const tokenBody = (await tokenResponse.json()) as {
      access_token?: string;
      scope?: string;
    };
    expect(tokenBody.access_token).toBeTruthy();
    expect(tokenBody.scope).toBe("sessions:read");
  });

  test("5. [F2] approving with a different user's session must be rejected", async () => {
    const { challenge } = pkcePair();
    const authorizeResponse = await authorize(
      auth,
      ownerCookie,
      authorizeQuery(clientId, challenge),
    );
    const consentCode = consentCodeFromLocation(
      authorizeResponse.headers.get("location") ?? "",
    );

    // The attacker has their own valid session but did not receive this
    // consent_code from a redirect of their own.
    const consentResponse = await postConsent(
      auth,
      attackerCookie,
      consentCode,
      true,
    );

    expect(consentResponse.status).toBe(401);
  });
});
