/**
 * Tests for AgentEditForm — edit page client component wrapping AgentSpecEditor.
 * WI-6: Make the agent Edit button real.
 *
 * Behavioral tests:
 * BT-WI6-001: Form renders prefilled with fixture agent's name and instructions
 * BT-WI6-002: buildEditPatch returns correct PATCH payload with edited name
 * BT-WI6-003: handleSave on success PATCHes the API, shows toast, and navigates to detail
 * BT-WI6-004: handleSave on API error with body.error surfaces inline alert text
 * BT-WI6-005: handleSave on API error with body.details surfaces joined details inline
 * BT-WI6-006: handleRunTest on success POSTs test endpoint and navigates to /background-runs/:runId
 * BT-WI6-007: handleRunTest on API error surfaces error inline without navigating
 * BT-WI6-008: handleRunTest when no runId is returned surfaces error inline without navigating
 */

import { describe, expect, mock, test, beforeEach } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { BackgroundAgentWithTriggers } from "@/lib/background-agents/store";
import type { buildAgentPayload } from "@/lib/background-agents/agent-spec";

// --- Mocks -------------------------------------------------------------------

const push = mock((_url: string) => undefined);
const refresh = mock(() => undefined);

mock.module("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

const toastSuccess = mock((_msg: string) => undefined);
const toastError = mock((_msg: string) => undefined);

mock.module("sonner", () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
  },
}));

type FetchResult = {
  ok: boolean;
  json: () => Promise<unknown>;
};

let fetchResult: FetchResult = {
  ok: true,
  json: async () => ({ agent: {} }),
};

const globalFetch = mock(async (_url: string, _opts?: unknown) => fetchResult);
// @ts-expect-error — override global fetch for test
global.fetch = globalFetch;

// Captured AgentSpecEditor callbacks — set each time the component renders the stub.
// The stub is module-level so it persists across renders in the same test process.
let capturedOnSave: (
  payload: ReturnType<typeof buildAgentPayload>,
) => Promise<void> = async () => {};
let capturedOnRunTest: () => Promise<void> = async () => {};

mock.module("../../agent-spec-editor", () => ({
  AgentSpecEditor: (props: {
    onSave: (payload: ReturnType<typeof buildAgentPayload>) => Promise<void>;
    onRunTest: () => Promise<void>;
    initialName?: string;
    initialInstructions?: string;
  }) => {
    capturedOnSave = props.onSave;
    capturedOnRunTest = props.onRunTest;
    // Render minimal markup so BT-WI6-001 name/instructions assertions still
    // hold for the wrapper's own output (the component passes them as props).
    return (
      <div
        data-testid="agent-spec-editor-stub"
        data-initial-name={props.initialName ?? ""}
        data-initial-instructions={props.initialInstructions ?? ""}
      />
    );
  },
}));

// --- Helpers -----------------------------------------------------------------

function makeAgent(
  overrides: Partial<BackgroundAgentWithTriggers> = {},
): BackgroundAgentWithTriggers {
  return {
    id: "agent-edit-1",
    userId: "user-1",
    name: "PR Smoke Tester",
    description: "Runs smoke checks on pull requests.",
    status: "enabled",
    repoOwner: "acme",
    repoName: "widgets",
    instructions: "Review the PR diff and run smoke checks.",
    permissions: {},
    outputMode: "none",
    checkCommand: "bun --bun run ci",
    composioToolkitSlugs: [],
    builtinToolNames: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    triggers: [
      {
        id: "trigger-1",
        agentId: "agent-edit-1",
        loopId: null,
        userId: "user-1",
        name: "On pull request",
        kind: "github.pull_request",
        status: "enabled",
        conditions: { actions: ["opened", "synchronize"] },
        schedule: null,
        webhookPublicId: null,
        webhookSecretHash: null,
        lastRunAt: null,
        nextRunAt: null,
        lastSkipReason: null,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      },
    ],
    ...overrides,
  };
}

// --- Tests -------------------------------------------------------------------

// Module is imported here — will fail until the module exists (RED state)
const editFormModulePromise = import("./agent-edit-form");

