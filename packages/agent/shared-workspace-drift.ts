import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);

const workspaceDriftReasonCodeSchema = z.enum([
  "baseline_captured",
  "git_unavailable",
  "no_drift",
  "protected_workspace_drift",
  "out_of_scope_drift",
  "unsupported_baseline",
]);

export const sharedWorkspaceDriftEventSchema = z.object({
  type: z.enum(["workspace_baseline_captured", "workspace_drift_checked"]),
  workerId: z.string(),
  workspaceId: z.string(),
  baselineKind: z.enum(["git_status"]),
  fileCount: z.number().int().nonnegative(),
  reasonCode: workspaceDriftReasonCodeSchema,
});

export type SharedWorkspaceDriftEvent = z.infer<
  typeof sharedWorkspaceDriftEventSchema
>;

const protectedPathsSchema = z.array(z.string()).optional();

export const sharedWorkspaceBaselineSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("captured"),
    workerId: z.string(),
    workspaceId: z.string(),
    workspacePath: z.string(),
    baselineKind: z.literal("git_status"),
    headSha: z.string(),
    changedPaths: z.array(z.string()),
    protectedPaths: protectedPathsSchema,
    events: z.array(sharedWorkspaceDriftEventSchema),
  }),
  z.object({
    status: z.literal("unsupported"),
    workerId: z.string(),
    workspaceId: z.string(),
    workspacePath: z.string(),
    baselineKind: z.literal("git_status"),
    reasonCode: z.literal("git_unavailable"),
    reason: z.string(),
    protectedPaths: protectedPathsSchema,
    events: z.array(sharedWorkspaceDriftEventSchema),
  }),
]);

export type SharedWorkspaceBaseline = z.infer<
  typeof sharedWorkspaceBaselineSchema
>;

export const sharedWorkspaceDriftCheckSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("clean"),
    workerId: z.string(),
    workspaceId: z.string(),
    baselineKind: z.literal("git_status"),
    reasonCode: z.literal("no_drift"),
    reason: z.string(),
    changedPaths: z.array(z.string()),
    protectedPaths: protectedPathsSchema,
    events: z.array(sharedWorkspaceDriftEventSchema),
  }),
  z.object({
    status: z.literal("blocked"),
    workerId: z.string(),
    workspaceId: z.string(),
    baselineKind: z.literal("git_status"),
    reasonCode: z.literal("protected_workspace_drift"),
    reason: z.string(),
    changedPaths: z.array(z.string()),
    protectedPaths: protectedPathsSchema,
    events: z.array(sharedWorkspaceDriftEventSchema),
  }),
  z.object({
    status: z.literal("ignored"),
    workerId: z.string(),
    workspaceId: z.string(),
    baselineKind: z.literal("git_status"),
    reasonCode: z.literal("out_of_scope_drift"),
    reason: z.string(),
    changedPaths: z.array(z.string()),
    protectedPaths: protectedPathsSchema,
    events: z.array(sharedWorkspaceDriftEventSchema),
  }),
  z.object({
    status: z.literal("unsupported"),
    workerId: z.string(),
    workspaceId: z.string(),
    baselineKind: z.literal("git_status"),
    reasonCode: z.literal("unsupported_baseline"),
    reason: z.string(),
    changedPaths: z.array(z.string()),
    protectedPaths: protectedPathsSchema,
    events: z.array(sharedWorkspaceDriftEventSchema),
  }),
]);

export type SharedWorkspaceDriftCheck = z.infer<
  typeof sharedWorkspaceDriftCheckSchema
>;

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function normalizeProtectedPaths(paths: string[] | undefined) {
  return paths?.map(normalizePath).sort();
}

function isProtectedPath(filePath: string, protectedPaths: string[]): boolean {
  const normalizedPath = normalizePath(filePath);
  return protectedPaths.some((protectedPath) => {
    const normalizedProtectedPath = normalizePath(protectedPath);
    return (
      normalizedPath === normalizedProtectedPath ||
      normalizedPath.startsWith(`${normalizedProtectedPath}/`)
    );
  });
}

function parseStatusPaths(output: string): string[] {
  if (!output) {
    return [];
  }

  const paths = new Set<string>();
  for (const record of output.split("\0")) {
    if (!record) {
      continue;
    }

    const status = record.slice(0, 2);
    const rawPath = record.slice(2).trimStart();
    if (!rawPath) {
      continue;
    }

    if (status.includes("R") || status.includes("C")) {
      const [_oldPath, newPath] = rawPath.split("\0");
      paths.add(normalizePath(newPath ?? rawPath));
      continue;
    }

    paths.add(normalizePath(rawPath));
  }

  return [...paths].sort();
}

async function readGitSnapshot(workspacePath: string) {
  await git(["rev-parse", "--is-inside-work-tree"], workspacePath);
  const root = await git(["rev-parse", "--show-toplevel"], workspacePath);
  const headSha = await git(["rev-parse", "HEAD"], workspacePath);
  const status = await git(["status", "--porcelain=v1", "-z"], root);

  return {
    root: path.resolve(root),
    headSha,
    changedPaths: parseStatusPaths(status),
  };
}

