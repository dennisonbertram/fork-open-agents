import { describe, expect, test } from "bun:test";
import type { ResolvedAgent } from "@/lib/agents/resolve-agent";
import type { BackgroundAgentPermissions } from "@/lib/db/schema";
import type { AgentStepNode } from "@/lib/agent-loops/types";
import {
  BACKGROUND_AGENT_FIELD_CLASSIFICATION,
  FROZEN_LOOP_STEP_FIELD_CLASSIFICATION,
  RESOLVED_AGENT_FIELD_CLASSIFICATION,
  adaptBackgroundAgentDefinition,
  adaptFrozenLoopAgentStepDefinition,
  adaptResolvedAgentDefinition,
  type BackgroundAgentDefinitionSource,
} from "./adapters";
import { makeSourceQualifiedDefinitionId } from "./schema";

describe("ResolvedAgent adapter", () => {
  test("maps every source field into the definition or an explicit binding", () => {
    const source: ResolvedAgent = {
      role: "executor",
      fromDbRow: true,
      agentId: "shared-id",
      modelId: "openai/gpt-5",
      inferenceProfileId: "inference-1",
      instructions: "Implement the issue",
      skillRefs: [{ source: "owner/skills", skillName: "implementation" }],
      builtinToolNames: ["read", "bash"],
      composioToolkitSlugs: ["linear"],
      composioProfileId: "composio-profile-1",
      managedRuntimeProfileId: "runtime-1",
      toolAuthoringEnabled: true,
      githubToolsEnabled: true,
    };

    const result = adaptResolvedAgentDefinition(source);

    expect(result).toEqual({
      definition: {
        version: 1,
        identity: {
          source: "resolved_agent",
          sourceIds: ["shared-id"],
          sourceQualifiedId: makeSourceQualifiedDefinitionId(
            "resolved_agent",
            "shared-id",
          ),
        },
        metadata: { name: "executor", description: null },
        instructions: {
          text: "Implement the issue",
          usesSourceDefault: false,
        },
        inference: {
          modelId: "openai/gpt-5",
          inferenceProfileId: "inference-1",
        },
        skills: {
          refs: [{ source: "owner/skills", skillName: "implementation" }],
        },
        tools: {
          builtin: { mode: "allowlist", names: ["read", "bash"] },
          composio: { toolkitSlugs: ["linear"] },
          nativeGithub: { mode: "enabled" },
          authoring: { enabled: true },
        },
        permissions: {},
        runtime: { managedRuntimeProfileId: "runtime-1" },
        verification: { checkCommand: null },
        output: { schema: null },
      },
      separation: {
        automationBinding: {
          kind: "chat_role",
          role: "executor",
          resolutionOrigin: "agents_row",
          credentialBindings: {
            composioProfileId: "composio-profile-1",
          },
        },
        publishingPolicy: null,
        workspacePolicy: null,
      },
    });
    expect(RESOLVED_AGENT_FIELD_CLASSIFICATION).toEqual({
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
    });
  });

  test("synthetic fallback identity is stable without making the agents table canonical", () => {
    const source: ResolvedAgent = {
      role: "main",
      fromDbRow: false,
      agentId: null,
      modelId: null,
      inferenceProfileId: null,
      instructions: null,
      skillRefs: [],
      builtinToolNames: null,
      composioToolkitSlugs: [],
      composioProfileId: null,
      managedRuntimeProfileId: null,
      toolAuthoringEnabled: false,
      githubToolsEnabled: false,
    };

    const result = adaptResolvedAgentDefinition(source);

    expect(result.definition.identity.sourceIds).toEqual(["fallback", "main"]);
    expect(result.definition.instructions).toEqual({
      text: null,
      usesSourceDefault: true,
    });
    expect(result.definition.tools.builtin).toEqual({
      mode: "source_default",
      names: [],
    });
    expect(result.separation.automationBinding.resolutionOrigin).toBe(
      "preference_fallback",
    );
  });
});

