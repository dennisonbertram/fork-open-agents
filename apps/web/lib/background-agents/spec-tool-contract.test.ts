/**
 * Tests for spec-tool-contract.ts — the shared module that validates,
 * normalizes, and summarizes background-agent drafts without persisting.
 */
import { describe, expect, test } from "bun:test";
import {
  mapAgentTriggerKind,
  normalizeAgentDraft,
  normalizeAgentPermissions,
  normalizeAgentTriggerConditions,
  previewBackgroundAgentSpec,
  previewBackgroundAgentSpecSchema,
  type PreviewBackgroundAgentSpecInput,
} from "./spec-tool-contract";
import { createBackgroundAgentSchema } from "./types";

// ── Minimal valid draft builders ─────────────────────────────────────────

function validCreateDraft(overrides: Record<string, unknown> = {}) {
  return {
    name: "PR Reviewer",
    repoOwner: "acme",
    repoName: "widgets",
    instructions: "Review new pull requests and add a summary comment.",
    outputMode: "none" as const,
    permissions: {
      github: {
        contents: "read" as const,
        pullRequests: "read" as const,
      },
    },
    triggers: [
      {
        name: "Pull request",
        kind: "github.pull_request" as const,
        conditions: { actions: ["opened"] },
      },
    ],
    ...overrides,
  };
}

function validCreateInput(
  overrides: Record<string, unknown> = {},
): PreviewBackgroundAgentSpecInput {
  return {
    mode: "create" as const,
    draft: validCreateDraft(overrides),
  };
}

function validUpdateDraft(overrides: Record<string, unknown> = {}) {
  return {
    name: "Updated PR Reviewer",
    instructions: "Review new pull requests with more detail.",
    ...overrides,
  };
}

function validUpdateInput(
  overrides: Record<string, unknown> = {},
): PreviewBackgroundAgentSpecInput {
  return {
    mode: "update" as const,
    agentId: "agent_abc123",
    draft: validUpdateDraft(overrides),
  };
}

// ── Schema tests ─────────────────────────────────────────────────────────

describe("previewBackgroundAgentSpecSchema", () => {
  test("accepts a valid create input", () => {
    const input = validCreateInput();
    const parsed = previewBackgroundAgentSpecSchema.safeParse(input);
    expect(parsed.success).toBe(true);
  });

  test("accepts a valid update input", () => {
    const input = validUpdateInput();
    const parsed = previewBackgroundAgentSpecSchema.safeParse(input);
    expect(parsed.success).toBe(true);
  });

  test("accepts a create draft with all optional fields populated", () => {
    const input = validCreateInput({
      description: "An agent that reviews PRs.",
      status: "enabled",
      checkCommand: "bun --bun run ci",
      composioToolkitSlugs: ["github", "slack"],
    });
    const parsed = previewBackgroundAgentSpecSchema.safeParse(input);
    expect(parsed.success).toBe(true);
  });

  test("accepts a create draft with schedule.cron trigger", () => {
    const input: PreviewBackgroundAgentSpecInput = {
      mode: "create",
      draft: {
        name: "Weekly Notes",
        repoOwner: "acme",
        repoName: "widgets",
        instructions: "Generate weekly release notes.",
        outputMode: "ready_pr",
        permissions: {
          github: {
            contents: "write",
            pullRequests: "write",
          },
        },
        triggers: [
          {
            name: "Weekly schedule",
            kind: "schedule.cron",
            schedule: "0 9 * * 1",
          },
        ],
      },
    };
    const parsed = previewBackgroundAgentSpecSchema.safeParse(input);
    expect(parsed.success).toBe(true);
  });

  test("rejects a create input missing required fields", () => {
    const input: PreviewBackgroundAgentSpecInput = {
      mode: "create",
      // draft is missing instructions and triggers
      draft: {
        name: "Test",
        repoOwner: "acme",
        repoName: "widgets",
        instructions: "",
        outputMode: "none",
        triggers: [],
      },
    };
    const parsed = previewBackgroundAgentSpecSchema.safeParse(input);
    expect(parsed.success).toBe(false);
  });

  test("rejects a create input with invalid trigger kind", () => {
    const input: PreviewBackgroundAgentSpecInput = {
      mode: "create",
      draft: {
        name: "Test",
        repoOwner: "acme",
        repoName: "widgets",
        instructions: "Test.",
        outputMode: "none",
        triggers: [
          {
            name: "Bad trigger",
            kind: "invalid.kind" as never,
          },
        ],
      },
    };
    const parsed = previewBackgroundAgentSpecSchema.safeParse(input);
    expect(parsed.success).toBe(false);
  });

  test("rejects an update input without agentId", () => {
    const input = {
      mode: "update",
      // missing agentId
      draft: validUpdateDraft(),
    };
    const parsed = previewBackgroundAgentSpecSchema.safeParse(input);
    expect(parsed.success).toBe(false);
  });
});

