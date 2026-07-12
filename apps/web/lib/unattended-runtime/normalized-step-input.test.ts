import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import type { AgentStepNode } from "@/lib/agent-loops/types";
import type {
  AgentLoopExecutionSnapshotV1,
  ResolvedAgentLoopExecutionDefinition,
} from "@/lib/agent-loops/execution-snapshot";
import type {
  BackgroundAgentExecutionSnapshotV1,
  ResolvedBackgroundAgentExecutionDefinition,
} from "@/lib/background-agents/execution-snapshot";
import {
  buildNormalizedBackgroundLearningsInput,
  buildNormalizedBackgroundSandboxInput,
  buildNormalizedLoopStepInput,
  NormalizedUnattendedInputError,
  normalizedUnattendedStepInputV1Schema,
  parseNormalizedUnattendedStepInputV1,
} from "./normalized-step-input";

const frozenProvenance = {
  snapshotSource: "frozen" as const,
  definitionVersion: 1 as const,
  definitionHash: "a".repeat(64),
};

const common = {
  identity: {
    runId: "run-1",
    userId: "user-1",
    definitionId: "definition-1",
    requestId: "request-1",
    workflowRunId: "workflow-1",
  },
  provenance: frozenProvenance,
  repository: {
    owner: "Example",
    name: "Repository",
    ref: "refs/heads/main",
    sha: "abc123",
    branch: "main",
    defaultBranch: "main",
  },
};

const backgroundDefinition = {
  name: "Review agent",
  instructions: "Review the pull request.",
  builtinKind: null,
  inference: { route: "gateway" as const, modelId: "openai/gpt-5-mini" },
  permissions: { github: { contents: "read" as const } },
  builtinToolNames: ["fetch", "bash", "bash"],
  composioToolkitSlugs: ["github", "github"],
  githubActions: {
    open_pull_request: true,
    comment_on_pr_or_issue: true,
    approve_pull_request: false,
    request_changes: false,
    merge_pull_request: false,
    push: false,
    delete_branch: false,
  },
  writeScope: { mode: "this_repo" as const },
  requireCiGreenForMerge: true,
  checkCommand: "bun --bun run ci",
};

const authoritativeBackgroundSnapshot = {
  snapshotVersion: 1,
  source: {
    definitionId: "background-definition-1",
    name: backgroundDefinition.name,
    updatedAt: "2026-07-12T00:00:00.000Z",
    builtinKind: null,
  },
  repository: { owner: "SnapshotOwner", name: "SnapshotRepository" },
  instructions: backgroundDefinition.instructions,
  permissions: backgroundDefinition.permissions,
  checkCommand: backgroundDefinition.checkCommand,
  composioToolkitSlugs: backgroundDefinition.composioToolkitSlugs,
  builtinToolNames: backgroundDefinition.builtinToolNames,
  githubActions: backgroundDefinition.githubActions,
  writeScope: backgroundDefinition.writeScope,
  requireCiGreenForMerge: backgroundDefinition.requireCiGreenForMerge,
  inference: backgroundDefinition.inference,
} satisfies BackgroundAgentExecutionSnapshotV1;

const authoritativeLoopSnapshot = {
  snapshotVersion: 1,
  source: {
    definitionId: "loop-definition-1",
    name: "Loop definition",
    updatedAt: "2026-07-12T00:00:00.000Z",
  },
  repository: { owner: "SnapshotOwner", name: "SnapshotRepository" },
  definition: {
    nodes: [
      {
        id: "start",
        kind: "start",
        label: "Start",
        position: { x: 0, y: 0 },
      },
      {
        id: "review",
        kind: "agent_step",
        label: "Review",
        position: { x: 100, y: 0 },
        instructions: "Use the frozen loop instructions.",
        builtinToolNames: null,
      },
      {
        id: "end",
        kind: "end",
        label: "End",
        position: { x: 200, y: 0 },
      },
    ],
    edges: [
      { id: "start-review", source: "start", target: "review", when: "always" },
      { id: "review-end", source: "review", target: "end", when: "success" },
    ],
  },
  guardrails: {
    maxStepsPerRun: 20,
    maxIterations: 5,
    maxRunDurationMs: 3_600_000,
    stepTimeoutMs: 600_000,
    maxAgentTurnsPerStep: 8,
  },
  permissions: { github: { issues: "write" } },
  watchdog: { enabled: false, instructions: null, retryBudget: 0 },
} satisfies AgentLoopExecutionSnapshotV1;

