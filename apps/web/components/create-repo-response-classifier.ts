// Stub — implementation pending
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

export function classifyCreateRepoResponse(
  _httpStatus: number,
  _body: unknown,
): CreateRepoResponseClassification {
  // TODO: implement
  throw new Error("classifyCreateRepoResponse not yet implemented");
}
