/**
 * Classifies the HTTP response from the create-repo API into a typed discriminated union.
 *
 * This exists as a pure function so the classification logic is testable
 * independently of the React component and fetch() machinery.
 *
 * Server response shapes (as of route.ts):
 *   200 success:      { repoUrl, owner, repoName, cloneUrl, branch, appAccess: "verified" }
 *   207 pushFailed:   { status: "pushFailed", repoUrl, owner, repoName, error }
 *   403 fail-closed:  { status: "pushFailed", error, repoUrl, owner, repoName }
 *   4xx/5xx errors:   { error: string }
 */

export type CreateRepoResponseClassification =
  | {
      kind: "success";
      repoUrl: string;
      owner: string;
      repoName: string;
      cloneUrl: string;
      branch: string;
      appAccess?: "verified" | "needs_update";
    }
  | {
      kind: "pushFailed";
      repoUrl: string;
      owner: string;
      repoName: string;
      error: string;
    }
  | {
      kind: "httpError";
      error: string;
    };

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export function classifyCreateRepoResponse(
  httpStatus: number,
  body: unknown,
): CreateRepoResponseClassification {
  const rec = asRecord(body);
  const errorMessage = asString(rec?.error) ?? "Failed to create repository";

  // 207: push failed after repo was created — server explicitly signals this
  if (httpStatus === 207) {
    const repoUrl = asString(rec?.repoUrl);
    const owner = asString(rec?.owner);
    const repoName = asString(rec?.repoName);
    if (repoUrl && owner && repoName) {
      return {
        kind: "pushFailed",
        repoUrl,
        owner,
        repoName,
        error: errorMessage,
      };
    }
    return { kind: "httpError", error: errorMessage };
  }

  // 403 fail-closed: GitHub App unavailable after repo was already created.
  // The server returns status:"pushFailed" + repo identity in the body.
  if (httpStatus === 403 && asString(rec?.status) === "pushFailed") {
    const repoUrl = asString(rec?.repoUrl);
    const owner = asString(rec?.owner);
    const repoName = asString(rec?.repoName);
    if (repoUrl && owner && repoName) {
      return {
        kind: "pushFailed",
        repoUrl,
        owner,
        repoName,
        error: errorMessage,
      };
    }
    return { kind: "httpError", error: errorMessage };
  }

  // 200 success: only valid when cloneUrl AND branch are present strings.
  // Guard against the 207 body accidentally matching via res.ok === true.
  if (httpStatus === 200) {
    const repoUrl = asString(rec?.repoUrl);
    const owner = asString(rec?.owner);
    const repoName = asString(rec?.repoName);
    const cloneUrl = asString(rec?.cloneUrl);
    const branch = asString(rec?.branch);
    const appAccess = asString(rec?.appAccess) as
      | "verified"
      | "needs_update"
      | undefined;

    if (repoUrl && owner && repoName && cloneUrl && branch) {
      return {
        kind: "success",
        repoUrl,
        owner,
        repoName,
        cloneUrl,
        branch,
        appAccess,
      };
    }

    // 200 but incomplete body — treat as an error to avoid undefined cloneUrl/branch
    return { kind: "httpError", error: "Server returned an incomplete response" };
  }

  // Everything else (4xx, 5xx, or unrecognised 2xx) is an HTTP error
  return { kind: "httpError", error: errorMessage };
}