function backgroundSandboxFixture() {
  return {
    ...common,
    identity: { ...common.identity, triggerId: "trigger-1" },
    definition: backgroundDefinition,
    trigger: {
      kind: "github.pull_request",
      ref: "refs/pull/17/head",
      sha: "abc123",
      branch: "feature/contract",
      prNumber: 17,
      issueNumber: null,
      deploymentUrl: null,
      summary: {
        title: "Normalize unattended input",
        url: "https://github.com/example/repository/pull/17",
        actor: "octocat",
        action: "opened",
        environment: null,
        severity: null,
        message: null,
      },
    },
    workspace: {
      sandboxName: "background_run-1",
      initialCheckout: {
        ref: "refs/pull/17/head",
        source: "event_ref" as const,
      },
    },
  };
}

function loopFixture() {
  return {
    ...common,
    identity: {
      ...common.identity,
      stepRunId: "step-1",
      nodeId: "review",
      attempt: 2,
    },
    node: {
      instructions: "Fix the reviewed issue.",
      outputSchema: { fixed: "boolean" },
      checkCommand: "bun test",
      permissions: { github: { contents: "write" as const } },
      builtinToolNames: ["bash", "fetch", "bash"],
      composioToolkitSlugs: ["github", "github"],
    },
    promptContext: {
      trigger: {
        kind: "github.issue",
        title: "A bounded issue",
        url: "https://github.com/example/repository/issues/9",
        actor: "octocat",
        action: "opened",
        message: null,
      },
      priorSteps: { inspect: { outcome: "needs_fix" } },
    },
    watchdogHint: "Try the smaller change first.",
    budgets: { timeoutMs: 600_000, maxTurns: 8 },
    workspace: {
      sandboxName: "agent_loop_step-1",
      initialCheckout: { ref: "main", source: "context_branch" as const },
    },
  };
}