describe("background-agent adapter", () => {
  test("keeps reusable definition separate from binding and publishing policy", () => {
    const source: BackgroundAgentDefinitionSource = {
      id: "shared-id",
      name: "PR reviewer",
      description: "Reviews pull requests",
      status: "enabled",
      repoOwner: "private-owner",
      repoName: "private-repo",
      instructions: "Review the pull request",
      checkCommand: "bun test",
      triggers: [
        {
          id: "trigger-1",
          name: "PR opened",
          kind: "github.pull_request",
          status: "enabled",
          conditions: { actions: ["opened"] },
          schedule: null,
          webhookPublicId: "public-hook-1",
        },
      ],
      permissions: {
        github: { contents: "read", pullRequests: "write", issues: "read" },
      },
      composioToolkitSlugs: ["linear"],
      builtinToolNames: ["read", "bash"],
      githubActions: {
        comment_on_pr_or_issue: true,
        request_changes: true,
      },
      writeScope: {
        mode: "specific_repos",
        repos: [{ owner: "publish-owner", name: "publish-repo" }],
      },
      requireCiGreenForMerge: true,
      runBudgetPerTarget: 4,
      modelId: "openai/gpt-5",
    };

    const result = adaptBackgroundAgentDefinition(source);

    expect(result.definition).toEqual({
      version: 1,
      identity: {
        source: "background_agent",
        sourceIds: ["shared-id"],
        sourceQualifiedId: makeSourceQualifiedDefinitionId(
          "background_agent",
          "shared-id",
        ),
      },
      metadata: {
        name: "PR reviewer",
        description: "Reviews pull requests",
      },
      instructions: {
        text: "Review the pull request",
        usesSourceDefault: false,
      },
      inference: { modelId: "openai/gpt-5", inferenceProfileId: null },
      skills: { refs: [] },
      tools: {
        builtin: { mode: "allowlist", names: ["read", "bash"] },
        composio: { toolkitSlugs: ["linear"] },
        nativeGithub: { mode: "enabled" },
        authoring: { enabled: false },
      },
      permissions: {
        github: { contents: "read", pullRequests: "write", issues: "read" },
      },
      runtime: { managedRuntimeProfileId: null },
      verification: { checkCommand: "bun test" },
      output: { schema: null },
    });
    expect(result.separation).toEqual({
      automationBinding: {
        kind: "background_agent",
        status: "enabled",
        repository: { owner: "private-owner", name: "private-repo" },
        triggers: [
          {
            id: "trigger-1",
            name: "PR opened",
            kind: "github.pull_request",
            status: "enabled",
            conditions: { actions: ["opened"] },
            schedule: null,
            webhookPublicId: "public-hook-1",
          },
        ],
        runBudgetPerTarget: 4,
      },
      publishingPolicy: {
        githubActions: {
          comment_on_pr_or_issue: true,
          request_changes: true,
        },
        writeScope: {
          mode: "specific_repos",
          repos: [{ owner: "publish-owner", name: "publish-repo" }],
        },
        requireCiGreenForMerge: true,
      },
      workspacePolicy: null,
    });
    expect(BACKGROUND_AGENT_FIELD_CLASSIFICATION).toEqual({
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
    });
  });

  test("does not serialize secrets, triggers, repository, branch, or workspace data into a definition", () => {
    const source = {
      id: "agent-1",
      name: "Safe agent",
      description: null,
      status: "enabled",
      repoOwner: "repo-owner-marker",
      repoName: "repo-name-marker",
      instructions: "Do safe work",
      checkCommand: null,
      triggers: [
        {
          id: "trigger-marker",
          name: "trigger-name-marker",
          kind: "webhook.error",
          status: "enabled",
          conditions: { severities: ["critical"] },
          schedule: null,
          webhookPublicId: "public-hook-marker",
          webhookSecretHash: "secret-hash-marker",
        },
      ],
      permissions: {},
      composioToolkitSlugs: [],
      builtinToolNames: null,
      githubActions: {},
      writeScope: { mode: "this_repo" },
      requireCiGreenForMerge: true,
      runBudgetPerTarget: 10,
      modelId: null,
      branch: "branch-marker",
      workspace: { sandboxName: "workspace-marker" },
      providerToken: "provider-token-marker",
    } as unknown as BackgroundAgentDefinitionSource & Record<string, unknown>;

    const result = adaptBackgroundAgentDefinition(source);
    const serializedDefinition = JSON.stringify(result.definition);
    const serializedResult = JSON.stringify(result);

    for (const marker of [
      "repo-owner-marker",
      "repo-name-marker",
      "trigger-name-marker",
      "secret-hash-marker",
      "branch-marker",
      "workspace-marker",
      "provider-token-marker",
    ]) {
      expect(serializedDefinition).not.toContain(marker);
    }
    expect(serializedResult).not.toContain("secret-hash-marker");
    expect(serializedResult).not.toContain("provider-token-marker");
  });

  test("preserves the merge-only trigger guard while excluding unknown trigger fields", () => {
    for (const mergedOnly of [true, false] as const) {
      const source = {
        id: `agent-merged-only-${mergedOnly}`,
        name: "Merged PR agent",
        description: null,
        status: "enabled",
        repoOwner: "acme",
        repoName: "widgets",
        instructions: "Handle merged pull requests",
        checkCommand: null,
        triggers: [
          {
            id: `trigger-merged-only-${mergedOnly}`,
            name: "Merged PR",
            kind: "github.pull_request",
            status: "enabled",
            conditions: {
              actions: ["closed"],
              mergedOnly,
              unknownCondition: "unknown-condition-marker",
            },
            schedule: null,
            webhookPublicId: null,
            webhookSecretHash: "secret-hash-marker",
          },
        ],
        permissions: {},
        composioToolkitSlugs: [],
        builtinToolNames: null,
        githubActions: {},
        writeScope: { mode: "this_repo" },
        requireCiGreenForMerge: true,
        runBudgetPerTarget: 10,
        modelId: null,
      } as unknown as BackgroundAgentDefinitionSource;

      const result = adaptBackgroundAgentDefinition(source);
      const [trigger] = result.separation.automationBinding.triggers;

      expect(trigger?.conditions).toEqual({
        actions: ["closed"],
        mergedOnly,
      });
      expect(JSON.stringify(trigger)).not.toContain("unknown-condition-marker");
      expect(JSON.stringify(trigger)).not.toContain("secret-hash-marker");
    }
  });
});