// ── previewBackgroundAgentSpec — success cases ───────────────────────────

describe("previewBackgroundAgentSpec — success", () => {
  test("returns ok:true for a valid create draft", () => {
    const result = previewBackgroundAgentSpec(validCreateInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mode).toBe("create");
      expect(result.normalized).toBeDefined();
      expect(result.summary).toContain("**Name:** PR Reviewer");
      expect(result.summary).toContain("**Instructions:**");
      expect(result.triggerSummary).toContain("Pull request");
      expect(result.warnings).toEqual([]);
    }
  });

  test("returns ok:true for a valid update draft", () => {
    const result = previewBackgroundAgentSpec(validUpdateInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mode).toBe("update");
      expect(result.agentId).toBe("agent_abc123");
      expect(result.summary).toContain("Updated PR Reviewer");
    }
  });

  test("summary includes output mode", () => {
    const result = previewBackgroundAgentSpec(
      validCreateInput({ outputMode: "ready_pr" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).toContain("Open a pull request");
    }
  });

  test("summary includes trigger details", () => {
    const result = previewBackgroundAgentSpec(
      validCreateInput({
        triggers: [
          {
            name: "Pull request",
            kind: "github.pull_request",
            conditions: {
              actions: ["opened", "synchronize"],
              branches: ["main"],
            },
          },
          {
            name: "Issue opened",
            kind: "github.issue",
            conditions: { actions: ["opened"] },
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.triggerSummary).toContain('"Pull request"');
      expect(result.triggerSummary).toContain('"Issue opened"');
      expect(result.triggerSummary).toContain("actions: [opened, synchronize]");
      expect(result.triggerSummary).toContain("branches: [main]");
    }
  });

  test("trigger summary handles schedule trigger with cron expression", () => {
    const input: PreviewBackgroundAgentSpecInput = {
      mode: "create",
      draft: {
        name: "Weekly Notes",
        repoOwner: "acme",
        repoName: "widgets",
        instructions: "Generate weekly release notes.",
        outputMode: "none",
        triggers: [
          {
            name: "Weekly schedule",
            kind: "schedule.cron",
            schedule: "0 9 * * 1",
          },
        ],
      },
    };
    const result = previewBackgroundAgentSpec(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.triggerSummary).toContain("Schedule: `0 9 * * 1`");
    }
  });

  test("summary includes composio tool slugs", () => {
    const result = previewBackgroundAgentSpec(
      validCreateInput({
        composioToolkitSlugs: ["github", "slack", "linear"],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).toContain("github, slack, linear");
    }
  });

  test("summary includes description when present", () => {
    const result = previewBackgroundAgentSpec(
      validCreateInput({ description: "A PR review bot" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).toContain("**Description:** A PR review bot");
    }
  });

  test("truncates long instructions in summary", () => {
    const longInstructions = "x".repeat(300);
    const result = previewBackgroundAgentSpec(
      validCreateInput({ instructions: longInstructions }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).toContain("...");
      // Should be 200 chars + "..."
      const instrLine = result.summary
        .split("\n")
        .find((l) => l.startsWith("**Instructions:**"));
      expect(instrLine).toBeDefined();
      // The summary part after "**Instructions:** " should be at most 203 chars
      // (200 chars + "...")
      const instrText = instrLine!.replace("**Instructions:** ", "");
      expect(instrText.length).toBeLessThanOrEqual(205);
    }
  });

  test("returns warning for ready_pr without write permission", () => {
    const result = previewBackgroundAgentSpec(
      validCreateInput({
        outputMode: "ready_pr",
        permissions: { github: { contents: "read", pullRequests: "read" } },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0]).toContain("write");
    }
  });

  test("returns no warning for ready_pr with write permission", () => {
    const result = previewBackgroundAgentSpec(
      validCreateInput({
        outputMode: "ready_pr",
        permissions: { github: { contents: "write", pullRequests: "write" } },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toEqual([]);
    }
  });

  test("returns no warning for none outputMode regardless of permissions", () => {
    const result = previewBackgroundAgentSpec(
      validCreateInput({
        outputMode: "none",
        permissions: { github: { contents: "read", pullRequests: "read" } },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toEqual([]);
    }
  });
});

// ── previewBackgroundAgentSpec — validation failures ─────────────────────

describe("previewBackgroundAgentSpec — validation failures", () => {
  test("returns ok:false when create draft fails validation", () => {
    const input: PreviewBackgroundAgentSpecInput = {
      mode: "create",
      draft: {
        name: "",
        repoOwner: "acme",
        repoName: "widgets",
        instructions: "",
        triggers: [],
      } as never,
    };
    const result = previewBackgroundAgentSpec(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.mode).toBe("create");
      expect(result.errorKind).toBe("validation_failed");
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.message).toBe(
        "The background agent draft has validation errors.",
      );
    }
  });

  test("returns ok:false when update draft fails validation", () => {
    const input: PreviewBackgroundAgentSpecInput = {
      mode: "update",
      agentId: "agent_abc123",
      draft: {
        name: "", // empty name should fail
      } as never,
    };
    const result = previewBackgroundAgentSpec(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.mode).toBe("update");
      expect(result.errorKind).toBe("validation_failed");
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });

  test("issues contain path and message for each validation error", () => {
    const input: PreviewBackgroundAgentSpecInput = {
      mode: "create",
      draft: {
        name: "",
        repoOwner: "",
        repoName: "",
        instructions: "",
        triggers: [],
      } as never,
    };
    const result = previewBackgroundAgentSpec(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      for (const issue of result.issues) {
        expect(typeof issue.path).toBe("string");
        expect(typeof issue.message).toBe("string");
      }
    }
  });

  test("rejects schedule.cron trigger with invalid schedule", () => {
    const input: PreviewBackgroundAgentSpecInput = {
      mode: "create",
      draft: {
        name: "Bad Schedule",
        repoOwner: "acme",
        repoName: "widgets",
        instructions: "Test.",
        outputMode: "none",
        triggers: [
          {
            name: "Bad schedule trigger",
            kind: "schedule.cron",
            status: "enabled" as const,
            conditions: {},
            schedule: "not-a-cron-expression",
          },
        ],
      },
    };
    const result = previewBackgroundAgentSpec(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The schedule validation should surface via the Zod superRefine
      const scheduleIssues = result.issues.filter((i) =>
        i.path.includes("schedule"),
      );
      expect(scheduleIssues.length).toBeGreaterThan(0);
    }
  });

  test("rejects empty triggers array in create mode", () => {
    const input: PreviewBackgroundAgentSpecInput = {
      mode: "create",
      draft: {
        name: "No Triggers",
        repoOwner: "acme",
        repoName: "widgets",
        instructions: "Test.",
        outputMode: "none" as const,
        status: "disabled" as const,
        permissions: {},
        composioToolkitSlugs: [],
        triggers: [],
      },
    };
    const result = previewBackgroundAgentSpec(input);
    expect(result.ok).toBe(false);
  });
});

// ── mapAgentTriggerKind ──────────────────────────────────────────────────

describe("mapAgentTriggerKind", () => {
  test("maps schedule → schedule.cron", () => {
    expect(mapAgentTriggerKind("schedule")).toBe("schedule.cron");
  });

  test("maps pull_request.opened → github.pull_request", () => {
    expect(mapAgentTriggerKind("pull_request.opened")).toBe(
      "github.pull_request",
    );
  });

  test("maps pull_request.synchronize → github.pull_request", () => {
    expect(mapAgentTriggerKind("pull_request.synchronize")).toBe(
      "github.pull_request",
    );
  });

  test("maps issues.opened → github.issue", () => {
    expect(mapAgentTriggerKind("issues.opened")).toBe("github.issue");
  });

  test("maps push → github.pull_request", () => {
    expect(mapAgentTriggerKind("push")).toBe("github.pull_request");
  });

  test("maps webhook → webhook.error", () => {
    expect(mapAgentTriggerKind("webhook")).toBe("webhook.error");
  });

  test("returns null for unknown trigger kind", () => {
    expect(mapAgentTriggerKind("unknown_kind")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(mapAgentTriggerKind("")).toBeNull();
  });
});

// ── normalizeAgentTriggerConditions ──────────────────────────────────────

describe("normalizeAgentTriggerConditions", () => {
  test("returns empty object for empty conditions array", () => {
    const result = normalizeAgentTriggerConditions("pull_request.opened", []);
    expect(result).toEqual({});
  });

  test("pull_request.opened adds 'opened' action and appends extras", () => {
    const result = normalizeAgentTriggerConditions("pull_request.opened", [
      "labeled",
    ]);
    expect(result.actions).toEqual(["opened", "labeled"]);
  });

  test("pull_request.opened does not duplicate 'opened'", () => {
    const result = normalizeAgentTriggerConditions("pull_request.opened", [
      "opened",
      "reopened",
    ]);
    // The constructor adds "opened" first, then appends non-"opened" items
    expect(result.actions).toContain("opened");
    expect(result.actions).toContain("reopened");
    // opened should appear exactly once
    expect(result.actions?.filter((a) => a === "opened").length).toBe(1);
  });

  test("pull_request.synchronize adds 'synchronize' action", () => {
    const result = normalizeAgentTriggerConditions("pull_request.synchronize", [
      "labeled",
      "unlabeled",
    ]);
    expect(result.actions).toEqual(["synchronize", "labeled", "unlabeled"]);
  });

  test("issues.opened adds 'opened' action", () => {
    const result = normalizeAgentTriggerConditions("issues.opened", ["bug"]);
    expect(result.actions).toEqual(["opened", "bug"]);
  });

  test("push maps conditions to actions", () => {
    const result = normalizeAgentTriggerConditions("push", ["main"]);
    expect(result.actions).toEqual(["main"]);
  });

  test("webhook maps conditions to severities", () => {
    const result = normalizeAgentTriggerConditions("webhook", ["critical"]);
    expect(result.severities).toEqual(["critical"]);
  });

  test("schedule returns empty conditions", () => {
    const result = normalizeAgentTriggerConditions("schedule", ["irrelevant"]);
    expect(result).toEqual({});
  });

  test("unknown kind defaults to actions", () => {
    const result = normalizeAgentTriggerConditions("unknown_kind", ["test"]);
    expect(result.actions).toEqual(["test"]);
  });
});

// ── normalizeAgentPermissions ────────────────────────────────────────────

describe("normalizeAgentPermissions", () => {
  test("converts pull_requests → pullRequests", () => {
    const result = normalizeAgentPermissions({
      github: {
        contents: "write",
        pull_requests: "write",
        issues: "read",
      },
    });
    expect(result).toEqual({
      github: {
        contents: "write",
        pullRequests: "write",
        issues: "read",
      },
    });
  });

  test("passes through already-camelCase keys", () => {
    const result = normalizeAgentPermissions({
      github: {
        contents: "read",
        pullRequests: "write",
        deployments: "read",
      },
    });
    expect(result).toEqual({
      github: {
        contents: "read",
        pullRequests: "write",
        deployments: "read",
      },
    });
  });

  test("returns undefined for null input", () => {
    expect(normalizeAgentPermissions(null)).toBeUndefined();
  });

  test("returns undefined for undefined input", () => {
    expect(normalizeAgentPermissions(undefined)).toBeUndefined();
  });

  test("returns undefined for non-object input", () => {
    expect(normalizeAgentPermissions("invalid")).toBeUndefined();
  });

  test("returns empty object if no github key", () => {
    // When permissions doesn't have a github key, returns undefined
    const result = normalizeAgentPermissions({ other: "value" });
    expect(result?.github).toBeUndefined();
  });
});

// ── normalizeAgentDraft ──────────────────────────────────────────────────

describe("normalizeAgentDraft", () => {
  test("normalizes trigger kinds from agent to web format", () => {
    const draft = {
      name: "PR Bot",
      repoOwner: "acme",
      repoName: "widgets",
      instructions: "Review PRs.",
      outputMode: "ready_pr",
      triggers: [
        {
          name: "PR opened",
          kind: "pull_request.opened",
          conditions: ["labeled"],
        },
        {
          name: "Weekly",
          kind: "schedule",
          schedule: "@daily",
          conditions: [],
        },
        {
          name: "Issues",
          kind: "issues.opened",
          conditions: [],
        },
      ],
      permissions: {
        github: {
          contents: "write",
          pull_requests: "write",
        },
      },
    };

    const result = normalizeAgentDraft(draft);
    expect(result.name).toBe("PR Bot");

    const triggers = result.triggers as Array<Record<string, unknown>>;
    expect(triggers[0]?.kind).toBe("github.pull_request");
    expect(triggers[1]?.kind).toBe("schedule.cron");
    expect(triggers[2]?.kind).toBe("github.issue");
  });

  test("normalizes permissions snake_case keys", () => {
    const draft = {
      name: "PR Bot",
      repoOwner: "acme",
      repoName: "widgets",
      instructions: "Review PRs.",
      triggers: [{ name: "PR", kind: "pull_request.opened", conditions: [] }],
      permissions: {
        github: {
          contents: "read",
          pull_requests: "write",
        },
      },
    };

    const result = normalizeAgentDraft(draft);
    const perms = result.permissions as Record<string, unknown>;
    const githubPerms = perms.github as Record<string, unknown>;
    expect(githubPerms.pullRequests).toBe("write");
    expect(githubPerms.pull_requests).toBeUndefined();
  });

  test("leaves already-normalized data unchanged", () => {
    const draft = {
      name: "PR Bot",
      repoOwner: "acme",
      repoName: "widgets",
      instructions: "Review PRs.",
      triggers: [
        {
          name: "PR opened",
          kind: "github.pull_request",
          conditions: { actions: ["opened"] },
        },
      ],
      permissions: {
        github: {
          contents: "read",
          pullRequests: "write",
        },
      },
    };

    const result = normalizeAgentDraft(draft);
    expect(result).toEqual(draft);
  });

  test("preserves non-trigger, non-permissions fields", () => {
    const draft = {
      name: "PR Bot",
      description: "A bot for PRs",
      repoOwner: "acme",
      repoName: "widgets",
      instructions: "Review PRs.",
      outputMode: "none",
      checkCommand: "bun test",
      composioToolkitSlugs: ["github"],
      triggers: [{ name: "PR", kind: "pull_request.opened", conditions: [] }],
    };

    const result = normalizeAgentDraft(draft);
    expect(result.name).toBe("PR Bot");
    expect(result.description).toBe("A bot for PRs");
    expect(result.repoOwner).toBe("acme");
    expect(result.repoName).toBe("widgets");
    expect(result.instructions).toBe("Review PRs.");
    expect(result.outputMode).toBe("none");
    expect(result.checkCommand).toBe("bun test");
    expect(result.composioToolkitSlugs).toEqual(["github"]);
  });

  test("handles draft with no permissions", () => {
    const draft = {
      name: "PR Bot",
      repoOwner: "acme",
      repoName: "widgets",
      instructions: "Review PRs.",
      triggers: [{ name: "PR", kind: "pull_request.opened", conditions: [] }],
    };

    const result = normalizeAgentDraft(draft);
    expect(result.name).toBe("PR Bot");
  });

  test("normalized draft can be validated by createBackgroundAgentSchema", () => {
    const agentToolDraft = {
      name: "PR Reviewer",
      repoOwner: "acme",
      repoName: "widgets",
      instructions: "Review new pull requests and add a summary comment.",
      outputMode: "ready_pr",
      description: "An automated PR reviewer",
      triggers: [
        {
          name: "PR opened",
          kind: "pull_request.opened",
          conditions: ["labeled"],
        },
        {
          name: "Weekly schedule",
          kind: "schedule",
          schedule: "0 9 * * 1",
          conditions: [],
        },
      ],
      permissions: {
        github: {
          contents: "write",
          pull_requests: "write",
          issues: "read",
        },
      },
    };

    const normalized = normalizeAgentDraft(agentToolDraft);
    const parsed = createBackgroundAgentSchema.safeParse(normalized);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const data = parsed.data;
      expect(data.name).toBe("PR Reviewer");
      expect(data.triggers[0]?.kind).toBe("github.pull_request");
      expect(data.triggers[0]?.conditions.actions).toContain("opened");
      expect(data.triggers[0]?.conditions.actions).toContain("labeled");
      expect(data.triggers[1]?.kind).toBe("schedule.cron");
      expect(data.triggers[1]?.schedule).toBe("0 9 * * 1");
      expect(data.permissions.github?.pullRequests).toBe("write");
    }
  });

  test("normalized agent draft with unknown trigger kind is still validated (kind stays as-is, fails Zod)", () => {
    const agentToolDraft = {
      name: "Bad Trigger",
      repoOwner: "acme",
      repoName: "widgets",
      instructions: "Test.",
      triggers: [
        {
          name: "Unknown trigger",
          kind: "unknown_kind",
          conditions: [],
        },
      ],
    };

    const normalized = normalizeAgentDraft(agentToolDraft);
    // The unknown kind stays as-is (mapAgentTriggerKind returns null)
    // Zod validation should reject it
    const parsed = createBackgroundAgentSchema.safeParse(normalized);
    expect(parsed.success).toBe(false);
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────

describe("previewBackgroundAgentSpec — edge cases", () => {
  test("handles create draft with description as null", () => {
    const result = previewBackgroundAgentSpec(
      validCreateInput({ description: null }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // null description should not appear in summary
      expect(result.summary).not.toContain("**Description:**");
    }
  });

  test("handles create draft with checkCommand as null", () => {
    const result = previewBackgroundAgentSpec(
      validCreateInput({ checkCommand: null }),
    );
    expect(result.ok).toBe(true);
  });

  test("trigger summary with 0 triggers (update without triggers field)", () => {
    const result = previewBackgroundAgentSpec(validUpdateInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.triggerSummary).toBe("(no trigger changes)");
    }
  });

  test("trigger summary with no triggers array", () => {
    const result = previewBackgroundAgentSpec(
      validUpdateInput({ triggers: undefined }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.triggerSummary).toBe("(no trigger changes)");
    }
  });

  test("summary does not include tools section when composioToolkitSlugs is empty", () => {
    const result = previewBackgroundAgentSpec(
      validCreateInput({ composioToolkitSlugs: [] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).not.toContain("**Tools:**");
    }
  });

  test("update draft with only triggers changed", () => {
    const input: PreviewBackgroundAgentSpecInput = {
      mode: "update",
      agentId: "agent_abc123",
      draft: {
        triggers: [
          {
            name: "New trigger",
            kind: "github.issue" as const,
            status: "enabled" as const,
            conditions: { actions: ["opened"] },
          },
        ],
      },
    };
    const result = previewBackgroundAgentSpec(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.triggerSummary).toContain("New trigger");
      expect(result.triggerSummary).toContain("Issue");
    }
  });
});