describe("NormalizedUnattendedStepInputV1", () => {
  test("builds a strict background sandbox input with requested intent and persistent resume", () => {
    const result = buildNormalizedBackgroundSandboxInput(
      backgroundSandboxFixture(),
    );

    expect(result).toMatchObject({
      version: 1,
      source: "background_agent",
      executionKind: "background_sandbox",
      provenance: frozenProvenance,
      requestedPolicy: {
        declaredPermissions: backgroundDefinition.permissions,
        builtinToolNames: ["bash", "fetch"],
        composioToolkitSlugs: ["github"],
      },
      workspace: {
        policy: "persistent_resume",
        createIfMissing: true,
        resume: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain("effectivePolicy");
  });

  test("keeps the proven built-in learnings path explicit and sandbox-free", () => {
    const result = buildNormalizedBackgroundLearningsInput({
      ...common,
      identity: { ...common.identity, triggerId: "trigger-1" },
      definition: {
        name: "Learnings",
        instructions: "Collect repository learnings.",
        builtinKind: "pr_review_learnings" as const,
      },
      trigger: backgroundSandboxFixture().trigger,
    });

    expect(result).toMatchObject({
      source: "background_agent",
      executionKind: "background_builtin_learnings",
      workspace: { policy: "none" },
      output: { kind: "agent_summary" },
    });
  });

  test("builds a loop step with disposable lifecycle, frozen budgets, and distinct step identity", () => {
    const result = buildNormalizedLoopStepInput(loopFixture());

    expect(result).toMatchObject({
      version: 1,
      source: "agent_loop_step",
      executionKind: "loop_agent_step",
      identity: { stepRunId: "step-1", nodeId: "review", attempt: 2 },
      model: { route: "runtime_default" },
      budgets: { timeoutMs: 600_000, maxTurns: 8 },
      workspace: {
        policy: "disposable_step",
        disposeAfterStep: true,
        persistent: false,
        resume: false,
      },
      output: {
        kind: "json_file",
        path: "/tmp/loop-step-output.json",
        maxBytes: 65_536,
        requiredBranch: true,
      },
    });
  });

  test("models frozen and legacy provenance as mutually exclusive strict variants", () => {
    const frozen = buildNormalizedBackgroundSandboxInput(
      backgroundSandboxFixture(),
    );
    const legacy = {
      ...frozen,
      provenance: {
        snapshotSource: "legacy_live_fallback",
        definitionVersion: null,
        definitionHash: null,
      },
    };

    expect(
      normalizedUnattendedStepInputV1Schema.safeParse(legacy).success,
    ).toBe(true);
    expect(
      normalizedUnattendedStepInputV1Schema.safeParse({
        ...frozen,
        provenance: {
          snapshotSource: "frozen",
          definitionVersion: null,
          definitionHash: null,
        },
      }).success,
    ).toBe(false);
    expect(
      normalizedUnattendedStepInputV1Schema.safeParse({
        ...frozen,
        provenance: {
          snapshotSource: "legacy_live_fallback",
          definitionVersion: 1,
          definitionHash: "b".repeat(64),
        },
      }).success,
    ).toBe(false);
  });

  test("rejects unknown versions, keys, and source-only field contamination", () => {
    const background = buildNormalizedBackgroundSandboxInput(
      backgroundSandboxFixture(),
    );
    const loop = buildNormalizedLoopStepInput(loopFixture());

    expect(
      normalizedUnattendedStepInputV1Schema.safeParse({
        ...background,
        version: 2,
      }).success,
    ).toBe(false);
    expect(
      normalizedUnattendedStepInputV1Schema.safeParse({
        ...background,
        token: "forbidden",
      }).success,
    ).toBe(false);
    expect(
      normalizedUnattendedStepInputV1Schema.safeParse({
        ...loop,
        trigger: background.trigger,
      }).success,
    ).toBe(false);
  });

  test("rejects raw payload, transcript, credentials, runtime handles, functions, dates, cycles, and non-finite values", () => {
    const forbiddenValues: unknown[] = [
      { ...loopFixture(), promptContext: { rawPayload: { token: "secret" } } },
      { ...loopFixture(), promptContext: { transcript: ["private"] } },
      { ...loopFixture(), promptContext: { session: { id: "s" } } },
      { ...loopFixture(), promptContext: { sandbox: { id: "sb" } } },
      { ...loopFixture(), promptContext: { callback: () => true } },
      { ...loopFixture(), promptContext: { createdAt: new Date() } },
      { ...loopFixture(), promptContext: { score: Number.POSITIVE_INFINITY } },
    ];
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    forbiddenValues.push({ ...loopFixture(), promptContext: cyclic });

    for (const input of forbiddenValues) {
      expect(() => buildNormalizedLoopStepInput(input as never)).toThrow(
        NormalizedUnattendedInputError,
      );
    }
  });

  test("rejects provider-prefixed secret and runtime-handle keys", () => {
    const disguisedKeys = [
      { githubAccessToken: "private-token" },
      { sandboxHandle: { id: "sandbox-1" } },
      { sessionId: "session-1" },
    ];

    for (const promptContext of disguisedKeys) {
      expect(() =>
        buildNormalizedLoopStepInput({
          ...loopFixture(),
          promptContext,
        }),
      ).toThrow(NormalizedUnattendedInputError);
    }
  });

  test("returns detached dynamic JSON that cannot be mutated after validation", () => {
    const promptContext: Record<string, unknown> = { note: "before" };
    const outputSchema: Record<string, unknown> = { outcome: "string" };
    const result = buildNormalizedLoopStepInput({
      ...loopFixture(),
      node: { ...loopFixture().node, outputSchema },
      promptContext,
    });

    expect(result.prompt.context).not.toBe(promptContext);
    expect(result.output.schema).not.toBe(outputSchema);

    promptContext.token = "injected-after-validation";
    outputSchema.callback = () => true;

    expect(result.prompt.context).toEqual({ note: "before" });
    expect(result.output.schema).toEqual({ outcome: "string" });
  });

  test("preserves source loop null tool defaults and loop permission fallback", () => {
    const node = {
      id: "review",
      kind: "agent_step",
      label: "Review",
      position: { x: 0, y: 0 },
      instructions: "Fix the reviewed issue.",
      builtinToolNames: null,
    } satisfies AgentStepNode;
    const loopPermissions = { github: { issues: "write" as const } };

    const result = buildNormalizedLoopStepInput({
      ...loopFixture(),
      node,
      loopPermissions,
    } as never);

    expect(result.requestedPolicy.builtinToolNames).toBeNull();
    expect(result.requestedPolicy.composioToolkitSlugs).toEqual([]);
    expect(result.requestedPolicy.declaredPermissions).toEqual(loopPermissions);
  });

  test("rejects a learnings definition passed to the sandbox builder", () => {
    expect(() =>
      buildNormalizedBackgroundSandboxInput({
        ...backgroundSandboxFixture(),
        definition: {
          ...backgroundDefinition,
          builtinKind: "pr_review_learnings",
        },
      }),
    ).toThrow(NormalizedUnattendedInputError);
  });

  test("redacts and bounds attacker-controlled dynamic error paths", () => {
    const privatePathSegment = `ghp_${"private".repeat(10_000)}`;

    try {
      buildNormalizedLoopStepInput({
        ...loopFixture(),
        promptContext: {
          [privatePathSegment]: { token: "rejected" },
        },
      });
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(NormalizedUnattendedInputError);
      const normalizedError = error as NormalizedUnattendedInputError;
      expect(JSON.stringify(normalizedError)).not.toContain(privatePathSegment);
      for (const issue of normalizedError.issues) {
        for (const part of issue.path) {
          if (typeof part === "string")
            expect(part.length).toBeLessThanOrEqual(128);
        }
      }
    }
  });

  test("rejects an openai-compatible user model without a base URL", () => {
    expect(() =>
      buildNormalizedBackgroundSandboxInput({
        ...backgroundSandboxFixture(),
        definition: {
          ...backgroundDefinition,
          inference: {
            route: "user",
            modelId: "custom-model",
            inferenceProfileId: "profile-1",
            provider: "openai-compatible",
            baseUrl: null,
          },
        },
      }),
    ).toThrow(NormalizedUnattendedInputError);
  });

  test("derives frozen fields from one verified authoritative snapshot envelope", () => {
    const resolvedBackground = {
      definition: authoritativeBackgroundSnapshot,
      snapshotSource: "frozen",
      definitionVersion: 1,
      definitionHash: "b".repeat(64),
    } satisfies ResolvedBackgroundAgentExecutionDefinition;
    const background = buildNormalizedBackgroundSandboxInput({
      resolvedDefinition: resolvedBackground,
      identity: {
        runId: "background-run-1",
        userId: "user-1",
        triggerId: "trigger-1",
        requestId: "request-1",
        workflowRunId: "workflow-1",
      },
      repositoryIntent: {
        ref: "refs/pull/17/head",
        sha: "abc123",
        branch: "feature/contract",
        defaultBranch: "main",
      },
      trigger: backgroundSandboxFixture().trigger,
      workspace: backgroundSandboxFixture().workspace,
    } as never);

    expect(background.identity.definitionId).toBe(
      authoritativeBackgroundSnapshot.source.definitionId,
    );
    expect(background.repository).toMatchObject(
      authoritativeBackgroundSnapshot.repository,
    );
    expect(background.prompt.instructions).toBe(
      authoritativeBackgroundSnapshot.instructions,
    );
    expect(background.provenance).toEqual({
      snapshotSource: "frozen",
      definitionVersion: 1,
      definitionHash: "b".repeat(64),
    });

    const resolvedLoop = {
      definition: authoritativeLoopSnapshot,
      snapshotSource: "frozen",
      definitionVersion: 1,
      definitionHash: "c".repeat(64),
    } satisfies ResolvedAgentLoopExecutionDefinition;
    const loop = buildNormalizedLoopStepInput({
      resolvedDefinition: resolvedLoop,
      identity: {
        runId: "loop-run-1",
        userId: "user-1",
        stepRunId: "step-1",
        nodeId: "review",
        attempt: 1,
        requestId: "request-1",
        workflowRunId: "workflow-1",
      },
      repositoryIntent: {
        ref: null,
        sha: null,
        branch: "main",
        defaultBranch: "main",
      },
      promptContext: {},
      watchdogHint: null,
      workspace: loopFixture().workspace,
    } as never);

    expect(loop.identity.definitionId).toBe(
      authoritativeLoopSnapshot.source.definitionId,
    );
    expect(loop.repository).toMatchObject(authoritativeLoopSnapshot.repository);
    expect(loop.prompt.instructions).toBe("Use the frozen loop instructions.");
    expect(loop.budgets).toEqual({ timeoutMs: 600_000, maxTurns: 8 });
    expect(loop.requestedPolicy).toMatchObject({
      declaredPermissions: authoritativeLoopSnapshot.permissions,
      builtinToolNames: null,
      composioToolkitSlugs: [],
    });
  });

  test("bounds dynamic summaries, context, hints, arrays, depth, and container entries", () => {
    expect(() =>
      buildNormalizedBackgroundSandboxInput({
        ...backgroundSandboxFixture(),
        trigger: {
          ...backgroundSandboxFixture().trigger,
          summary: {
            ...backgroundSandboxFixture().trigger.summary,
            message: "x".repeat(8193),
          },
        },
      }),
    ).toThrow(NormalizedUnattendedInputError);
    expect(() =>
      buildNormalizedLoopStepInput({
        ...loopFixture(),
        watchdogHint: "x".repeat(4097),
      }),
    ).toThrow(NormalizedUnattendedInputError);
    expect(() =>
      buildNormalizedLoopStepInput({
        ...loopFixture(),
        promptContext: { values: Array.from({ length: 201 }, (_, i) => i) },
      }),
    ).toThrow(NormalizedUnattendedInputError);
  });

  test("returns stable safe validation issues without rejected values", () => {
    const privateValue = "do-not-echo-this-private-value";
    try {
      parseNormalizedUnattendedStepInputV1({
        version: 1,
        source: "agent_loop_step",
        token: privateValue,
      });
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(NormalizedUnattendedInputError);
      const normalizedError = error as NormalizedUnattendedInputError;
      expect(normalizedError.errorKind).toBe("normalized_input_invalid");
      expect(normalizedError.issues.length).toBeGreaterThan(0);
      expect(normalizedError.issues[0]).toEqual({
        code: expect.any(String),
        path: expect.any(Array),
      });
      expect(JSON.stringify(normalizedError)).not.toContain(privateValue);
      expect(normalizedError.message).not.toContain(privateValue);
    }
  });

  test("is deterministic and normalizes only set-like values", () => {
    const first = buildNormalizedBackgroundSandboxInput(
      backgroundSandboxFixture(),
    );
    const second = buildNormalizedBackgroundSandboxInput(
      backgroundSandboxFixture(),
    );
    const loop = buildNormalizedLoopStepInput(loopFixture());

    expect(first).toEqual(second);
    expect(first.repository).toEqual(loop.repository);
    expect(first.identity.runId).toBe(loop.identity.runId);
    expect(first.requestedPolicy.builtinToolNames).toEqual(["bash", "fetch"]);
    expect(loop.requestedPolicy.builtinToolNames).toEqual(["bash", "fetch"]);
  });

  test("implementation stays dependency-light and side-effect free", async () => {
    const source = await readFile(
      new URL("normalized-step-input.ts", import.meta.url),
      "utf8",
    );
    const forbidden = [
      "@/lib/db",
      "server-only",
      "next/",
      "@/lib/sandbox",
      "@/lib/github",
      "@/lib/composio",
      "openAgent",
      "process.env",
      "Date.now",
      "Math.random",
      "crypto.randomUUID",
      "console.",
      "fetch(",
      "import(",
    ];
    for (const value of forbidden) expect(source).not.toContain(value);
  });
});