describe("frozen loop agent-step adapter", () => {
  const loopPermissions: BackgroundAgentPermissions = {
    github: { contents: "read", issues: "write" },
  };

  const node: AgentStepNode = {
    id: "node:1",
    label: "Implement",
    position: { x: 120, y: 240 },
    kind: "agent_step",
    instructions: "Implement the change",
    outputSchema: { branch: "string", testsPassed: "boolean" },
    checkCommand: "bun test",
    composioToolkitSlugs: ["linear"],
    builtinToolNames: ["read", "bash"],
  };

  test("maps the frozen step and inherited loop permissions without editor policy leakage", () => {
    const result = adaptFrozenLoopAgentStepDefinition({
      loopId: "loop/shared",
      node,
      loopPermissions,
    });

    expect(result).toEqual({
      definition: {
        version: 1,
        identity: {
          source: "loop_agent_step",
          sourceIds: ["loop/shared", "node:1"],
          sourceQualifiedId: makeSourceQualifiedDefinitionId(
            "loop_agent_step",
            "loop/shared",
            "node:1",
          ),
        },
        metadata: { name: "Implement", description: null },
        instructions: {
          text: "Implement the change",
          usesSourceDefault: false,
        },
        inference: { modelId: null, inferenceProfileId: null },
        skills: { refs: [] },
        tools: {
          builtin: { mode: "allowlist", names: ["read", "bash"] },
          composio: { toolkitSlugs: ["linear"] },
          nativeGithub: { mode: "source_default" },
          authoring: { enabled: false },
        },
        permissions: {
          github: { contents: "read", issues: "write" },
        },
        runtime: { managedRuntimeProfileId: null },
        verification: { checkCommand: "bun test" },
        output: { schema: { branch: "string", testsPassed: "boolean" } },
      },
      separation: {
        automationBinding: {
          kind: "loop_step",
          loopId: "loop/shared",
          nodeId: "node:1",
          editorPosition: { x: 120, y: 240 },
          permissionSource: "loop",
        },
        publishingPolicy: null,
        workspacePolicy: null,
      },
    });
    expect(FROZEN_LOOP_STEP_FIELD_CLASSIFICATION).toEqual({
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
    });
  });

  test("step permissions override loop permissions exactly like the frozen executor contract", () => {
    const result = adaptFrozenLoopAgentStepDefinition({
      loopId: "loop-1",
      node: {
        ...node,
        permissions: { github: { pullRequests: "write" } },
      },
      loopPermissions,
    });

    expect(result.definition.permissions).toEqual({
      github: { pullRequests: "write" },
    });
    expect(result.separation.automationBinding.permissionSource).toBe("step");
  });
});
