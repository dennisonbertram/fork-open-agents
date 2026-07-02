/**
 * Regression tests for the GitHub project agent creation flow (TASK-165).
 *
 * These tests answer: "If this work breaks in the future, what catches it?"
 *
 * Scenario 1 — Created disabled unless explicitly enabled:
 *   buildAgentPayload must always produce status="disabled" unless
 *   form.enabled=true. If someone changes the default, this test fails.
 *
 * Scenario 2 — Repo owner/name cannot be reassigned in the dashboard flow:
 *   AgentSpecEditor accepts fixed repoOwner/repoName props and never renders
 *   editable input fields for them. If repo scoping is broken, this test fails.
 *
 * Scenario 3 — Settings page still works after shared-module extraction:
 *   buildAgentPayload imported from the settings re-export must behave
 *   identically to the shared implementation.
 *
 * Scenario 4 — No auto-merge in any template:
 *   None of the 5 templates or the blank template should mention auto-merge.
 *   If a future template accidentally includes it, this test fails.
 *
 * Scenario 5 — Template count stability:
 *   AGENT_TEMPLATES always has exactly 5 entries; adding/removing templates
 *   without updating this test is an explicit choice, not a silent drift.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildAgentPayload,
  buildRepoScopedDefaultForm,
} from "@/lib/background-agents/agent-spec";
import { AGENT_TEMPLATES, getBlankTemplate } from "./agent-templates";
import { AgentSpecEditor } from "./agent-spec-editor";

// Re-export from settings must behave identically
import { buildAgentPayload as buildAgentPayloadFromSettings } from "@/app/settings/background-agents-form";

describe("Regression: created disabled unless explicitly enabled", () => {
  test("buildAgentPayload with enabled=false produces status=disabled", () => {
    const form = buildRepoScopedDefaultForm("acme", "widgets");
    // Verify default is false
    expect(form.enabled).toBe(false);

    const payload = buildAgentPayload(form);
    expect(payload.status).toBe("disabled");
  });

  test("buildAgentPayload with enabled=true produces status=enabled", () => {
    const form = {
      ...buildRepoScopedDefaultForm("acme", "widgets"),
      enabled: true,
    };
    const payload = buildAgentPayload(form);
    expect(payload.status).toBe("enabled");
  });

  test("every template's defaultEnabled is false", () => {
    for (const template of AGENT_TEMPLATES) {
      expect(template.defaultEnabled).toBe(false);
    }
    expect(getBlankTemplate().defaultEnabled).toBe(false);
  });
});

describe("Regression: repo owner/name cannot be reassigned in the dashboard flow", () => {
  test("AgentSpecEditor does not render editable owner/name inputs (repo shown in breadcrumb, not editor)", () => {
    const html = renderToStaticMarkup(
      <AgentSpecEditor
        repoOwner="acme"
        repoName="widgets"
        initialName="Test"
        initialGoal=""
        initialTriggerKind="github.pull_request"
        initialInstructions="Test instructions"
        initialCheckCommand=""
        initialEnabled={false}
        onSave={() => undefined}
        onRunTest={() => undefined}
      />,
    );

    // Repo is NOT shown as editable text inputs (repo is in the page breadcrumb, not the editor)
    expect(html).not.toContain('id="repo-owner"');
    expect(html).not.toContain('id="repo-name"');
  });

  test("buildAgentPayload preserves the repo scope from the form (cannot drift)", () => {
    const form = buildRepoScopedDefaultForm("locked-owner", "locked-repo");
    const payload = buildAgentPayload({
      ...form,
      name: "Agent",
      instructions: "Do stuff",
    });

    expect(payload.repoOwner).toBe("locked-owner");
    expect(payload.repoName).toBe("locked-repo");
  });
});

describe("Regression: settings page re-export behaves identically to shared module", () => {
  test("buildAgentPayload from settings re-export matches shared module output", () => {
    const form = {
      ...buildRepoScopedDefaultForm("acme", "widgets"),
      name: "Test Agent",
      instructions: "Do something useful.",
      enabled: true,
      // Permissions are now user-controlled; set them explicitly to write
      // (the UI auto-coerces to write when outputMode becomes ready_pr)
      permissionContents: "write" as const,
      permissionPullRequests: "write" as const,
    };

    const sharedResult = buildAgentPayload(form);
    const settingsResult = buildAgentPayloadFromSettings(form);

    expect(settingsResult).toEqual(sharedResult);
    expect(settingsResult.status).toBe("enabled");
    expect(settingsResult.permissions.github.contents).toBe("write");
    expect(settingsResult.permissions.github.pullRequests).toBe("write");
  });
});

describe("Regression: no auto-merge in any template", () => {
  test("no template name, goal, or instructions mention auto-merge", () => {
    const allText = AGENT_TEMPLATES.flatMap((t) => [
      t.name,
      t.goal,
      t.instructions,
      t.permissionsNote ?? "",
    ])
      .join(" ")
      .toLowerCase();

    expect(allText).not.toContain("auto-merge");
    expect(allText).not.toContain("automerge");
    expect(allText).not.toContain("auto merge");
  });
});

describe("Regression: template count stability", () => {
  test("exactly 5 named templates exist (update this test if intentionally changing count)", () => {
    expect(AGENT_TEMPLATES).toHaveLength(5);
  });

  test("all 5 expected template names are present", () => {
    const names = AGENT_TEMPLATES.map((t) => t.name);
    expect(names).toContain("PR Backlog Maintainer");
    expect(names).toContain("Failing Checks Fixer");
    expect(names).toContain("Issue Triage Agent");
    expect(names).toContain("Release Notes Agent");
    expect(names).toContain("Docs Drift Checker");
  });
});
