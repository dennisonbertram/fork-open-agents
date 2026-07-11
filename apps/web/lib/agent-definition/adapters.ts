import type { AgentStepNode } from "@/lib/agent-loops/types";
import type { ResolvedAgent } from "@/lib/agents/resolve-agent";
import {
  defaultGithubActions,
  defaultWriteScope,
  type BackgroundAgent,
  type BackgroundAgentTrigger,
  type GithubActions,
  type WriteScope,
} from "@/lib/background-agents/agent-spec";
import type { BackgroundAgentPermissions } from "@/lib/db/schema";
import {
  agentDefinitionPermissionsSchema,
  agentDefinitionV1Schema,
  makeSourceQualifiedDefinitionId,
  type AgentDefinitionPermissions,
  type AgentDefinitionV1,
} from "./schema";

export type AgentSourceFieldClassification =
  | "definition"
  | "automation_binding"
  | "publishing_policy"
  | "workspace_policy";

export const RESOLVED_AGENT_FIELD_CLASSIFICATION = {
  role: "automation_binding",
  fromDbRow: "automation_binding",
  agentId: "definition",
  modelId: "definition",
  inferenceProfileId: "definition",
  instructions: "definition",
  skillRefs: "definition",
  builtinToolNames: "definition",
  composioToolkitSlugs: "definition",
  composioProfileId: "automation_binding",
  managedRuntimeProfileId: "definition",
  toolAuthoringEnabled: "definition",
  githubToolsEnabled: "definition",
} as const satisfies Record<
  keyof ResolvedAgent,
  AgentSourceFieldClassification
>;

export type BackgroundAgentDefinitionSource = BackgroundAgent & {
  /** Present on persisted background-agent rows; absent from older client specs. */
  builtinToolNames?: string[] | null;
  /** Present on persisted rows; the client-safe spec inherits the DB default. */
  runBudgetPerTarget?: number;
};

export const BACKGROUND_AGENT_FIELD_CLASSIFICATION = {
  id: "definition",
  name: "definition",
  description: "definition",
  status: "automation_binding",
  repoOwner: "automation_binding",
  repoName: "automation_binding",
  instructions: "definition",
  checkCommand: "definition",
  triggers: "automation_binding",
  permissions: "definition",
  composioToolkitSlugs: "definition",
  builtinToolNames: "definition",
  githubActions: "publishing_policy",
  writeScope: "publishing_policy",
  requireCiGreenForMerge: "publishing_policy",
  runBudgetPerTarget: "automation_binding",
  modelId: "definition",
} as const satisfies Record<
  keyof BackgroundAgentDefinitionSource,
  AgentSourceFieldClassification
>;

type FrozenLoopStepClassifiedField =
  | "loopId"
  | "node.id"
  | "node.label"
  | "node.position"
  | "node.kind"
  | "node.instructions"
  | "node.outputSchema"
  | "node.checkCommand"
  | "node.permissions"
  | "node.composioToolkitSlugs"
  | "node.builtinToolNames"
  | "loopPermissions";

export const FROZEN_LOOP_STEP_FIELD_CLASSIFICATION = {
  loopId: "definition",
  "node.id": "definition",
  "node.label": "definition",
  "node.position": "automation_binding",
  "node.kind": "definition",
  "node.instructions": "definition",
  "node.outputSchema": "definition",
  "node.checkCommand": "definition",
  "node.permissions": "definition",
  "node.composioToolkitSlugs": "definition",
  "node.builtinToolNames": "definition",
  loopPermissions: "definition",
} as const satisfies Record<
  FrozenLoopStepClassifiedField,
  AgentSourceFieldClassification
>;

type NullPolicies = {
  publishingPolicy: null;
  workspacePolicy: null;
};

export type ResolvedAgentDefinitionAdaptation = {
  definition: AgentDefinitionV1;
  separation: NullPolicies & {
    automationBinding: {
      kind: "chat_role";
      role: ResolvedAgent["role"];
      resolutionOrigin: "agents_row" | "preference_fallback";
      credentialBindings: {
        composioProfileId: string | null;
      };
    };
  };
};

type SafeTriggerBinding = Pick<
  BackgroundAgentTrigger,
  | "id"
  | "name"
  | "kind"
  | "status"
  | "conditions"
  | "schedule"
  | "webhookPublicId"
>;

export type BackgroundAgentDefinitionAdaptation = {
  definition: AgentDefinitionV1;
  separation: {
    automationBinding: {
      kind: "background_agent";
      status: BackgroundAgent["status"];
      repository: { owner: string; name: string };
      triggers: SafeTriggerBinding[];
      runBudgetPerTarget: number;
    };
    publishingPolicy: {
      githubActions: GithubActions;
      writeScope: WriteScope;
      requireCiGreenForMerge: boolean;
    };
    workspacePolicy: null;
  };
};

