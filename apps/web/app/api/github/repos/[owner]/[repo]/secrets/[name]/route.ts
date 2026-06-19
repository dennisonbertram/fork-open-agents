import {
  deleteRepoSecret,
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
  type SecretItemRouteContext,
  type SecretsRouteContext,
} from "../_lib";

type UpdateSecretBody = {
  value?: unknown;
};

async function readUpdateSecretBody(
  request: Request,
): Promise<UpdateSecretBody> {
  const body = (await request.json().catch(() => ({}))) as unknown;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {};
  }
  return body as UpdateSecretBody;
}

async function paramsForAccess(context: SecretItemRouteContext): Promise<{
  accessContext: SecretsRouteContext;
  name: string;
}> {
  const params = await context.params;
  return {
    accessContext: {
      params: Promise.resolve({ owner: params.owner, repo: params.repo }),
    },
    name: params.name,
  };
}

export async function PUT(request: Request, context: SecretItemRouteContext) {
  const { accessContext, name } = await paramsForAccess(context);
  const accessResult = await requireSecretsAccess(accessContext, "write");
  if (!accessResult.ok) {
    return accessResult.response;
  }
  const { access } = accessResult;
  const nameValidation = validateSecretName(name);
  const auditSecretName = nameValidation.ok ? nameValidation.name : undefined;

  if (!access.readiness.canWrite) {
    await auditSecretMutation({
      access,
      action: "secret.updated",
      secretName: auditSecretName,
      status: "failed",
      errorKind: access.readiness.errorKind ?? "app_no_secrets_permission",
    });
    return secretsJsonError(
      access.readiness.errorKind ?? "app_no_secrets_permission",
    );
  }

  if (!nameValidation.ok) {
    await auditSecretMutation({
      access,
      action: "secret.updated",
      status: "failed",
      errorKind: nameValidation.errorKind,
    });
    return secretsJsonError(nameValidation.errorKind);
  }
  const secretName = nameValidation.name;

  const body = await readUpdateSecretBody(request);
  const valueValidation = validateSecretValue(body.value);
  if (!valueValidation.ok) {
    await auditSecretMutation({
      access,
      action: "secret.updated",
      secretName,
      status: "failed",
      errorKind: valueValidation.errorKind,
    });
    return secretsJsonError(valueValidation.errorKind);
  }

  try {
    await withSecretsOctokit(access, "write", (octokit) =>
      putRepoSecret(
        octokit,
        access.owner,
        access.repo,
        secretName,
        valueValidation.value,
      ),
    );
    await auditSecretMutation({
      access,
      action: "secret.updated",
      secretName,
      status: "succeeded",
    });

    return Response.json({ ok: true, name: secretName });
  } catch (error) {
    const response = handleSecretsRouteError(error);
    await auditSecretMutation({
      access,
      action: "secret.updated",
      secretName,
      status: "failed",
      errorKind: "github_error",
    });
    return response;
  }
}

export async function DELETE(
  _request: Request,
  context: SecretItemRouteContext,
) {
  const { accessContext, name } = await paramsForAccess(context);
  const accessResult = await requireSecretsAccess(accessContext, "write");
  if (!accessResult.ok) {
    return accessResult.response;
  }
  const { access } = accessResult;
  const nameValidation = validateSecretName(name);
  const auditSecretName = nameValidation.ok ? nameValidation.name : undefined;

  if (!access.readiness.canWrite) {
    await auditSecretMutation({
      access,
      action: "secret.deleted",
      secretName: auditSecretName,
      status: "failed",
      errorKind: access.readiness.errorKind ?? "app_no_secrets_permission",
    });
    return secretsJsonError(
      access.readiness.errorKind ?? "app_no_secrets_permission",
    );
  }

  if (!nameValidation.ok) {
    await auditSecretMutation({
      access,
      action: "secret.deleted",
      status: "failed",
      errorKind: nameValidation.errorKind,
    });
    return secretsJsonError(nameValidation.errorKind);
  }
  const secretName = nameValidation.name;

  try {
    await withSecretsOctokit(access, "write", (octokit) =>
      deleteRepoSecret(octokit, access.owner, access.repo, secretName),
    );
    await auditSecretMutation({
      access,
      action: "secret.deleted",
      secretName,
      status: "succeeded",
    });

    return Response.json({ ok: true });
  } catch (error) {
    const response = handleSecretsRouteError(error);
    await auditSecretMutation({
      access,
      action: "secret.deleted",
      secretName,
      status: "failed",
      errorKind: "github_error",
    });
    return response;
  }
}