export async function captureSharedWorkspaceBaseline(params: {
  workerId: string;
  workspaceId: string;
  workspacePath: string;
  protectedPaths?: string[];
}): Promise<SharedWorkspaceBaseline> {
  const protectedPaths = normalizeProtectedPaths(params.protectedPaths);

  try {
    const snapshot = await readGitSnapshot(params.workspacePath);
    const event: SharedWorkspaceDriftEvent = {
      type: "workspace_baseline_captured",
      workerId: params.workerId,
      workspaceId: params.workspaceId,
      baselineKind: "git_status",
      fileCount: snapshot.changedPaths.length,
      reasonCode: "baseline_captured",
    };

    return {
      status: "captured",
      workerId: params.workerId,
      workspaceId: params.workspaceId,
      workspacePath: snapshot.root,
      baselineKind: "git_status",
      headSha: snapshot.headSha,
      changedPaths: snapshot.changedPaths,
      protectedPaths,
      events: [event],
    };
  } catch {
    const event: SharedWorkspaceDriftEvent = {
      type: "workspace_baseline_captured",
      workerId: params.workerId,
      workspaceId: params.workspaceId,
      baselineKind: "git_status",
      fileCount: 0,
      reasonCode: "git_unavailable",
    };

    return {
      status: "unsupported",
      workerId: params.workerId,
      workspaceId: params.workspaceId,
      workspacePath: path.resolve(params.workspacePath),
      baselineKind: "git_status",
      reasonCode: "git_unavailable",
      reason:
        "Git metadata is unavailable, so shared workspace drift cannot be checked.",
      protectedPaths,
      events: [event],
    };
  }
}

export async function checkSharedWorkspaceDrift(params: {
  baseline: SharedWorkspaceBaseline;
  workspacePath: string;
}): Promise<SharedWorkspaceDriftCheck> {
  if (params.baseline.status === "unsupported") {
    const event: SharedWorkspaceDriftEvent = {
      type: "workspace_drift_checked",
      workerId: params.baseline.workerId,
      workspaceId: params.baseline.workspaceId,
      baselineKind: "git_status",
      fileCount: 0,
      reasonCode: "unsupported_baseline",
    };

    return {
      status: "unsupported",
      workerId: params.baseline.workerId,
      workspaceId: params.baseline.workspaceId,
      baselineKind: "git_status",
      reasonCode: "unsupported_baseline",
      reason:
        "Shared workspace drift check failed closed because no supported baseline was captured.",
      changedPaths: [],
      protectedPaths: params.baseline.protectedPaths,
      events: [event],
    };
  }

  const snapshot = await readGitSnapshot(params.workspacePath);
  const baselinePaths = new Set(params.baseline.changedPaths);
  const changedPaths = snapshot.changedPaths.filter(
    (filePath) => !baselinePaths.has(filePath),
  );
  const protectedPaths = params.baseline.protectedPaths;
  const blockingPaths = protectedPaths
    ? changedPaths.filter((filePath) =>
        isProtectedPath(filePath, protectedPaths),
      )
    : changedPaths;

  if (blockingPaths.length > 0) {
    const event: SharedWorkspaceDriftEvent = {
      type: "workspace_drift_checked",
      workerId: params.baseline.workerId,
      workspaceId: params.baseline.workspaceId,
      baselineKind: "git_status",
      fileCount: blockingPaths.length,
      reasonCode: "protected_workspace_drift",
    };

    return {
      status: "blocked",
      workerId: params.baseline.workerId,
      workspaceId: params.baseline.workspaceId,
      baselineKind: "git_status",
      reasonCode: "protected_workspace_drift",
      reason:
        "Shared workspace changed in the worker scope; worker output was stopped before unsafe completion.",
      changedPaths: blockingPaths,
      protectedPaths,
      events: [event],
    };
  }

  if (changedPaths.length > 0) {
    const event: SharedWorkspaceDriftEvent = {
      type: "workspace_drift_checked",
      workerId: params.baseline.workerId,
      workspaceId: params.baseline.workspaceId,
      baselineKind: "git_status",
      fileCount: changedPaths.length,
      reasonCode: "out_of_scope_drift",
    };

    return {
      status: "ignored",
      workerId: params.baseline.workerId,
      workspaceId: params.baseline.workspaceId,
      baselineKind: "git_status",
      reasonCode: "out_of_scope_drift",
      reason:
        "Shared workspace changed outside the protected worker scope; drift was recorded and ignored.",
      changedPaths,
      protectedPaths,
      events: [event],
    };
  }

  const event: SharedWorkspaceDriftEvent = {
    type: "workspace_drift_checked",
    workerId: params.baseline.workerId,
    workspaceId: params.baseline.workspaceId,
    baselineKind: "git_status",
    fileCount: 0,
    reasonCode: "no_drift",
  };

  return {
    status: "clean",
    workerId: params.baseline.workerId,
    workspaceId: params.baseline.workspaceId,
    baselineKind: "git_status",
    reasonCode: "no_drift",
    reason: "Shared workspace still matches the captured baseline.",
    changedPaths: [],
    protectedPaths,
    events: [event],
  };
}
