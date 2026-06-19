import { z } from "zod";

/**
 * Request/query schemas for the HTTP git/GitHub routes under
 * `app/api/sessions/[sessionId]/git/*`. These mirror the params of the
 * existing server actions/queries (lib/git/**, lib/github/**) so the same
 * backend logic is reachable — and black-box testable — over HTTP.
 *
 * Deep validation (e.g. branch-name safety) stays in the actions; these
 * schemas enforce request shape and presence.
 */

const nonEmpty = z.string().trim().min(1);

export const createBranchRequestSchema = z.object({
  sessionTitle: z.string(),
  baseBranch: nonEmpty,
  branchName: nonEmpty,
});

export const discardChangesRequestSchema = z
  .object({
    filePath: z.string().optional(),
    oldPath: z.string().optional(),
  })
  .refine((data) => data.oldPath === undefined || data.filePath !== undefined, {
    message: "filePath is required when oldPath is provided",
    path: ["filePath"],
  });

export const commitChangesRequestSchema = z.object({
  sessionTitle: z.string(),
  baseBranch: nonEmpty,
  branchName: nonEmpty,
  commitTitle: z.string().optional(),
  commitBody: z.string().optional(),
});

export const generatePrContentRequestSchema = z.object({
  sessionTitle: z.string(),
  baseBranch: nonEmpty,
  branchName: nonEmpty,
});

export const openPullRequestRequestSchema = z.object({
  repoUrl: nonEmpty,
  branchName: nonEmpty.optional(),
  title: nonEmpty,
  body: z.string().optional(),
  baseBranch: nonEmpty,
  headOwner: nonEmpty.optional(),
  isDraft: z.boolean().optional(),
  shouldAutoMerge: z.boolean().optional(),
});

export const mergePrRequestSchema = z.object({
  mergeMethod: z.enum(["merge", "squash", "rebase"]).optional(),
  commitTitle: z.string().optional(),
  commitMessage: z.string().optional(),
  deleteBranch: z.boolean().optional(),
  expectedHeadSha: z.string().optional(),
  force: z.boolean().optional(),
});

export const deploymentUrlQuerySchema = z.object({
  prNumber: z.coerce.number().int().positive().optional(),
  branch: nonEmpty.optional(),
});

export type CreateBranchRequest = z.infer<typeof createBranchRequestSchema>;
export type DiscardChangesRequest = z.infer<typeof discardChangesRequestSchema>;
export type CommitChangesRequest = z.infer<typeof commitChangesRequestSchema>;
export type GeneratePrContentRequest = z.infer<
  typeof generatePrContentRequestSchema
>;
export type OpenPullRequestRequest = z.infer<
  typeof openPullRequestRequestSchema
>;
export type MergePrRequest = z.infer<typeof mergePrRequestSchema>;
export type DeploymentUrlQuery = z.infer<typeof deploymentUrlQuerySchema>;
