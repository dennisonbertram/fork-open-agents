import { z } from "zod";
import type { BackgroundAgent, BackgroundAgentRun } from "@/lib/db/schema";
import { sha256CanonicalJson } from "@/lib/execution-snapshots/canonical-json";
import { LEARNINGS_AGENT_MARKER } from "@/lib/learnings/builtin-marker";

const githubPermissionsSchema = z
  .object({
    contents: z.enum(["read", "write"]).optional(),
    pullRequests: z.enum(["read", "write"]).optional(),
    issues: z.enum(["read", "write"]).optional(),
    deployments: z.literal("read").optional(),
    statuses: z.literal("read").optional(),
    checks: z.literal("read").optional(),
  })
  .strict();

const permissionsSchema = z
  .object({ github: githubPermissionsSchema.optional() })
  .strict();

const githubActionsSchema = z
  .object({
    open_pull_request: z.boolean(),
    comment_on_pr_or_issue: z.boolean(),
    approve_pull_request: z.boolean(),
    request_changes: z.boolean(),
    merge_pull_request: z.boolean(),
    push: z.boolean(),
    delete_branch: z.boolean(),
  })
  .strict();

const repoSchema = z
  .object({ owner: z.string().min(1), name: z.string().min(1) })
  .strict();
const writeScopeSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("this_repo") }).strict(),
  z.object({ mode: z.literal("all_repos") }).strict(),
  z
    .object({ mode: z.literal("specific_repos"), repos: z.array(repoSchema) })
    .strict(),
]);

export const backgroundAgentExecutionSnapshotV1Schema = z
  .object({
    snapshotVersion: z.literal(1),
    source: z
      .object({
        definitionId: z.string().min(1),
        name: z.string().min(1),
        updatedAt: z.string().datetime(),
        builtinKind: z.literal("pr_review_learnings").nullable(),
      })
      .strict(),
    repository: repoSchema,
    instructions: z.string(),
    permissions: permissionsSchema,
    checkCommand: z.string().nullable(),
    composioToolkitSlugs: z.array(z.string().min(1)),
    builtinToolNames: z.array(z.string().min(1)).nullable(),
    githubActions: githubActionsSchema,
    writeScope: writeScopeSchema,
    requireCiGreenForMerge: z.boolean(),
    modelId: z.string().nullable(),
  })
  .strict();

export type BackgroundAgentExecutionSnapshotV1 = z.infer<
  typeof backgroundAgentExecutionSnapshotV1Schema
>;

function normalizedText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizedSet(values: string[]): string[] {
  return [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ].sort();
}

function normalizeWriteScope(
  scope: BackgroundAgent["writeScope"],
): BackgroundAgentExecutionSnapshotV1["writeScope"] {
  if (scope.mode !== "specific_repos") return { mode: scope.mode };
  const repos = [
    ...new Map(
      (scope.repos ?? []).map((repo) => {
        const normalized = {
          owner: repo.owner.trim().toLowerCase(),
          name: repo.name.trim().toLowerCase(),
        };
        return [`${normalized.owner}/${normalized.name}`, normalized] as const;
      }),
    ).values(),
  ].sort((a, b) =>
    `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`),
  );
  return { mode: "specific_repos", repos };
}

export function buildBackgroundAgentExecutionSnapshot(
  agent: BackgroundAgent,
): BackgroundAgentExecutionSnapshotV1 {
  return backgroundAgentExecutionSnapshotV1Schema.parse({
    snapshotVersion: 1,
    source: {
      definitionId: agent.id,
      name: agent.name,
      updatedAt: agent.updatedAt.toISOString(),
      builtinKind: agent.instructions.includes(LEARNINGS_AGENT_MARKER)
        ? "pr_review_learnings"
        : null,
    },
    repository: { owner: agent.repoOwner, name: agent.repoName },
    instructions: agent.instructions,
    permissions: agent.permissions ?? {},
    checkCommand: normalizedText(agent.checkCommand),
    composioToolkitSlugs: normalizedSet(agent.composioToolkitSlugs ?? []),
    builtinToolNames:
      agent.builtinToolNames === null
        ? null
        : normalizedSet(agent.builtinToolNames ?? []),
    githubActions: {
      open_pull_request: agent.githubActions?.open_pull_request ?? false,
      comment_on_pr_or_issue:
        agent.githubActions?.comment_on_pr_or_issue ?? false,
      approve_pull_request: agent.githubActions?.approve_pull_request ?? false,
      request_changes: agent.githubActions?.request_changes ?? false,
      merge_pull_request: agent.githubActions?.merge_pull_request ?? false,
      push: agent.githubActions?.push ?? false,
      delete_branch: agent.githubActions?.delete_branch ?? false,
    },
    writeScope: normalizeWriteScope(agent.writeScope),
    requireCiGreenForMerge: agent.requireCiGreenForMerge ?? true,
    modelId: normalizedText(agent.modelId),
  });
}

