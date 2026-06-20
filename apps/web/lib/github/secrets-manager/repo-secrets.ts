import "server-only";

import type { Octokit } from "@octokit/rest";
import { sealSecretValue } from "./encrypt";
import { routeForScope } from "./scope-router";

export type RepoSecretSummary = {
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type PutRepoSecretResult = {
  status: 201 | 204;
};

type GitHubRepoSecret = {
  name?: string;
  created_at?: string;
  updated_at?: string;
};

type GitHubRepoSecretsResponse = {
  secrets?: GitHubRepoSecret[];
  total_count?: number;
};

type GitHubPublicKeyResponse = {
  key: string;
  key_id: string;
};

function isPublicKeyResponse(value: unknown): value is GitHubPublicKeyResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { key?: unknown }).key === "string" &&
    typeof (value as { key_id?: unknown }).key_id === "string"
  );
}

function assertNoSecretMaterialPayload(payload: Record<string, unknown>) {
  const forbiddenKeys = new Set([
    "value",
    "plaintext",
    "encrypted_value",
    "publicKey",
    "publicKeyBase64",
    "key",
    "key_id",
  ]);

  for (const key of Object.keys(payload)) {
    if (forbiddenKeys.has(key)) {
      throw new Error("secret_material_payload_blocked");
    }
  }
}

export async function listRepoSecrets(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<RepoSecretSummary[]> {
  const secrets: GitHubRepoSecret[] = [];
  let page = 1;
  let totalCount: number | undefined;

  do {
    const response = await octokit.request(
      "GET /repos/{owner}/{repo}/actions/secrets",
      {
        owner,
        repo,
        page,
        per_page: 100,
      },
    );
    const data = response.data as GitHubRepoSecretsResponse;
    const pageSecrets = data.secrets ?? [];
    secrets.push(...pageSecrets);
    totalCount = data.total_count;

    if (pageSecrets.length < 100) {
      break;
    }

    page += 1;
  } while (typeof totalCount !== "number" || secrets.length < totalCount);

  return secrets
    .filter((secret) => secret.name && secret.created_at && secret.updated_at)
    .map((secret) => ({
      name: secret.name ?? "",
      createdAt: secret.created_at ?? "",
      updatedAt: secret.updated_at ?? "",
    }));
}

export async function putRepoSecret(
  octokit: Octokit,
  owner: string,
  repo: string,
  name: string,
  plaintext: string,
): Promise<PutRepoSecretResult> {
  routeForScope("repository", { owner, repo, permissionLevel: "write" });

  const publicKeyResponse = await octokit.request(
    "GET /repos/{owner}/{repo}/actions/secrets/public-key",
    { owner, repo },
  );
  const publicKey = publicKeyResponse.data as unknown;
  if (!isPublicKeyResponse(publicKey)) {
    throw new Error("github_public_key_response_invalid");
  }

  const encryptedValue = await sealSecretValue({
    publicKeyBase64: publicKey.key,
    plaintext,
  });

  // Keep the toxic plaintext local to this function. It is never placed into
  // route responses, audit payloads, logs, or reusable objects.
  const githubPayload = {
    encrypted_value: encryptedValue,
    key_id: publicKey.key_id,
  };

  const response = await octokit.request(
    "PUT /repos/{owner}/{repo}/actions/secrets/{secret_name}",
    {
      owner,
      repo,
      secret_name: name,
      ...githubPayload,
    },
  );

  return { status: response.status === 201 ? 201 : 204 };
}

export async function deleteRepoSecret(
  octokit: Octokit,
  owner: string,
  repo: string,
  name: string,
): Promise<void> {
  assertNoSecretMaterialPayload({ owner, repo, name });

  await octokit.request(
    "DELETE /repos/{owner}/{repo}/actions/secrets/{secret_name}",
    {
      owner,
      repo,
      secret_name: name,
    },
  );
}
