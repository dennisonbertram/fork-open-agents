import {
  listRepoSecrets,
  putRepoSecret,
} from "@/lib/github/secrets-manager/repo-secrets";
import {
  auditSecretMutation,
  handleSecretsRouteError,
  requireSecretsAccess,
  secretsJsonError,
  validateSecretName,
  validateSecretValue,
  withSecretsOctokit,
  type SecretsRouteContext,
} from "./_lib";

type CreateSecretBody = {
  name?: unknown;
  value?: unknown;
};

async function readCreateSecretBody(
  request: Request,
): Promise<CreateSecretBody> {
  const body = (await request.json().catch(() => ({}))) as unknown;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {};
  }
  return body as CreateSecretBody;
}

export async function GET(_request: Request, context: SecretsRouteContext) {
  const accessResult = await requireSecretsAccess(context, "read");
  if (!accessResult.ok) {
    return accessResult.response;
  }
  const { access } = accessResult;

  try {
    const secrets = await withSecretsOctokit(access, "read", (octokit) =>
      listRepoSecrets(octokit, access.owner, access.repo),
    );

    return Response.json({
      ok: true,
      readiness: access.readiness,
      secrets,
    });
  } catch (error) {
    return handleSecretsRouteError(error);
  }
}

export async function POST(request: Request, context: SecretsRouteContext) {
  const accessResult = await requireSecretsAccess(context, "write");
  if (!accessResult.ok) {
    return accessResult.response;
  }
  const { access } = accessResult;
  if (!access.readiness.canWrite) {
    await auditSecretMutation({
      access,
      action: "secret.created",
      status: "failed",
      errorKind: access.readiness.errorKind ?? "app_no_secrets_permission",
    });
    return secretsJsonError(
      access.readiness.errorKind ?? "app_no_secrets_permission",
    );
  }
  const body = await readCreateSecretBody(request);
  const nameValidation = validateSecretName(
    typeof body.name === "string" ? body.name : "",
  );
  const auditSecretName = nameValidation.ok ? nameValidation.name : undefined;

  if (!nameValidation.ok) {
    await auditSecretMutation({
      access,
      action: "secret.created",
      status: "failed",
      errorKind: nameValidation.errorKind,
    });
    return secretsJsonError(nameValidation.errorKind);
  }
  const secretName = nameValidation.name;

  const valueValidation = validateSecretValue(body.value);
  if (!valueValidation.ok) {
    await auditSecretMutation({
      access,
      action: "secret.created",
      secretName: auditSecretName,
      status: "failed",
      errorKind: valueValidation.errorKind,
    });
    return secretsJsonError(valueValidation.errorKind);
  }

  try {
    const result = await withSecretsOctokit(access, "write", (octokit) =>
      putRepoSecret(
        octokit,
        access.owner,
        access.repo,
        secretName,
        valueValidation.value,
      ),
    );
    const action = result.status === 201 ? "secret.created" : "secret.updated";
    await auditSecretMutation({
      access,
      action,
      secretName,
      status: "succeeded",
    });

    return Response.json({ ok: true, name: secretName });
  } catch (error) {
    const response = handleSecretsRouteError(error);
    const body = (await response.clone().json()) as { errorKind?: string };
    await auditSecretMutation({
      access,
      action: "secret.created",
      secretName,
      status: "failed",
      errorKind:
        body.errorKind === "github_rate_limited" ||
        body.errorKind === "app_no_secrets_permission" ||
        body.errorKind === "github_error"
          ? body.errorKind
          : "github_error",
    });
    return response;
  }
}
