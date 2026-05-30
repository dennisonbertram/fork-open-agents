import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { apiTokens, type ApiToken } from "@/lib/db/schema";

export const API_TOKEN_PREFIX = "oa_";

export const AGENT_API_SCOPES = [
  "agent_runs:create",
  "agent_runs:read",
  "agent_runs:cancel",
] as const;

export type AgentApiScope = (typeof AGENT_API_SCOPES)[number];

export type TokenRepositoryPolicy = {
  allowedRepositories: string[] | null;
};

export type CreateApiTokenInput = {
  userId: string;
  name: string;
  scopes: AgentApiScope[];
  allowedRepositories?: string[] | null;
  expiresAt?: Date | null;
  metadata?: Record<string, unknown>;
};

export type CreatedApiToken = {
  token: RedactedApiToken;
  rawToken: string;
};

export type RedactedApiToken = {
  id: string;
  name: string;
  prefix: string;
  start: string;
  last4: string;
  scopes: string[];
  repositoryPolicy: TokenRepositoryPolicy;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  rateLimitEnabled: boolean;
  rateLimitWindowMs: number;
  rateLimitMax: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ApiTokenVerification =
  | {
      ok: true;
      token: ApiToken;
      userId: string;
      scopes: string[];
      repositoryPolicy: TokenRepositoryPolicy;
    }
  | {
      ok: false;
      status: 401 | 403;
      code: string;
      message: string;
    };

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function hashIdempotencyKey(key: string): string {
  return hashSecret(`idempotency:${key}`);
}

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

function normalizeScopes(scopes: string[]): AgentApiScope[] {
  const scopeSet = new Set(scopes);
  return AGENT_API_SCOPES.filter((scope) => scopeSet.has(scope));
}

function normalizeRepositories(
  repositories: string[] | null | undefined,
): string[] | null {
  if (repositories == null) {
    return null;
  }

  return Array.from(
    new Set(
      repositories
        .map((repo) => repo.trim().toLowerCase())
        .filter((repo) => /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repo)),
    ),
  ).sort();
}

function toRepositoryPolicy(value: unknown): TokenRepositoryPolicy {
  if (
    value &&
    typeof value === "object" &&
    "allowedRepositories" in value &&
    (Array.isArray(value.allowedRepositories) ||
      value.allowedRepositories === null)
  ) {
    return {
      allowedRepositories: value.allowedRepositories,
    };
  }

  return { allowedRepositories: null };
}

export function toRedactedApiToken(token: ApiToken): RedactedApiToken {
  return {
    id: token.id,
    name: token.name,
    prefix: token.prefix,
    start: token.start,
    last4: token.last4,
    scopes: token.scopes,
    repositoryPolicy: toRepositoryPolicy(token.repositoryPolicy),
    expiresAt: token.expiresAt?.toISOString() ?? null,
    revokedAt: token.revokedAt?.toISOString() ?? null,
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    rateLimitEnabled: token.rateLimitEnabled,
    rateLimitWindowMs: token.rateLimitWindowMs,
    rateLimitMax: token.rateLimitMax,
    metadata: token.metadata,
    createdAt: token.createdAt.toISOString(),
    updatedAt: token.updatedAt.toISOString(),
  };
}

export async function createApiToken(
  input: CreateApiTokenInput,
): Promise<CreatedApiToken> {
  const secret = randomBytes(32).toString("base64url");
  const rawToken = `${API_TOKEN_PREFIX}${secret}`;
  const [token] = await db
    .insert(apiTokens)
    .values({
      id: `atok_${nanoid()}`,
      userId: input.userId,
      name: input.name.trim(),
      tokenHash: hashSecret(rawToken),
      prefix: API_TOKEN_PREFIX,
      start: rawToken.slice(0, 10),
      last4: rawToken.slice(-4),
      scopes: normalizeScopes(input.scopes),
      repositoryPolicy: {
        allowedRepositories: normalizeRepositories(input.allowedRepositories),
      },
      expiresAt: input.expiresAt ?? null,
      metadata: input.metadata ?? {},
    })
    .returning();

  if (!token) {
    throw new Error("Failed to create API token");
  }

  return {
    token: toRedactedApiToken(token),
    rawToken,
  };
}

export async function listApiTokensForUser(
  userId: string,
): Promise<RedactedApiToken[]> {
  const rows = await db.query.apiTokens.findMany({
    where: eq(apiTokens.userId, userId),
    orderBy: [desc(apiTokens.createdAt)],
  });

  return rows.map(toRedactedApiToken);
}

export async function revokeApiToken(params: {
  userId: string;
  tokenId: string;
}): Promise<RedactedApiToken | null> {
  const [token] = await db
    .update(apiTokens)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(apiTokens.id, params.tokenId),
        eq(apiTokens.userId, params.userId),
      ),
    )
    .returning();

  return token ? toRedactedApiToken(token) : null;
}

export async function verifyBearerApiToken(params: {
  authorization: string | null;
  requiredScopes: AgentApiScope[];
  userAgent?: string | null;
}): Promise<ApiTokenVerification> {
  const match = params.authorization?.match(/^Bearer\s+(.+)$/i);
  const rawToken = match?.[1]?.trim();
  if (!rawToken || !rawToken.startsWith(API_TOKEN_PREFIX)) {
    return {
      ok: false,
      status: 401,
      code: "invalid_token",
      message: "A valid bearer API token is required.",
    };
  }

  const tokenHash = hashSecret(rawToken);
  const token = await db.query.apiTokens.findFirst({
    where: and(
      eq(apiTokens.start, rawToken.slice(0, 10)),
      isNull(apiTokens.revokedAt),
    ),
  });

  if (!token || !safeEqual(token.tokenHash, tokenHash)) {
    return {
      ok: false,
      status: 401,
      code: "invalid_token",
      message: "A valid bearer API token is required.",
    };
  }

  if (token.revokedAt) {
    return {
      ok: false,
      status: 401,
      code: "token_revoked",
      message: "The API token has been revoked.",
    };
  }

  if (token.expiresAt && token.expiresAt.getTime() <= Date.now()) {
    return {
      ok: false,
      status: 401,
      code: "token_expired",
      message: "The API token has expired.",
    };
  }

  const missingScope = params.requiredScopes.find(
    (scope) => !token.scopes.includes(scope),
  );
  if (missingScope) {
    return {
      ok: false,
      status: 403,
      code: "missing_scope",
      message: `The API token is missing scope ${missingScope}.`,
    };
  }

  await db
    .update(apiTokens)
    .set({
      lastUsedAt: new Date(),
      lastUsedUserAgent: params.userAgent ?? null,
      updatedAt: new Date(),
    })
    .where(eq(apiTokens.id, token.id));

  return {
    ok: true,
    token,
    userId: token.userId,
    scopes: token.scopes,
    repositoryPolicy: toRepositoryPolicy(token.repositoryPolicy),
  };
}