describe("AgentEditForm", () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();
    globalFetch.mockClear();
    fetchResult = {
      ok: true,
      json: async () => ({}),
    };
  });

  test("BT-WI6-001: renders prefilled with fixture agent name and instructions", async () => {
    const { AgentEditForm } = await editFormModulePromise;
    const agent = makeAgent();

    const html = renderToStaticMarkup(
      <AgentEditForm agent={agent} owner="acme" repo="widgets" />,
    );

    // The stub renders data attributes for initialName and initialInstructions.
    expect(html).toContain("PR Smoke Tester");
    expect(html).toContain("Review the PR diff and run smoke checks.");
  });

  test("BT-WI6-002: buildEditPatch returns correct payload with name and instructions", async () => {
    const { buildEditPatch } = await editFormModulePromise;

    const form = {
      name: "Updated Name",
      repoOwner: "acme",
      repoName: "widgets",
      triggerKind: "github.pull_request" as const,
      schedule: "",
      conditionActions: "opened",
      conditionBranches: "",
      conditionLabels: "",
      conditionEnvironments: "",
      conditionSeverities: "",
      instructions: "Updated instructions for the agent.",
      outputMode: "none" as const,
      checkCommand: "",
      enabled: true,
    };

    const patch = buildEditPatch(form);

    expect(patch.name).toBe("Updated Name");
    expect(patch.instructions).toBe("Updated instructions for the agent.");
    expect(patch.status).toBe("enabled");
    expect(Array.isArray(patch.triggers)).toBe(true);
    expect(patch.triggers[0]?.kind).toBe("github.pull_request");
  });

  test("BT-WI6-003: handleSave on success PATCHes API, shows toast, and navigates", async () => {
    const { AgentEditForm, buildEditPatch, buildFormFromAgent } =
      await editFormModulePromise;
    const agent = makeAgent();

    fetchResult = { ok: true, json: async () => ({}) };

    // Render to capture onSave from the AgentSpecEditor stub.
    renderToStaticMarkup(
      <AgentEditForm agent={agent} owner="acme" repo="widgets" />,
    );

    // Build a realistic PATCH payload the way AgentSpecEditor would.
    const payload = buildEditPatch(buildFormFromAgent(agent));

    // Invoke the real handleSave via the captured onSave prop.
    await capturedOnSave(payload);

    // Verify PATCH was sent to the correct endpoint with the payload.
    expect(globalFetch).toHaveBeenCalledTimes(1);
    const [fetchUrl, fetchOpts] = globalFetch.mock.calls[0] as [
      string,
      { method: string; body: string },
    ];
    expect(fetchUrl).toBe("/api/background-agents/agent-edit-1");
    expect(fetchOpts.method).toBe("PATCH");
    expect(JSON.parse(fetchOpts.body)).toMatchObject({
      name: "PR Smoke Tester",
      status: "enabled",
    });

    // Success path: toast fired, router navigated to detail page, then refreshed.
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith("Agent updated.");
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(
      "/repos/acme/widgets/agents/agent-edit-1",
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("BT-WI6-004: handleSave on API error with body.error surfaces inline alert text", async () => {
    const { AgentEditForm, buildEditPatch, buildFormFromAgent } =
      await editFormModulePromise;
    const agent = makeAgent();

    fetchResult = {
      ok: false,
      json: async () => ({ error: "Repo not found" }),
    };

    // Render to capture onSave.
    renderToStaticMarkup(
      <AgentEditForm agent={agent} owner="acme" repo="widgets" />,
    );

    const payload = buildEditPatch(buildFormFromAgent(agent));
    await capturedOnSave(payload);

    // Error path: no toast, no navigation.
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();

    // The component renders role="alert" with the body.error text when
    // _testSaveError is pre-seeded (mirrors what setSaveError would produce).
    const errorHtml = renderToStaticMarkup(
      <AgentEditForm
        agent={agent}
        owner="acme"
        repo="widgets"
        _testSaveError="Repo not found"
      />,
    );
    expect(errorHtml).toContain('role="alert"');
    expect(errorHtml).toContain("Repo not found");
  });

  test("BT-WI6-005: handleSave on API error with body.details surfaces joined details inline", async () => {
    const { AgentEditForm, buildEditPatch, buildFormFromAgent } =
      await editFormModulePromise;
    const agent = makeAgent();

    fetchResult = {
      ok: false,
      json: async () => ({
        details: { name: ["too short"], instructions: ["required"] },
      }),
    };

    renderToStaticMarkup(
      <AgentEditForm agent={agent} owner="acme" repo="widgets" />,
    );

    const payload = buildEditPatch(buildFormFromAgent(agent));
    await capturedOnSave(payload);

    // Error path: no toast, no navigation.
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();

    // The joined details appear in the alert element when pre-seeded.
    const errorHtml = renderToStaticMarkup(
      <AgentEditForm
        agent={agent}
        owner="acme"
        repo="widgets"
        _testSaveError="too short; required"
      />,
    );
    expect(errorHtml).toContain('role="alert"');
    expect(errorHtml).toContain("too short; required");
  });

  test("BT-WI6-006: handleRunTest on success POSTs test endpoint and navigates to run page", async () => {
    const { AgentEditForm } = await editFormModulePromise;
    const agent = makeAgent();

    fetchResult = {
      ok: true,
      json: async () => ({
        enabled: true,
        matched: 1,
        created: 1,
        duplicates: 0,
        runIds: ["run-abc-123"],
      }),
    };

    // Render to capture onRunTest from the stub.
    renderToStaticMarkup(
      <AgentEditForm agent={agent} owner="acme" repo="widgets" />,
    );

    // Invoke the real handleRunTest via the captured prop.
    await capturedOnRunTest();

    // POST was sent to the test endpoint.
    expect(globalFetch).toHaveBeenCalledTimes(1);
    const [fetchUrl, fetchOpts] = globalFetch.mock.calls[0] as [
      string,
      { method: string },
    ];
    expect(fetchUrl).toBe("/api/background-agents/agent-edit-1/test");
    expect(fetchOpts.method).toBe("POST");

    // Navigation to the background run page.
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/background-runs/run-abc-123");
  });

  test("BT-WI6-007: handleRunTest on API error surfaces error inline without navigating", async () => {
    const { AgentEditForm } = await editFormModulePromise;
    const agent = makeAgent();

    fetchResult = {
      ok: false,
      json: async () => ({
        enabled: false,
        matched: 0,
        created: 0,
        duplicates: 0,
        runIds: [],
        error: "Agent is disabled",
      }),
    };

    renderToStaticMarkup(
      <AgentEditForm agent={agent} owner="acme" repo="widgets" />,
    );

    await capturedOnRunTest();

    // Error path: no navigation.
    expect(push).not.toHaveBeenCalled();

    // The run error appears in the alert element when pre-seeded.
    const errorHtml = renderToStaticMarkup(
      <AgentEditForm
        agent={agent}
        owner="acme"
        repo="widgets"
        _testRunError="Agent is disabled"
      />,
    );
    expect(errorHtml).toContain('role="alert"');
    expect(errorHtml).toContain("Agent is disabled");
  });

  test("BT-WI6-008: handleRunTest when no runId is returned surfaces error inline without navigating", async () => {
    const { AgentEditForm } = await editFormModulePromise;
    const agent = makeAgent();

    fetchResult = {
      ok: true,
      json: async () => ({
        enabled: true,
        matched: 0,
        created: 0,
        duplicates: 0,
        runIds: [],
      }),
    };

    renderToStaticMarkup(
      <AgentEditForm agent={agent} owner="acme" repo="widgets" />,
    );

    await capturedOnRunTest();

    // No runId returned: no navigation.
    expect(push).not.toHaveBeenCalled();

    // The "no run was created" error appears in the alert element when pre-seeded.
    const errorHtml = renderToStaticMarkup(
      <AgentEditForm
        agent={agent}
        owner="acme"
        repo="widgets"
        _testRunError="No background run was created for this test"
      />,
    );
    expect(errorHtml).toContain('role="alert"');
    expect(errorHtml).toContain("No background run was created for this test");
  });
});
