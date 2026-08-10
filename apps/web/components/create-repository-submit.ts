import { readApiError } from "@/lib/api/read-api-error";

export interface CreatedRepository {
  owner: string;
  repoName: string;
  repoUrl?: string;
  cloneUrl?: string;
}

export type SubmitCreateRepositoryOutcome =
  | { ok: true; result: CreatedRepository }
  | { ok: false; error: string };

/**
 * Client-side submit for the new-session picker's create-repository dialog
 * (#1177). Posts to the session-free endpoint and maps the response to a
 * typed outcome the dialog can render.
 */
export async function submitCreateRepository({
  owner,
  repoName,
  description,
  isPrivate,
  fetchImpl = fetch,
}: {
  owner: string;
  repoName: string;
  description?: string;
  isPrivate: boolean;
  fetchImpl?: typeof fetch;
}): Promise<SubmitCreateRepositoryOutcome> {
  try {
    const response = await fetchImpl("/api/github/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repoName,
        description: description?.trim() ? description.trim() : undefined,
        isPrivate,
        owner,
      }),
    });

    const data = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    if (!response.ok) {
      return {
        ok: false,
        error: readApiError(data, "Failed to create repository").message,
      };
    }

    return {
      ok: true,
      result: {
        owner: String(data?.owner ?? owner),
        repoName: String(data?.repoName ?? repoName),
        repoUrl: typeof data?.repoUrl === "string" ? data.repoUrl : undefined,
        cloneUrl:
          typeof data?.cloneUrl === "string" ? data.cloneUrl : undefined,
      },
    };
  } catch {
    return { ok: false, error: "Failed to create repository" };
  }
}