export type FrozenLoopAgentStepDefinitionSource = {
  loopId: string;
  node: AgentStepNode;
  loopPermissions?: BackgroundAgentPermissions;
};

export type FrozenLoopAgentStepDefinitionAdaptation = {
  definition: AgentDefinitionV1;
  separation: NullPolicies & {
    automationBinding: {
      kind: "loop_step";
      loopId: string;
      nodeId: string;
      editorPosition: AgentStepNode["position"];
      permissionSource: "step" | "loop" | "none";
    };
  };
};

function builtinPolicy(names: string[] | null | undefined) {
  if (names == null) {
    return { mode: "source_default" as const, names: [] };
  }
  return { mode: "allowlist" as const, names: [...names] };
}

function parsePermissions(
  permissions: BackgroundAgentPermissions | undefined,
): AgentDefinitionPermissions {
  return agentDefinitionPermissionsSchema.parse(permissions ?? {});
}

function cloneTrigger(trigger: BackgroundAgentTrigger): SafeTriggerBinding {
  const conditions = trigger.conditions
    ? {
        ...(trigger.conditions.actions
          ? { actions: [...trigger.conditions.actions] }
          : {}),
        ...(trigger.conditions.branches
          ? { branches: [...trigger.conditions.branches] }
          : {}),
        ...(trigger.conditions.labels
          ? { labels: [...trigger.conditions.labels] }
          : {}),
        ...(trigger.conditions.environments
          ? { environments: [...trigger.conditions.environments] }
          : {}),
        ...(trigger.conditions.severities
          ? { severities: [...trigger.conditions.severities] }
          : {}),
        ...(trigger.conditions.actors
          ? { actors: [...trigger.conditions.actors] }
          : {}),
        ...(trigger.conditions.ignoreActors
          ? { ignoreActors: [...trigger.conditions.ignoreActors] }
          : {}),
      }
    : undefined;

  return {
    id: trigger.id,
    name: trigger.name,
    kind: trigger.kind,
    status: trigger.status,
    ...(conditions ? { conditions } : {}),
    schedule: trigger.schedule,
    webhookPublicId: trigger.webhookPublicId,
  };
}

function cloneGithubActions(actions: GithubActions): GithubActions {
  return {
    ...(actions.open_pull_request === undefined
      ? {}
      : { open_pull_request: actions.open_pull_request }),
    ...(actions.comment_on_pr_or_issue === undefined
      ? {}
      : { comment_on_pr_or_issue: actions.comment_on_pr_or_issue }),
    ...(actions.approve_pull_request === undefined
      ? {}
      : { approve_pull_request: actions.approve_pull_request }),
    ...(actions.request_changes === undefined
      ? {}
      : { request_changes: actions.request_changes }),
    ...(actions.merge_pull_request === undefined
      ? {}
      : { merge_pull_request: actions.merge_pull_request }),
    ...(actions.push === undefined ? {} : { push: actions.push }),
    ...(actions.delete_branch === undefined
      ? {}
      : { delete_branch: actions.delete_branch }),
  };
}

function cloneWriteScope(writeScope: WriteScope): WriteScope {
  return {
    mode: writeScope.mode,
    ...(writeScope.repos
      ? {
          repos: writeScope.repos.map((repo) => ({
            owner: repo.owner,
            name: repo.name,
          })),
        }
      : {}),
  };
}

function hasEnabledGithubAction(actions: GithubActions): boolean {
  return Object.values(actions).some((enabled) => enabled === true);
}

export function adaptResolvedAgentDefinition(
  source: ResolvedAgent,
): ResolvedAgentDefinitionAdaptation {
  const sourceIds = source.agentId
    ? [source.agentId]
    : ["fallback", source.role];

  const definition = agentDefinitionV1Schema.parse({
    version: 1,
    identity: {
      source: "resolved_agent",
      sourceIds,
      sourceQualifiedId: makeSourceQualifiedDefinitionId(
        "resolved_agent",
        ...sourceIds,
      ),
    },
    metadata: { name: source.role, description: null },
    instructions: {
      text: source.instructions,
      usesSourceDefault: source.instructions === null,
    },
    inference: {
      modelId: source.modelId,
      inferenceProfileId: source.inferenceProfileId,
    },
    skills: { refs: source.skillRefs.map((ref) => ({ ...ref })) },
    tools: {
      builtin: builtinPolicy(source.builtinToolNames),
      composio: { toolkitSlugs: [...source.composioToolkitSlugs] },
      nativeGithub: {
        mode: source.githubToolsEnabled ? "enabled" : "disabled",
      },
      authoring: { enabled: source.toolAuthoringEnabled },
    },
    permissions: {},
    runtime: {
      managedRuntimeProfileId: source.managedRuntimeProfileId,
    },
    verification: { checkCommand: null },
    output: { schema: null },
  });

  return {
    definition,
    separation: {
      automationBinding: {
        kind: "chat_role",
        role: source.role,
        resolutionOrigin: source.fromDbRow
          ? "agents_row"
          : "preference_fallback",
        credentialBindings: {
          composioProfileId: source.composioProfileId,
        },
      },
      publishingPolicy: null,
      workspacePolicy: null,
    },
  };
}

