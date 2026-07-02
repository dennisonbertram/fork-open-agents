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
  conditionFieldLabel,
  describeOutputModePermissions,
  fieldsForTrigger,
  isStepValid,
  outputModeLabel,
  type ConditionField,
  type BackgroundAgent,
  type FormState,
  type StepId,
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
      conditionActors: "",
      conditionIgnoreActors: "",
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
      conditionActors: "",
      conditionIgnoreActors: "",
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
  test("BT-021: pull_request trigger includes actions, branches, labels, actors; excludes environments, statuses", () => {
    const fields = fieldsForTrigger("github.pull_request");
    const fieldArr = [...fields] as ConditionField[];
    expect(fields.has("actions")).toBe(true);
    expect(fields.has("branches")).toBe(true);
    expect(fields.has("labels")).toBe(true);
    expect(fields.has("environments")).toBe(false);
    expect(fields.has("statuses")).toBe(false);
    expect(fields.has("actors")).toBe(true);
    expect(fields.has("ignoreActors")).toBe(true);
    expect(fieldArr.length).toBe(5);
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
  test("REG-010: deployment_status has exactly 4 fields (environments + statuses + actors + ignoreActors); no more", () => {
    const fields = fieldsForTrigger("github.deployment_status");
    // If someone accidentally adds actions/branches/labels back, this catches it
    expect(fields.size).toBe(4);
    expect(fields.has("environments")).toBe(true);
    expect(fields.has("statuses")).toBe(true);
    expect(fields.has("actors")).toBe(true);
    expect(fields.has("ignoreActors")).toBe(true);
  });

  test("REG-011: schedule.cron still returns empty set even if trigger map is extended", () => {
    // Cron has no event-driven condition fields ever — if this changes, the
    // UI would show nonsense condition inputs on a time-based trigger
    const fields = fieldsForTrigger("schedule.cron");
    expect(fields.size).toBe(0);
  });

  test("REG-012: pull_request has exactly 5 fields; environments/statuses never leak in", () => {
    const fields = fieldsForTrigger("github.pull_request");
    expect(fields.size).toBe(5);
    expect(fields.has("environments")).toBe(false);
    expect(fields.has("statuses")).toBe(false);
  });

  // #749: check_suite condition fields
  test("check_suite trigger includes branches, statuses (conclusion), actors, ignoreActors", () => {
    const fields = fieldsForTrigger("github.check_suite");
    expect(fields.size).toBe(4);
    expect(fields.has("branches")).toBe(true);
    expect(fields.has("statuses")).toBe(true);
    expect(fields.has("actors")).toBe(true);
    expect(fields.has("ignoreActors")).toBe(true);
    expect(fields.has("actions")).toBe(false);
    expect(fields.has("labels")).toBe(false);
    expect(fields.has("environments")).toBe(false);
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
      conditionActors: "",
      conditionIgnoreActors: "",
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
