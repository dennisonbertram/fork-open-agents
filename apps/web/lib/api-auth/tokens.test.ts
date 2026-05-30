import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import type { ApiToken } from "@/lib/db/schema";

mock.module("server-only", () => ({}));

const now = new Date("2026-05-30T12:00:00.000Z");
const validRawToken = "oa_secret_token_1234";

let currentToken: ApiToken | null;
let insertedValues: Record<string, unknown> | null;
let updateValues: Record<string, unknown> | null;

const findFirst = mock(async () => currentToken);
const findMany = mock(async () => (currentToken ? [currentToken] : []));
const returning = mock(async () => {
  if (!insertedValues) {
    return [];
  }

  return [
    {
      ...insertedValues,
      revokedAt: null,
      lastUsedAt: null,
      lastUsedUserAgent: null,
      rateLimitEnabled: true,
      rateLimitWindowMs: 60_000,
      rateLimitMax: 60,
      createdAt: now,
      updatedAt: now,
    },
  ];
});
const values = mock((input: Record<string, unknown>) => {
  insertedValues = input;
  return { returning };
});
const where = mock(async () => []);
const set = mock((input: Record<string, unknown>) => {
  updateValues = input;
  return { where };
});

mock.module("@/lib/db/client", () => ({
  db: {
    insert: mock(() => ({ values })),
    update: mock(() => ({ set })),
    query: {
      apiTokens: {
        findFirst,
        findMany,
      },
    },
  },
}));

const tokensModulePromise = import("./tokens");

function token(overrides: Partial<ApiToken> = {}): ApiToken {
  return {
    id: "atok_1",
    userId: "user_1",
    name: "Local CLI",
    tokenHash: createHash("sha256").update(validRawToken).digest("hex"),
    prefix: "oa_",
    start: validRawToken.slice(0, 10),
    last4: "1234",
    scopes: ["agent_runs:create", "agent_runs:read", "agent_runs:cancel"],
    repositoryPolicy: { allowedRepositories: ["acme/widgets"] },
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    lastUsedUserAgent: null,
    rateLimitEnabled: true,
    rateLimitWindowMs: 60_000,
    rateLimitMax: 60,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as ApiToken;
}

describe("API token helpers", () => {
  beforeEach(() => {
    currentToken = null;
    insertedValues = null;
    updateValues = null;
    findFirst.mockClear();
    findMany.mockClear();
    returning.mockClear();
    values.mockClear();
    where.mockClear();
    set.mockClear();
  });

  test("creates a one-time raw token while storing only hash metadata", async () => {
    const { API_TOKEN_PREFIX, createApiToken } = await tokensModulePromise;

    const created = await createApiToken({
      userId: "user_1",
      name: "  Local CLI  ",
      scopes: ["agent_runs:create", "agent_runs:read"],
      allowedRepositories: ["Acme/Widgets", "acme/widgets", "bad repo"],
      metadata: { client: "cli" },
    });

    expect(created.rawToken.startsWith(API_TOKEN_PREFIX)).toBe(true);
    expect(insertedValues).toMatchObject({
      userId: "user_1",
      name: "Local CLI",
      prefix: API_TOKEN_PREFIX,
      scopes: ["agent_runs:create", "agent_runs:read"],
      repositoryPolicy: { allowedRepositories: ["acme/widgets"] },
      metadata: { client: "cli" },
    });
    expect(insertedValues?.tokenHash).toEqual(expect.any(String));
    expect(insertedValues?.tokenHash).not.toBe(created.rawToken);
    expect(created.token).toEqual(
      expect.not.objectContaining({
        rawToken: expect.any(String),
        tokenHash: expect.any(String),
      }),
    );
  });

  test("rejects missing and malformed bearer tokens before database writes", async () => {
    const { verifyBearerApiToken } = await tokensModulePromise;

    const result = await verifyBearerApiToken({
      authorization: "Bearer not-open-agents",
      requiredScopes: ["agent_runs:create"],
    });

    expect(result).toMatchObject({
      ok: false,
      status: 401,
      code: "invalid_token",
    });
    expect(findFirst).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  test("rejects missing scopes without updating last-used metadata", async () => {
    const { verifyBearerApiToken } = await tokensModulePromise;
    currentToken = token({ scopes: ["agent_runs:read"] });

    const result = await verifyBearerApiToken({
      authorization: `Bearer ${validRawToken}`,
      requiredScopes: ["agent_runs:create"],
    });

    expect(result).toMatchObject({
      ok: false,
      status: 403,
      code: "missing_scope",
    });
    expect(set).not.toHaveBeenCalled();
  });

  test("accepts a valid token and records redacted last-used metadata", async () => {
    const { verifyBearerApiToken } = await tokensModulePromise;
    currentToken = token();

    const result = await verifyBearerApiToken({
      authorization: `Bearer ${validRawToken}`,
      requiredScopes: ["agent_runs:create"],
      userAgent: "agent-api-smoke/1.0",
    });

    expect(result).toMatchObject({
      ok: true,
      userId: "user_1",
      scopes: ["agent_runs:create", "agent_runs:read", "agent_runs:cancel"],
      repositoryPolicy: { allowedRepositories: ["acme/widgets"] },
    });
    expect(updateValues).toMatchObject({
      lastUsedUserAgent: "agent-api-smoke/1.0",
    });
    expect(updateValues).toEqual(
      expect.not.objectContaining({
        tokenHash: expect.any(String),
      }),
    );
  });
});