export function adaptBackgroundAgentDefinition(
  source: BackgroundAgentDefinitionSource,
): BackgroundAgentDefinitionAdaptation {
  const githubActions = cloneGithubActions(
    source.githubActions ?? defaultGithubActions,
  );
  const writeScope = cloneWriteScope(source.writeScope ?? defaultWriteScope);

  const definition = agentDefinitionV1Schema.parse({
    version: 1,
    identity: {
      source: "background_agent",
      sourceIds: [source.id],
      sourceQualifiedId: makeSourceQualifiedDefinitionId(
        "background_agent",
        source.id,
      ),
    },
    metadata: {
      name: source.name,
      description: source.description,
    },
    instructions: {
      text: source.instructions,
      usesSourceDefault: false,
    },
    inference: {
      modelId: source.modelId ?? null,
      inferenceProfileId: null,
    },
    skills: { refs: [] },
    tools: {
      builtin: builtinPolicy(source.builtinToolNames),
      composio: {
        toolkitSlugs: [...(source.composioToolkitSlugs ?? [])],
      },
      nativeGithub: {
        mode: hasEnabledGithubAction(githubActions) ? "enabled" : "disabled",
      },
      authoring: { enabled: false },
    },
    permissions: parsePermissions(source.permissions),
    runtime: { managedRuntimeProfileId: null },
    verification: { checkCommand: source.checkCommand },
    output: { schema: null },
  });

  return {
    definition,
    separation: {
      automationBinding: {
        kind: "background_agent",
        status: source.status,
        repository: { owner: source.repoOwner, name: source.repoName },
        triggers: source.triggers.map(cloneTrigger),
        runBudgetPerTarget: source.runBudgetPerTarget ?? 10,
      },
      publishingPolicy: {
        githubActions,
        writeScope,
        requireCiGreenForMerge: source.requireCiGreenForMerge ?? true,
      },
      workspacePolicy: null,
    },
  };
}

function effectiveLoopPermissions(
  source: FrozenLoopAgentStepDefinitionSource,
): {
  permissions: AgentDefinitionPermissions;
  permissionSource: "step" | "loop" | "none";
} {
  if (
    source.node.permissions &&
    Object.keys(source.node.permissions.github ?? {}).length > 0
  ) {
    return {
      permissions: parsePermissions(source.node.permissions),
      permissionSource: "step",
    };
  }
  if (source.loopPermissions) {
    return {
      permissions: parsePermissions(source.loopPermissions),
      permissionSource: "loop",
    };
  }
  return { permissions: {}, permissionSource: "none" };
}

export function adaptFrozenLoopAgentStepDefinition(
  source: FrozenLoopAgentStepDefinitionSource,
): FrozenLoopAgentStepDefinitionAdaptation {
  const effectivePermissions = effectiveLoopPermissions(source);
  const definition = agentDefinitionV1Schema.parse({
    version: 1,
    identity: {
      source: "loop_agent_step",
      sourceIds: [source.loopId, source.node.id],
      sourceQualifiedId: makeSourceQualifiedDefinitionId(
        "loop_agent_step",
        source.loopId,
        source.node.id,
      ),
    },
    metadata: { name: source.node.label, description: null },
    instructions: {
      text: source.node.instructions ?? null,
      usesSourceDefault: source.node.instructions === undefined,
    },
    inference: { modelId: null, inferenceProfileId: null },
    skills: { refs: [] },
    tools: {
      builtin: builtinPolicy(source.node.builtinToolNames),
      composio: {
        toolkitSlugs: [...(source.node.composioToolkitSlugs ?? [])],
      },
      nativeGithub: { mode: "source_default" },
      authoring: { enabled: false },
    },
    permissions: effectivePermissions.permissions,
    runtime: { managedRuntimeProfileId: null },
    verification: { checkCommand: source.node.checkCommand ?? null },
    output: { schema: source.node.outputSchema ?? null },
  });

  return {
    definition,
    separation: {
      automationBinding: {
        kind: "loop_step",
        loopId: source.loopId,
        nodeId: source.node.id,
        editorPosition: { ...source.node.position },
        permissionSource: effectivePermissions.permissionSource,
      },
      publishingPolicy: null,
      workspacePolicy: null,
    },
  };
}
