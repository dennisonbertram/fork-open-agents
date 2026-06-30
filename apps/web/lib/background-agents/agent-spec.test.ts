/**
 * Tests for shared agent spec logic (payload builder, types, helpers).
 * These tests drive the extraction of background-agents-form.ts into a
 * shared colocated module so the repo-dashboard creation flow can reuse it.
 */
import { describe, expect, test } from "bun:test";
import {
  buildAgentPayload,
  buildFormFromAgent,
  buildRepoScopedDefaultForm,
  buildTriggerDraftsPayload,
  conditionFieldLabel,
  createTriggerDraft,
  deriveAgentName,
  describeOutputModePermissions,
  fieldsForTrigger,
  isStepValid,
  outputModeLabel,
  type ConditionField,
  type BackgroundAgent,
  type FormState,
  type StepId,
  type TriggerDraft,
} from "./agent-spec";

describe("buildRepoScopedDefaultForm", () => {
  test("BT-001: creates a form pre-filled with the given repo owner and name", () => {
    const form = buildRepoScopedDefaultForm("acme", "widgets");

    expect(form.repoOwner).toBe("acme");
    expect(form.repoName).toBe("widgets");
  });

  test("BT-002: default form has enabled=false (created disabled by default)", () => {
    const form = buildRepoScopedDefaultForm("acme", "widgets");

    expect(form.enabled).toBe(false);
  });

  test("BT-003: default output mode is none (safest/draft autonomy)", () => {
    const form = buildRepoScopedDefaultForm("acme", "widgets");

    expect(form.outputMode).toBe("none");
  });
});

describe("buildAgentPayload", () => {
  function makeForm(overrides: Partial<FormState> = {}): FormState {
    return {
      name: "Test Agent",
      repoOwner: "acme",
      repoName: "widgets",
      triggerKind: "github.pull_request",
      schedule: "",
      conditionActions: "",
      conditionBranches: "",
      conditionLabels: "",
      conditionEnvironments: "",
      conditionSeverities: "",
      instructions: "Run smoke checks.",
      outputMode: "none",
      checkCommand: "",
      enabled: false,
      permissionContents: "read",
      permissionPullRequests: "read",
      composioToolkitSlugs: [],
      ...overrides,
    };
  }

  test("BT-004: payload is repo-scoped to the form owner/name", () => {
    const payload = buildAgentPayload(
      makeForm({ repoOwner: "acme", repoName: "widgets" }),
    );

    expect(payload.repoOwner).toBe("acme");
    expect(payload.repoName).toBe("widgets");
  });

  test("BT-005: payload status is disabled when form.enabled=false", () => {
    const payload = buildAgentPayload(makeForm({ enabled: false }));

    expect(payload.status).toBe("disabled");
  });

  test("BT-006: payload status is enabled when form.enabled=true", () => {
    const payload = buildAgentPayload(makeForm({ enabled: true }));

    expect(payload.status).toBe("enabled");
  });

  test("BT-007: payload does NOT include an autoMerge field (no auto-merge in v1)", () => {
    const payload = buildAgentPayload(makeForm({ enabled: true }));

    expect(payload).not.toHaveProperty("autoMerge");
    expect(JSON.stringify(payload)).not.toContain("autoMerge");
    expect(JSON.stringify(payload)).not.toContain("auto_merge");
  });

  test("BT-008: ready_pr output with write permissions in form sets github write permissions on contents and pullRequests", () => {
    const payload = buildAgentPayload(
      makeForm({
        outputMode: "ready_pr",
        permissionContents: "write",
        permissionPullRequests: "write",
      }),
    );

    expect(payload.permissions.github.contents).toBe("write");
    expect(payload.permissions.github.pullRequests).toBe("write");
  });

  test("BT-009: none output mode with read permissions in form keeps contents and pullRequests as read", () => {
    const payload = buildAgentPayload(
      makeForm({
        outputMode: "none",
        permissionContents: "read",
        permissionPullRequests: "read",
      }),
    );

    expect(payload.permissions.github.contents).toBe("read");
    expect(payload.permissions.github.pullRequests).toBe("read");
  });

  test("BT-E1: ready_pr floors GitHub access to write regardless of form fields (Ready PR is non-functional without write)", () => {
    const payload = buildAgentPayload(
      makeForm({
        outputMode: "ready_pr",
        permissionContents: "read",
        permissionPullRequests: "read",
      }),
    );

    expect(payload.permissions.github.contents).toBe("write");
    expect(payload.permissions.github.pullRequests).toBe("write");
  });

  test("BT-E2: permissionPullRequests write with outputMode none => payload pullRequests is write", () => {
    const payload = buildAgentPayload(
      makeForm({
        outputMode: "none",
        permissionContents: "read",
        permissionPullRequests: "write",
      }),
    );

    expect(payload.permissions.github.contents).toBe("read");
    expect(payload.permissions.github.pullRequests).toBe("write");
  });

  test("BT-010: schedule trigger sets schedule field; non-schedule trigger omits it", () => {
    const schedulePayload = buildAgentPayload(
      makeForm({ triggerKind: "schedule.cron", schedule: "@hourly" }),
    );
    expect(schedulePayload.triggers[0]?.schedule).toBe("@hourly");

    const prPayload = buildAgentPayload(
      makeForm({ triggerKind: "github.pull_request" }),
    );
    expect(prPayload.triggers[0]?.schedule).toBeNull();
  });
});

