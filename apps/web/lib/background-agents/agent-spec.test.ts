/**
 * Tests for shared agent spec logic (payload builder, types, helpers).
 * These tests drive the extraction of background-agents-form.ts into a
 * shared colocated module so the repo-dashboard creation flow can reuse it.
 */
import { describe, expect, test } from "bun:test";
import { OPEN_AGENT_TOOL_NAMES } from "@open-agents/agent";
import {
  buildAgentPayload,
  buildFormFromAgent,
  buildRepoScopedDefaultForm,
  conditionFieldLabel,
  defaultForm,
  describeEnabledActions,
  describeOutputModePermissions,
  fieldsForTrigger,
  isStepValid,
  outputModeLabel,
  type ConditionField,
  type BackgroundAgent,
  type FormState,
  type StepId,
} from "./agent-spec";
import {
  DEFAULT_ON_TOOL_NAMES,
  STANDARD_TOOLPACK_TOOL_NAMES,
} from "./builtin-toolpack";
import { DEFAULT_ENABLED_ACTIONS } from "./github-actions";

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
      builtinToolNames: null,
      writeScopeMode: "this_repo",
      writeScopeRepos: [],
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

  test("BT-E2: outputMode none derives github read even when form permission fields say write", () => {
    // Result (outputMode) is the single source of truth for GitHub write
    // access now — the form's permissionContents/permissionPullRequests
    // fields are no longer read by buildAgentPayload at all.
    const payload = buildAgentPayload(
      makeForm({
        outputMode: "none",
        permissionContents: "write",
        permissionPullRequests: "write",
      }),
    );

    expect(payload.permissions.github.contents).toBe("read");
    expect(payload.permissions.github.pullRequests).toBe("read");
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

  test("BT-038: buildAgentPayload defaults builtinToolNames to the web_fetch-off toolpack when form value is null", () => {
    const payload = buildAgentPayload(makeForm({ builtinToolNames: null }));

    expect(payload.builtinToolNames).toEqual([...DEFAULT_ON_TOOL_NAMES]);
    expect(payload.builtinToolNames).not.toContain("web_fetch");
  });

  test("BT-039: buildAgentPayload passes an explicit builtinToolNames array through verbatim", () => {
    const payload = buildAgentPayload(
      makeForm({ builtinToolNames: ["read", "bash", "web_fetch"] }),
    );

    expect(payload.builtinToolNames).toEqual(["read", "bash", "web_fetch"]);
  });

  test("BT-A3-05: buildAgentPayload emits writeScopeMode/writeScopeRepos from the form when outputMode is ready_pr", () => {
    const payload = buildAgentPayload(
      makeForm({
        outputMode: "ready_pr",
        writeScopeMode: "repo_list",
        writeScopeRepos: ["acme/widgets", "acme/other"],
      }),
    );

    expect(payload.permissions.github.writeScopeMode).toBe("repo_list");
    expect(payload.permissions.github.writeScopeRepos).toEqual([
      "acme/widgets",
      "acme/other",
    ]);
  });

  test("BT-A3-06: buildAgentPayload forces writeScopeMode to this_repo and writeScopeRepos to [] for every non-ready_pr outputMode, regardless of form input", () => {
    const payload = buildAgentPayload(
      makeForm({
        outputMode: "none",
        writeScopeMode: "all_repos",
        writeScopeRepos: ["acme/widgets"],
      }),
    );

    expect(payload.permissions.github.writeScopeMode).toBe("this_repo");
    expect(payload.permissions.github.writeScopeRepos).toEqual([]);
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

  test("REGRESSION: a legacy agent saved before write-scope existed (writeScopeMode/writeScopeRepos absent) defaults the form to this_repo/[]", () => {
    // If the ?? "this_repo" / ?? [] defaulting in buildFormFromAgent were
    // ever dropped, every agent saved before this feature existed would
    // load into the edit form with an undefined write scope instead of the
    // safe default.
    const form = buildFormFromAgent(
      makeAgent({
        outputMode: "ready_pr",
        permissions: { github: { contents: "write", pullRequests: "write" } },
      }),
    );

    expect(form.writeScopeMode).toBe("this_repo");
    expect(form.writeScopeRepos).toEqual([]);
  });

  test("REGRESSION: a saved repo_list write scope round-trips unchanged through buildFormFromAgent -> buildAgentPayload", () => {
    // Simulates the real edit flow for a ready_pr agent with a persisted
    // multi-repo write scope: opening the editor and re-saving without
    // touching the write-scope fields must not silently narrow or drop the
    // persisted repo list.
    const agent = makeAgent({
      outputMode: "ready_pr",
      permissions: {
        github: {
          contents: "write",
          pullRequests: "write",
          writeScopeMode: "repo_list",
          writeScopeRepos: ["acme/widgets", "acme/gadgets"],
        },
      },
    });

    const form = buildFormFromAgent(agent);
    expect(form.writeScopeMode).toBe("repo_list");
    expect(form.writeScopeRepos).toEqual(["acme/widgets", "acme/gadgets"]);

    const resavedPayload = buildAgentPayload(form);
    expect(resavedPayload.permissions.github.writeScopeMode).toBe("repo_list");
    expect(resavedPayload.permissions.github.writeScopeRepos).toEqual([
      "acme/widgets",
      "acme/gadgets",
    ]);
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
      builtinToolNames: null,
      writeScopeMode: "this_repo",
      writeScopeRepos: [],
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
// TASK-740 — describeEnabledActions (replaces describeOutputModePermissions
// as the source of truth for what a background agent can do on GitHub)
// ---------------------------------------------------------------------------

describe("describeEnabledActions", () => {
  test("(TASK-740) empty action set returns the same read-only description as describeOutputModePermissions('none')", () => {
    expect(describeEnabledActions([])).toBe(
      describeOutputModePermissions("none"),
    );
  });

  test("(TASK-740) lists human labels for each enabled action, joined by comma", () => {
    const desc = describeEnabledActions([
      "open_pull_request",
      "comment_on_pr_or_issue",
    ]);
    expect(desc).toContain("Open pull request");
    expect(desc).toContain("Comment on PR or issue");
  });

  test("(TASK-740) a single destructive action still renders its own human label", () => {
    expect(describeEnabledActions(["merge_pull_request"])).toBe(
      "Merge pull request",
    );
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
      builtinToolNames: null,
      writeScopeMode: "this_repo",
      writeScopeRepos: [],
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
// Regression — GitHub write permission has exactly one source of truth
// (Result / outputMode). Catches any future reintroduction of a second
// control (e.g. a standalone GitHub Access-level toggle) that could grant or
// withhold write independently of outputMode.
// ---------------------------------------------------------------------------

describe("REG: buildAgentPayload — outputMode is the ONLY input to github write permission", () => {
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
      builtinToolNames: null,
      writeScopeMode: "this_repo",
      writeScopeRepos: [],
      ...overrides,
    };
  }

  test("REG-020: every combination of permissionContents/permissionPullRequests is ignored for a non-ready_pr outputMode", () => {
    // If buildAgentPayload is ever changed to read these fields again (even
    // partially — e.g. only for pullRequests), this exhaustive sweep across
    // both fields x both values catches it, unlike a single-value test.
    const levels = ["read", "write"] as const;
    for (const permissionContents of levels) {
      for (const permissionPullRequests of levels) {
        const payload = buildAgentPayload(
          makeForm({
            outputMode: "none",
            permissionContents,
            permissionPullRequests,
          }),
        );
        expect(payload.permissions.github.contents).toBe("read");
        expect(payload.permissions.github.pullRequests).toBe("read");
      }
    }
  });

  test("REG-021: every combination of permissionContents/permissionPullRequests still yields write for ready_pr", () => {
    const levels = ["read", "write"] as const;
    for (const permissionContents of levels) {
      for (const permissionPullRequests of levels) {
        const payload = buildAgentPayload(
          makeForm({
            outputMode: "ready_pr",
            permissionContents,
            permissionPullRequests,
          }),
        );
        expect(payload.permissions.github.contents).toBe("write");
        expect(payload.permissions.github.pullRequests).toBe("write");
      }
    }
  });

  test("REG-022: a legacy agent saved with write access under outputMode 'none' is downgraded to read the next time it is saved unchanged", () => {
    // Simulates the real edit flow: buildFormFromAgent -> (no edits) ->
    // buildAgentPayload. Before this change, editing an unrelated field on a
    // legacy write-permission report-only agent silently kept the write
    // permission on save. This is the exact scenario the fix closes.
    const legacyAgent: BackgroundAgent = {
      id: "agent-legacy",
      name: "Legacy Reporter",
      description: null,
      status: "enabled",
      repoOwner: "acme",
      repoName: "widgets",
      instructions: "Summarize PRs.",
      outputMode: "none",
      checkCommand: null,
      permissions: {
        github: { contents: "write", pullRequests: "write" },
      },
      composioToolkitSlugs: [],
      triggers: [
        {
          id: "trig-legacy",
          name: "A pull request changes",
          kind: "github.pull_request",
          status: "enabled",
          conditions: {},
          schedule: null,
          webhookPublicId: null,
        },
      ],
    };

    const form = buildFormFromAgent(legacyAgent);
    const resavedPayload = buildAgentPayload(form);

    expect(resavedPayload.permissions.github.contents).toBe("read");
    expect(resavedPayload.permissions.github.pullRequests).toBe("read");
  });
});

describe("REG: builtin-toolpack — the product toolpack list cannot drift from the real tool registry", () => {
  test("REG-023: every STANDARD_TOOLPACK_TOOL_NAMES entry is a real open-agent tool name", () => {
    for (const name of STANDARD_TOOLPACK_TOOL_NAMES) {
      expect(OPEN_AGENT_TOOL_NAMES).toContain(name as never);
    }
  });

  test("REG-024: DEFAULT_ON_TOOL_NAMES is the toolpack minus web_fetch (off by default)", () => {
    expect(DEFAULT_ON_TOOL_NAMES).not.toContain("web_fetch");
    expect(STANDARD_TOOLPACK_TOOL_NAMES).toContain("web_fetch");
    expect(DEFAULT_ON_TOOL_NAMES.length).toBe(
      STANDARD_TOOLPACK_TOOL_NAMES.length - 1,
    );
  });

  test("REGRESSION: buildAgentPayload's default builtinToolNames is a fresh copy, not a shared reference to DEFAULT_ON_TOOL_NAMES", () => {
    // If buildAgentPayload were ever changed from `[...DEFAULT_ON_TOOL_NAMES]`
    // to `DEFAULT_ON_TOOL_NAMES` directly, mutating one saved agent's
    // payload.builtinToolNames array (e.g. downstream JSON round-tripping,
    // or a future feature that edits the array in place) would silently
    // corrupt the shared module-level constant for every other agent that
    // saves afterward. This guards that every payload gets its own array.
    const payloadA = buildAgentPayload(
      makeFormForBuiltinToolNamesRegression({ builtinToolNames: null }),
    );
    const payloadB = buildAgentPayload(
      makeFormForBuiltinToolNamesRegression({ builtinToolNames: null }),
    );

    expect(payloadA.builtinToolNames).not.toBe(payloadB.builtinToolNames);
    expect(payloadA.builtinToolNames).not.toBe(DEFAULT_ON_TOOL_NAMES);

    payloadA.builtinToolNames.push("mutated");

    expect(DEFAULT_ON_TOOL_NAMES).not.toContain("mutated");
    expect(payloadB.builtinToolNames).not.toContain("mutated");
  });
});

function makeFormForBuiltinToolNamesRegression(
  overrides: Partial<FormState> = {},
): FormState {
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
    builtinToolNames: null,
    writeScopeMode: "this_repo",
    writeScopeRepos: [],
    ...overrides,
  };
}

describe("buildFormFromAgent — builtinToolNames", () => {
  test("REG-025: a null builtinToolNames on the saved agent round-trips to null on the form (Standard toolpack UI renders the default preset)", () => {
    const form = buildFormFromAgent({
      id: "agent-1",
      name: "PR reporter",
      description: null,
      status: "disabled",
      repoOwner: "acme",
      repoName: "widgets",
      instructions: "Summarize pull requests.",
      outputMode: "none",
      checkCommand: null,
      permissions: { github: { contents: "read", pullRequests: "read" } },
      composioToolkitSlugs: [],
      builtinToolNames: null,
      triggers: [],
    });

    expect(form.builtinToolNames).toBeNull();
  });

  test("REG-026: a saved builtinToolNames array round-trips onto the form verbatim", () => {
    const form = buildFormFromAgent({
      id: "agent-1",
      name: "PR reporter",
      description: null,
      status: "disabled",
      repoOwner: "acme",
      repoName: "widgets",
      instructions: "Summarize pull requests.",
      outputMode: "none",
      checkCommand: null,
      permissions: { github: { contents: "read", pullRequests: "read" } },
      composioToolkitSlugs: [],
      builtinToolNames: ["read", "grep"],
      triggers: [],
    });

    expect(form.builtinToolNames).toEqual(["read", "grep"]);
  });
});

describe("REGRESSION: defaultForm seeds the #740 GitHub action defaults", () => {
  test("defaultForm.enabledActions matches DEFAULT_ENABLED_ACTIONS by value but is an independent copy", () => {
    // If a future edit dropped enabledActions from defaultForm, every new
    // agent created through the builder would silently start with zero
    // GitHub actions enabled instead of the agreed open_pull_request +
    // comment_on_pr_or_issue default.
    expect(defaultForm.enabledActions).toEqual(DEFAULT_ENABLED_ACTIONS);
    expect(defaultForm.enabledActions).not.toBe(DEFAULT_ENABLED_ACTIONS);
  });

  test("defaultForm.requireCiGreenToMerge defaults to true", () => {
    expect(defaultForm.requireCiGreenToMerge).toBe(true);
  });

  test("buildRepoScopedDefaultForm inherits the #740 action defaults from defaultForm", () => {
    const form = buildRepoScopedDefaultForm("acme", "widgets");

    expect(form.enabledActions).toEqual(DEFAULT_ENABLED_ACTIONS);
    expect(form.requireCiGreenToMerge).toBe(true);
  });
});