export function parseBackgroundAgentExecutionSnapshot(
  value: unknown,
): BackgroundAgentExecutionSnapshotV1 {
  return backgroundAgentExecutionSnapshotV1Schema.parse(value);
}

export function hashBackgroundAgentExecutionSnapshot(
  snapshot: BackgroundAgentExecutionSnapshotV1,
): string {
  return sha256CanonicalJson(
    backgroundAgentExecutionSnapshotV1Schema.parse(snapshot),
  );
}

export type BackgroundAgentSnapshotErrorKind =
  | "snapshot_missing"
  | "snapshot_invalid"
  | "snapshot_version_unsupported"
  | "snapshot_hash_mismatch"
  | "agent_disabled"
  | "agent_deleted"
  | "permission_missing"
  | "installation_missing";

export class BackgroundAgentSnapshotError extends Error {
  constructor(
    readonly errorKind: BackgroundAgentSnapshotErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "BackgroundAgentSnapshotError";
  }
}

export type ResolvedBackgroundAgentExecutionDefinition = {
  definition: BackgroundAgentExecutionSnapshotV1;
  snapshotSource: "frozen" | "legacy_live_fallback";
  definitionVersion: number | null;
  definitionHash: string | null;
};

export function resolveBackgroundAgentExecutionDefinition(
  run: BackgroundAgentRun,
  liveAgent: BackgroundAgent | null,
): ResolvedBackgroundAgentExecutionDefinition {
  const tuple = [
    run.executionSnapshot,
    run.definitionVersion,
    run.definitionHash,
  ];
  const present = tuple.filter((value) => value != null).length;
  if (present !== 0 && present !== 3) {
    throw new BackgroundAgentSnapshotError(
      "snapshot_invalid",
      "Execution snapshot metadata is incomplete.",
    );
  }

  if (present === 0) {
    if (!liveAgent) {
      throw new BackgroundAgentSnapshotError(
        "agent_deleted",
        "Background agent configuration was deleted before execution.",
      );
    }
    if (liveAgent.status !== "enabled") {
      throw new BackgroundAgentSnapshotError(
        "agent_disabled",
        "Background agent configuration is disabled.",
      );
    }
    return {
      definition: buildBackgroundAgentExecutionSnapshot(liveAgent),
      snapshotSource: "legacy_live_fallback",
      definitionVersion: null,
      definitionHash: null,
    };
  }

  if (run.definitionVersion !== 1) {
    throw new BackgroundAgentSnapshotError(
      "snapshot_version_unsupported",
      `Execution snapshot version ${String(run.definitionVersion)} is unsupported.`,
    );
  }
  let definition: BackgroundAgentExecutionSnapshotV1;
  try {
    definition = parseBackgroundAgentExecutionSnapshot(run.executionSnapshot);
  } catch {
    throw new BackgroundAgentSnapshotError(
      "snapshot_invalid",
      "Execution snapshot failed validation.",
    );
  }
  if (definition.snapshotVersion !== run.definitionVersion) {
    throw new BackgroundAgentSnapshotError(
      "snapshot_version_unsupported",
      "Execution snapshot version metadata does not match its body.",
    );
  }
  if (hashBackgroundAgentExecutionSnapshot(definition) !== run.definitionHash) {
    throw new BackgroundAgentSnapshotError(
      "snapshot_hash_mismatch",
      "Execution snapshot hash verification failed.",
    );
  }
  if (
    definition.repository.owner.toLowerCase() !== run.repoOwner.toLowerCase() ||
    definition.repository.name.toLowerCase() !== run.repoName.toLowerCase()
  ) {
    throw new BackgroundAgentSnapshotError(
      "snapshot_invalid",
      "Execution snapshot repository does not match the accepted Run.",
    );
  }
  if (!liveAgent) {
    throw new BackgroundAgentSnapshotError(
      "agent_deleted",
      "Background agent configuration was deleted before execution.",
    );
  }
  if (liveAgent.status !== "enabled") {
    throw new BackgroundAgentSnapshotError(
      "agent_disabled",
      "Background agent configuration is disabled.",
    );
  }
  if (
    liveAgent.id !== definition.source.definitionId ||
    liveAgent.userId !== run.userId
  ) {
    throw new BackgroundAgentSnapshotError(
      "snapshot_invalid",
      "Execution snapshot source identity does not match the live source.",
    );
  }
  return {
    definition,
    snapshotSource: "frozen",
    definitionVersion: 1,
    definitionHash: run.definitionHash,
  };
}