describe("buildFormFromAgent", () => {
  function makeAgent(
    overrides: Partial<BackgroundAgent> = {},
  ): BackgroundAgent {
    return {
      id: "agent-1",
      name: "PR reporter",
      description: null,
      status: "disabled",
      repoOwner: "acme",
      repoName: "widgets",
      instructions: "Summarize pull requests.",
      outputMode: "none",
      checkCommand: null,
      permissions: {
        github: {
          contents: "read",
          pullRequests: "read",
          issues: "read",
          deployments: "read",
          statuses: "read",
          checks: "read",
        },
      },
      composioToolkitSlugs: [],
      triggers: [
        {
          id: "trigger-1",
          name: "A pull request changes",
          kind: "github.pull_request",
          status: "enabled",
          conditions: { actions: ["opened"] },
          schedule: null,
          webhookPublicId: null,
        },
      ],
      ...overrides,
    };
  }

  test("REG-019: saved GitHub permissions round-trip through edit even when outputMode was ready_pr", () => {
    const form = buildFormFromAgent(
      makeAgent({
        outputMode: "ready_pr",
        permissions: {
          github: {
            contents: "read",
            pullRequests: "read",
            issues: "read",
            deployments: "read",
            statuses: "read",
            checks: "read",
          },
        },
      }),
    );

    expect(form.outputMode).toBe("ready_pr");
    expect(form.permissionContents).toBe("read");
    expect(form.permissionPullRequests).toBe("read");
  });
});

// ---------------------------------------------------------------------------
// Slice 1 — isStepValid
// ---------------------------------------------------------------------------

