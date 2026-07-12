import { describe, expect, test } from "bun:test";
import {
  agentDefinitionV1Schema,
  makeSourceQualifiedDefinitionId,
  parseAgentDefinition,
} from "./schema";

const validDefinition = {
  version: 1 as const,
  identity: {
    source: "background_agent" as const,
    sourceIds: ["shared-id"],
    sourceQualifiedId: makeSourceQualifiedDefinitionId(
      "background_agent",
      "shared-id",
    ),
  },
  metadata: { name: "Reviewer", description: "Reviews pull requests" },
  instructions: { text: "Review the change", usesSourceDefault: false },
  inference: { modelId: "openai/gpt-5", inferenceProfileId: null },
  skills: { refs: [{ source: "owner/skills", skillName: "review" }] },
  tools: {
    builtin: { mode: "allowlist" as const, names: ["read", "bash"] },
    composio: { toolkitSlugs: ["linear"] },
    nativeGithub: { mode: "enabled" as const },
    authoring: { enabled: false },
  },
  permissions: {
    github: { contents: "read" as const, pullRequests: "write" as const },
  },
  runtime: { managedRuntimeProfileId: null },
  verification: { checkCommand: "bun test" },
  output: { schema: { approved: "boolean" } },
};

describe("AgentDefinitionV1 schema", () => {
  test("accepts the complete version-one contract", () => {
    expect(agentDefinitionV1Schema.parse(validDefinition)).toEqual(
      validDefinition,
    );
  });

  test("fails unknown future versions with one stable safe error kind", () => {
    const result = parseAgentDefinition({
      ...validDefinition,
      version: 2,
      providerToken: "secret-that-must-not-be-reflected",
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: "agent_definition_invalid" },
    });
    expect(JSON.stringify(result)).not.toContain(
      "secret-that-must-not-be-reflected",
    );
  });

  test("rejects a source-qualified identity that does not match its source parts", () => {
    expect(
      agentDefinitionV1Schema.safeParse({
        ...validDefinition,
        identity: {
          ...validDefinition.identity,
          sourceQualifiedId: "background_agent:forged",
        },
      }).success,
    ).toBe(false);
  });

  test("source-qualified IDs cannot collide across sources or ambiguous parts", () => {
    const backgroundId = makeSourceQualifiedDefinitionId(
      "background_agent",
      "shared-id",
    );
    const resolvedId = makeSourceQualifiedDefinitionId(
      "resolved_agent",
      "shared-id",
    );
    const splitOne = makeSourceQualifiedDefinitionId(
      "loop_agent_step",
      "loop/a",
      "node",
    );
    const splitTwo = makeSourceQualifiedDefinitionId(
      "loop_agent_step",
      "loop",
      "a/node",
    );

    expect(new Set([backgroundId, resolvedId, splitOne, splitTwo]).size).toBe(
      4,
    );
  });

  test("strict validation prevents policy and secret fields entering definitions", () => {
    expect(
      agentDefinitionV1Schema.safeParse({
        ...validDefinition,
        repoOwner: "private-owner",
        trigger: { kind: "github.pull_request" },
        workspace: { branch: "main" },
        webhookSecretHash: "secret-hash",
      }).success,
    ).toBe(false);
  });
});
