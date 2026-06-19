import "server-only";

import type { Octokit } from "@octokit/rest";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { verifyRepoAccess } from "@/lib/github/access";
import { withScopedInstallationOctokit } from "@/lib/github/app";
import {
  classifySecretsError,
  statusForSecretsErrorKind,
  type GithubSecretsErrorKind,
} from "@/lib/github/secrets-manager/errors";
import {
  getSecretsManagerReadinessCheck,
  type SecretsManagerReadinessVerdict,
} from "@/lib/github/secrets-manager/readiness";
import { emitSessionEvent } from "@/lib/observability/events";

export const SECRET_NAME_HELP =
  "Names use A-Z, 0-9, underscore; can't start with a number or GITHUB_.";
export const MAX_SECRET_BYTES = 48 * 1024;
const SECRET_NAME_PATTERN = /^(?!GITHUB_)(?![0-9])[A-Z0-9_]+$/;

export type SecretsRouteContext = {
  params: Promise<{ owner: string; repo: string }>;
};

export type SecretItemRouteContext = {
  params: Promise<{ owner: string; repo: string; name: string }>;
};

export type SecretsAccess = {
  userId: string;
  owner: string;
  repo: string;
  installationId: number;
  repositoryId: number;
  requestId: string;
  sessionId: string;
  readiness: SecretsManagerReadinessVerdict;
};

export type SecretAuditAction =
  | "secret.created"
  | "secret.updated"
  | "secret.deleted";

function jsonError(errorKind: GithubSecretsErrorKind, status?: number) {
  return Response.json(
    {
      ok: false,
      errorKind,
      error: errorKind,
    },
    { status: status ?? statusForSecretsErrorKind(errorKind) },
  );
}

function repoAccessErrorKind(reason: string): GithubSecretsErrorKind {
  if (reason === "no_installation" || reason === "app_no_access") {
    return "no_installation";
  }
  return "github_error";
}

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `req_${Date.now()}`;
}

export function validateSecretName(
  name: string,
):
  | { ok: true; name: string }
  | { ok: false; errorKind: GithubSecretsErrorKind } {
  const trimmed = name.trim();
  if (!SECRET_NAME_PATTERN.test(trimmed)) {
    return { ok: false, errorKind: "secret_name_invalid" };
  }
  return { ok: true, name: trimmed };
}

export function validateSecretValue(
  value: unknown,
):
  | { ok: true; value: string }
  | { ok: false; errorKind: GithubSecretsErrorKind } {
  if (typeof value !== "string" || value.length === 0) {
    return { ok: false, errorKind: "secret_too_large" };
  }
  const size = new TextEncoder().encode(value).byteLength;
  if (size > MAX_SECRET_BYTES) {
    return { ok: false, errorKind: "secret_too_large" };
  }
  return { ok: true, value };
}

export async function requireSecretsAccess(
  context: SecretsRouteContext,
  permission: "read" | "write",
): Promise<
  { ok: true; access: SecretsAccess } | { ok: false; response: Response }
> {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return { ok: false, response: authResult.response };
  }

  const { owner, repo } = await context.params;
  const repoAccess = await verifyRepoAccess({
    userId: authResult.userId,
    owner,
    repo,
    requiredUserPermission: permission === "write" ? "write" : "read",
  });

  if (!repoAccess.ok) {
    const errorKind = repoAccessErrorKind(repoAccess.reason);
    return { ok: false, response: jsonError(errorKind) };
  }

  const readiness = await getSecretsManagerReadinessCheck({
    installationId: repoAccess.installationId,
    repositoryId: repoAccess.repositoryId,
  });

  if (permission === "read" && !readiness.canRead) {
    return {
      ok: false,
      response: jsonError(
        readiness.errorKind ?? "app_no_secrets_permission",
        readiness.status === "error" ? 502 : 403,
      ),
    };
  }

  if (permission === "write" && !readiness.canRead) {
    return {
      ok: false,
      response: jsonError(
        readiness.errorKind ?? "app_no_secrets_permission",
        readiness.status === "error" ? 502 : 403,
      ),
    };
  }

  return {
    ok: true,
    access: {
      userId: authResult.userId,
      owner,
      repo,
      installationId: repoAccess.installationId,
      repositoryId: repoAccess.repositoryId,
      requestId: createRequestId(),
      sessionId: `github-secrets:${owner}/${repo}`,
      readiness,
    },
  };
}

export async function withSecretsOctokit<T>(
  access: SecretsAccess,
  permission: "read" | "write",
  operation: (octokit: Octokit) => Promise<T>,
): Promise<T> {
  return withScopedInstallationOctokit({
    installationId: access.installationId,
    repositoryId: access.repositoryId,
    permissions: { metadata: "read", secrets: permission },
    operation,
  });
}

export async function auditSecretMutation(params: {
  access: SecretsAccess;
  action: SecretAuditAction;
  secretName?: string;
  status: "succeeded" | "failed";
  errorKind?: GithubSecretsErrorKind;
}) {
  const { access, action, secretName, status, errorKind } = params;
  const payload = {
    service: "github-secrets-manager",
    action,
    scope: "repository" as const,
    repoOwner: access.owner,
    repoName: access.repo,
    installationId: access.installationId,
    userId: access.userId,
    requestId: access.requestId,
    sessionId: access.sessionId,
    ...(secretName ? { secretName } : {}),
    ...(errorKind ? { errorKind } : {}),
    redactionStatus: "passed" as const,
  };

  await emitSessionEvent({
    sessionId: access.sessionId,
    userId: access.userId,
    source: "github",
    actorType: "github",
    eventName: action,
    status,
    summary:
      status === "succeeded"
        ? `Repository secret ${action.replace("secret.", "")}`
        : `Repository secret ${action.replace("secret.", "")} failed`,
    requestId: access.requestId,
    payload,
    redactionStatus: "passed",
  });
}

export function handleSecretsRouteError(error: unknown): Response {
  const errorKind = classifySecretsError(error);
  return jsonError(errorKind);
}

export function secretsJsonError(
  errorKind: GithubSecretsErrorKind,
  status?: number,
) {
  return jsonError(errorKind, status);
}