describe("isStepValid", () => {
  function makeForm(overrides: Partial<FormState> = {}): FormState {
    return {
      name: "Test Agent",
      repoOwner: "acme",
      repoName: "widgets",
      triggerKind: "github.pull_request",
      schedule: "",
      conditionActions: "",
      conditionBranches: "",
      conditionLabels: "",
      conditionEnvironments: "",
      conditionSeverities: "",
      instructions: "Do something.",
      outputMode: "none",
      checkCommand: "",
      enabled: false,
      permissionContents: "read",
      permissionPullRequests: "read",
      composioToolkitSlugs: [],
      ...overrides,
    };
  }

  test("BT-011: trigger step invalid when name is empty", () => {
    const step: StepId = "trigger";
    expect(isStepValid(makeForm({ name: "" }), step)).toBe(false);
  });

  test("BT-012: trigger step invalid when repoOwner is empty", () => {
    const step: StepId = "trigger";
    expect(isStepValid(makeForm({ repoOwner: "" }), step)).toBe(false);
  });

  test("BT-013: trigger step valid when name, repoOwner, and repoName are all present", () => {
    const step: StepId = "trigger";
    expect(isStepValid(makeForm(), step)).toBe(true);
  });

  test("BT-014: conditions step invalid for schedule.cron with empty schedule", () => {
    const step: StepId = "conditions";
    expect(
      isStepValid(
        makeForm({ triggerKind: "schedule.cron", schedule: "" }),
        step,
      ),
    ).toBe(false);
  });

  test("BT-015: conditions step invalid for schedule.cron with malformed cron '* * *'", () => {
    const step: StepId = "conditions";
    expect(
      isStepValid(
        makeForm({ triggerKind: "schedule.cron", schedule: "* * *" }),
        step,
      ),
    ).toBe(false);
  });

  test("BT-016: conditions step valid for schedule.cron with @hourly", () => {
    const step: StepId = "conditions";
    expect(
      isStepValid(
        makeForm({ triggerKind: "schedule.cron", schedule: "@hourly" }),
        step,
      ),
    ).toBe(true);
  });

  test("BT-017: conditions step always valid for non-cron triggers", () => {
    const step: StepId = "conditions";
    expect(
      isStepValid(makeForm({ triggerKind: "github.pull_request" }), step),
    ).toBe(true);
    expect(isStepValid(makeForm({ triggerKind: "github.issue" }), step)).toBe(
      true,
    );
    expect(
      isStepValid(makeForm({ triggerKind: "github.deployment_status" }), step),
    ).toBe(true);
    expect(isStepValid(makeForm({ triggerKind: "webhook.error" }), step)).toBe(
      true,
    );
  });

  test("BT-018: instructions step invalid when instructions is empty", () => {
    const step: StepId = "instructions";
    expect(isStepValid(makeForm({ instructions: "" }), step)).toBe(false);
  });

  test("BT-019: test step invalid when a required upstream step is invalid", () => {
    const step: StepId = "test";
    // Missing name makes trigger step fail, so test step fails
    expect(isStepValid(makeForm({ name: "" }), step)).toBe(false);
    // Missing instructions makes instructions step fail, so test step fails
    expect(isStepValid(makeForm({ instructions: "" }), step)).toBe(false);
  });

  test("BT-020: test step valid when all required fields are present", () => {
    const step: StepId = "test";
    expect(isStepValid(makeForm(), step)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Slice 2 — fieldsForTrigger
// ---------------------------------------------------------------------------

describe("fieldsForTrigger", () => {
  test("BT-021: pull_request trigger includes actions, branches, labels; excludes environments, statuses", () => {
    const fields = fieldsForTrigger("github.pull_request");
    const fieldArr = [...fields] as ConditionField[];
    expect(fields.has("actions")).toBe(true);
    expect(fields.has("branches")).toBe(true);
    expect(fields.has("labels")).toBe(true);
    expect(fields.has("environments")).toBe(false);
    expect(fields.has("statuses")).toBe(false);
    expect(fieldArr.length).toBe(3);
  });

  test("BT-022: issue trigger includes actions and labels; excludes branches, environments, statuses", () => {
    const fields = fieldsForTrigger("github.issue");
    expect(fields.has("actions")).toBe(true);
    expect(fields.has("labels")).toBe(true);
    expect(fields.has("branches")).toBe(false);
    expect(fields.has("environments")).toBe(false);
    expect(fields.has("statuses")).toBe(false);
  });

  test("BT-023: deployment_status trigger includes environments and statuses; excludes actions, branches, labels", () => {
    const fields = fieldsForTrigger("github.deployment_status");
    expect(fields.has("environments")).toBe(true);
    expect(fields.has("statuses")).toBe(true);
    expect(fields.has("actions")).toBe(false);
    expect(fields.has("branches")).toBe(false);
    expect(fields.has("labels")).toBe(false);
  });

  test("BT-024: schedule.cron trigger returns empty set (no condition fields)", () => {
    const fields = fieldsForTrigger("schedule.cron");
    expect(fields.size).toBe(0);
  });

  test("BT-025: webhook.error trigger includes statuses (severity); excludes actions, branches, labels, environments", () => {
    const fields = fieldsForTrigger("webhook.error");
    expect(fields.has("statuses")).toBe(true);
    expect(fields.has("actions")).toBe(false);
    expect(fields.has("branches")).toBe(false);
    expect(fields.has("labels")).toBe(false);
    expect(fields.has("environments")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Slice 3 — conditionFieldLabel
// ---------------------------------------------------------------------------

describe("conditionFieldLabel", () => {
  test("BT-026: statuses + deployment_status -> 'Deployment state'", () => {
    expect(conditionFieldLabel("statuses", "github.deployment_status")).toBe(
      "Deployment state",
    );
  });

  test("BT-027: statuses + webhook.error -> 'Severity'", () => {
    expect(conditionFieldLabel("statuses", "webhook.error")).toBe("Severity");
  });

  test("BT-028: actions + pull_request -> 'Actions'", () => {
    expect(conditionFieldLabel("actions", "github.pull_request")).toBe(
      "Actions",
    );
  });

  test("BT-029: branches + pull_request -> 'Branches'", () => {
    expect(conditionFieldLabel("branches", "github.pull_request")).toBe(
      "Branches",
    );
  });

  test("BT-030: labels + issue -> 'Labels'", () => {
    expect(conditionFieldLabel("labels", "github.issue")).toBe("Labels");
  });

  test("BT-031: environments + deployment_status -> 'Environments'", () => {
    expect(
      conditionFieldLabel("environments", "github.deployment_status"),
    ).toBe("Environments");
  });
});

// ---------------------------------------------------------------------------
// Slice 4 — describeOutputModePermissions
// ---------------------------------------------------------------------------

describe("describeOutputModePermissions", () => {
  test("BT-032: none mode returns read-only description", () => {
    const desc = describeOutputModePermissions("none");
    expect(desc.toLowerCase()).toContain("read-only");
  });

  test("BT-033: ready_pr mode description mentions pull request", () => {
    const desc = describeOutputModePermissions("ready_pr");
    expect(desc.toLowerCase()).toContain("pull request");
  });

  test("BT-034: none mode description does NOT mention write", () => {
    const desc = describeOutputModePermissions("none");
    expect(desc.toLowerCase()).not.toContain("write");
  });

  test("BT-035: ready_pr mode description mentions open or write (can create PRs)", () => {
    const desc = describeOutputModePermissions("ready_pr");
    const lower = desc.toLowerCase();
    expect(lower.includes("open") || lower.includes("write")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Slice 5 — outputModeLabel
// ---------------------------------------------------------------------------

describe("outputModeLabel", () => {
  test("BT-036: none -> 'None'", () => {
    expect(outputModeLabel("none")).toBe("None");
  });

  test("BT-037: ready_pr -> 'Ready PR'", () => {
    expect(outputModeLabel("ready_pr")).toBe("Ready PR");
  });

  test("BT-038: comment returns a non-empty string (future-safe)", () => {
    expect(outputModeLabel("comment").length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Regression tests — catch future breakage from different angles
// ---------------------------------------------------------------------------

describe("REG: fieldsForTrigger — dead fields are fully absent", () => {
  test("REG-010: deployment_status has exactly 2 fields (environments + statuses); no more", () => {
    const fields = fieldsForTrigger("github.deployment_status");
    // If someone accidentally adds actions/branches/labels back, this catches it
    expect(fields.size).toBe(2);
    expect(fields.has("environments")).toBe(true);
    expect(fields.has("statuses")).toBe(true);
  });

  test("REG-011: schedule.cron still returns empty set even if trigger map is extended", () => {
    // Cron has no event-driven condition fields ever — if this changes, the
    // UI would show nonsense condition inputs on a time-based trigger
    const fields = fieldsForTrigger("schedule.cron");
    expect(fields.size).toBe(0);
  });

  test("REG-012: pull_request has exactly 3 fields; environments/statuses never leak in", () => {
    const fields = fieldsForTrigger("github.pull_request");
    expect(fields.size).toBe(3);
    expect(fields.has("environments")).toBe(false);
    expect(fields.has("statuses")).toBe(false);
  });
});

describe("REG: conditionFieldLabel — deployment_status label never regresses to 'Severities'", () => {
  test("REG-013: deployment_status statuses field must not be 'Severities' (old mislabel)", () => {
    const label = conditionFieldLabel("statuses", "github.deployment_status");
    expect(label).not.toBe("Severities");
    expect(label).toBe("Deployment state");
  });

  test("REG-014: webhook.error statuses field must not be 'Statuses' (wrong context)", () => {
    const label = conditionFieldLabel("statuses", "webhook.error");
    expect(label).not.toBe("Statuses");
    expect(label).toBe("Severity");
  });
});

describe("REG: isStepValid — canSubmit uses isStepValid(form, 'test'); cron with no schedule is blocked", () => {
  function makeForm(overrides: Partial<FormState> = {}): FormState {
    return {
      name: "Nightly",
      repoOwner: "acme",
      repoName: "widgets",
      triggerKind: "schedule.cron",
      schedule: "",
      conditionActions: "",
      conditionBranches: "",
      conditionLabels: "",
      conditionEnvironments: "",
      conditionSeverities: "",
      instructions: "Run nightly checks.",
      outputMode: "none",
      checkCommand: "",
      enabled: false,
      permissionContents: "read",
      permissionPullRequests: "read",
      composioToolkitSlugs: [],
      ...overrides,
    };
  }

  test("REG-015: schedule.cron agent with empty schedule is blocked at test step", () => {
    // This catches the regression where canSubmit didn't gate on schedule validity
    expect(isStepValid(makeForm({ schedule: "" }), "test")).toBe(false);
  });

  test("REG-016: schedule.cron with valid schedule passes test step if all other fields present", () => {
    expect(isStepValid(makeForm({ schedule: "@daily" }), "test")).toBe(true);
  });

  test("REG-017: whitespace-only instructions blocks test step", () => {
    const form = makeForm({ schedule: "@hourly", instructions: "   " });
    // instructions.trim().length === 0 → instructions step fails → test step fails
    expect(isStepValid(form, "test")).toBe(false);
  });
});

describe("REG: describeOutputModePermissions — both modes produce distinct summaries", () => {
  test("REG-018: none and ready_pr summaries are different strings", () => {
    const noneDesc = describeOutputModePermissions("none");
    const prDesc = describeOutputModePermissions("ready_pr");
    // If someone accidentally returns the same string for both, this catches it
    expect(noneDesc).not.toBe(prDesc);
  });
});

// ---------------------------------------------------------------------------
// Phase 1 — TriggerDraft + createTriggerDraft + buildTriggerDraftsPayload
// ---------------------------------------------------------------------------

describe("createTriggerDraft", () => {
  test("P1-001: creates a draft with the given id and default kind", () => {
    const draft: TriggerDraft = createTriggerDraft("t-1");
    expect(draft.id).toBe("t-1");
    expect(draft.triggerKind).toBe("github.pull_request");
    expect(draft.schedule).toBe("");
    expect(draft.conditionActions).toBe("");
  });

  test("P1-002: respects an explicit kind arg", () => {
    const draft = createTriggerDraft("t-2", "schedule.cron");
    expect(draft.triggerKind).toBe("schedule.cron");
  });

  test("P1-003: id is deterministic (no Math.random)", () => {
    const a = createTriggerDraft("same-id");
    const b = createTriggerDraft("same-id");
    expect(a.id).toBe(b.id);
  });
});

describe("buildTriggerDraftsPayload", () => {
  test("P1-004: returns one payload trigger per draft", () => {
    const drafts: TriggerDraft[] = [
      createTriggerDraft("t-1", "github.pull_request"),
      createTriggerDraft("t-2", "github.issue"),
    ];
    const result = buildTriggerDraftsPayload(drafts);
    expect(result).toHaveLength(2);
    expect(result[0]?.kind).toBe("github.pull_request");
    expect(result[1]?.kind).toBe("github.issue");
  });

  test("P1-005: cron draft sets schedule field; non-cron draft sets null", () => {
    const cronDraft = {
      ...createTriggerDraft("t-cron", "schedule.cron"),
      schedule: "@hourly",
    };
    const prDraft = createTriggerDraft("t-pr", "github.pull_request");
    const result = buildTriggerDraftsPayload([cronDraft, prDraft]);
    expect(result[0]?.schedule).toBe("@hourly");
    expect(result[1]?.schedule).toBeNull();
  });

  test("P1-006: deployment_status draft routes conditionSeverities into conditions.actions", () => {
    const draft: TriggerDraft = {
      ...createTriggerDraft("t-ds", "github.deployment_status"),
      conditionSeverities: "success, failure",
      conditionEnvironments: "production",
    };
    const result = buildTriggerDraftsPayload([draft]);
    expect(result[0]?.conditions?.actions).toEqual(["success", "failure"]);
    expect(result[0]?.conditions?.environments).toEqual(["production"]);
  });
});

describe("buildAgentPayload — triggers array path", () => {
  function makeForm(overrides: Partial<FormState> = {}): FormState {
    return {
      name: "Test Agent",
      repoOwner: "acme",
      repoName: "widgets",
      triggerKind: "github.pull_request",
      schedule: "",
      conditionActions: "",
      conditionBranches: "",
      conditionLabels: "",
      conditionEnvironments: "",
      conditionSeverities: "",
      instructions: "Do something.",
      outputMode: "none",
      checkCommand: "",
      enabled: false,
      permissionContents: "read",
      permissionPullRequests: "read",
      composioToolkitSlugs: [],
      ...overrides,
    };
  }

  test("P1-007: with 2 drafts in form.triggers emits 2 triggers with correct kinds", () => {
    const drafts: TriggerDraft[] = [
      createTriggerDraft("t-1", "github.pull_request"),
      createTriggerDraft("t-2", "schedule.cron"),
    ];
    const payload = buildAgentPayload(makeForm({ triggers: drafts }));
    expect(payload.triggers).toHaveLength(2);
    expect(payload.triggers[0]?.kind).toBe("github.pull_request");
    expect(payload.triggers[1]?.kind).toBe("schedule.cron");
  });

  test("P1-008: scalar back-compat — no triggers in form still emits exactly one trigger", () => {
    const payload = buildAgentPayload(makeForm());
    expect(payload.triggers).toHaveLength(1);
    expect(payload.triggers[0]?.kind).toBe("github.pull_request");
  });

  test("P1-009: empty triggers array in form falls back to scalar path (one trigger)", () => {
    const payload = buildAgentPayload(makeForm({ triggers: [] }));
    expect(payload.triggers).toHaveLength(1);
  });

  test("P1-010: deployment_status draft condition routing via triggers array", () => {
    const draft: TriggerDraft = {
      ...createTriggerDraft("t-ds", "github.deployment_status"),
      conditionSeverities: "failure",
    };
    const payload = buildAgentPayload(makeForm({ triggers: [draft] }));
    expect(payload.triggers[0]?.conditions?.actions).toEqual(["failure"]);
  });
});

// ---------------------------------------------------------------------------
// Phase 2A — describeAgentOutput
// ---------------------------------------------------------------------------

describe("describeAgentOutput", () => {
  // Lazily import so this test file compiles even before the export exists
  async function getHelper() {
    const mod = await import("./agent-spec");
    // @ts-expect-error — function added in Phase 2; absent until GREEN
    return mod.describeAgentOutput as (args: {
      outputMode: import("./agent-spec").OutputMode;
      githubAccess: "read" | "write";
    }) => { will: string; wont: string };
  }

  test("P2A-001: report-only + read → will mentions summary, wont mentions NOT", async () => {
    const describeAgentOutput = await getHelper();
    const result = describeAgentOutput({ outputMode: "none", githubAccess: "read" });
    expect(result.will.toLowerCase()).toMatch(/summar|written|report/);
    expect(result.wont).toContain("NOT");
  });

  test("P2A-002: ready_pr + write → will mentions pull request, wont mentions NOT merge", async () => {
    const describeAgentOutput = await getHelper();
    const result = describeAgentOutput({ outputMode: "ready_pr", githubAccess: "write" });
    expect(result.will.toLowerCase()).toContain("pull request");
    expect(result.wont.toLowerCase()).toContain("not");
    expect(result.wont.toLowerCase()).toContain("merge");
  });

  test("P2A-003: will and wont are both non-empty strings", async () => {
    const describeAgentOutput = await getHelper();
    const r1 = describeAgentOutput({ outputMode: "none", githubAccess: "read" });
    const r2 = describeAgentOutput({ outputMode: "ready_pr", githubAccess: "write" });
    expect(r1.will.length).toBeGreaterThan(0);
    expect(r1.wont.length).toBeGreaterThan(0);
    expect(r2.will.length).toBeGreaterThan(0);
    expect(r2.wont.length).toBeGreaterThan(0);
  });

  test("P2A-004: none mode wont mentions comment/close/merge/edit/push are prohibited", async () => {
    const describeAgentOutput = await getHelper();
    const result = describeAgentOutput({ outputMode: "none", githubAccess: "read" });
    const wontLower = result.wont.toLowerCase();
    // Must mention that it won't write to the repo in some way
    expect(wontLower).toMatch(/comment|close|merge|edit|push/);
  });

  test("P2A-005: ready_pr wont should NOT say it will push directly to default branch", async () => {
    const describeAgentOutput = await getHelper();
    const result = describeAgentOutput({ outputMode: "ready_pr", githubAccess: "write" });
    expect(result.wont.toLowerCase()).toContain("default branch");
  });
});

// ---------------------------------------------------------------------------
// Phase 1 — deriveAgentName
// ---------------------------------------------------------------------------

describe("deriveAgentName", () => {
  test("P1-011: empty string returns empty string", () => {
    expect(deriveAgentName("")).toBe("");
  });

  test("P1-012: whitespace-only returns empty string", () => {
    expect(deriveAgentName("   ")).toBe("");
  });

  test("P1-013: short instruction returns all words capitalized at start", () => {
    const name = deriveAgentName("review pull requests daily");
    expect(name).toBe("Review pull requests daily");
  });

  test("P1-014: long instruction is capped at ~6 words", () => {
    const name = deriveAgentName(
      "when a pull request is opened review the diff and add a comment",
    );
    const wordCount = name.split(/\s+/).length;
    expect(wordCount).toBeLessThanOrEqual(6);
  });

  test("P1-015: first character is uppercased", () => {
    const name = deriveAgentName("summarize pull requests");
    expect(name[0]).toBe(name[0]?.toUpperCase());
  });
});
