/**
 * DOM-interaction tests for NewAgentBuilder's Save feedback contract.
 *
 * #859: clicking Save on /repos/[owner]/[repo]/agents/new must produce
 * prominent, accessible success feedback (toast + role="status") distinct
 * from the error path (role="alert"). See agent-card.dom.test.tsx for the
 * exemplar this file follows.
 */

import { registerDomTestHooks, render, userClick, within } from "@/tests/dom";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { useState } from "react";
import {
  buildAgentPayload,
  defaultForm,
} from "@/lib/background-agents/agent-spec";
import { getBlankTemplate } from "../agent-templates";

registerDomTestHooks();

// --- Mocks -------------------------------------------------------------------

const toastSuccess = mock((_message: string) => undefined);
const toastError = mock((_message: string) => undefined);

mock.module("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

mock.module("swr", () => ({
  default: () => ({
    data: {
      enabled: true,
      ready: true,
      missing: [],
      checks: [],
      repoAccess: {
        ready: true,
        repoOwner: "acme",
        repoName: "widgets",
        requiredUserPermission: "write",
        reason: null,
        message: "Repository access is ready.",
        installationId: 1,
        repositoryId: 2,
        defaultBranch: "main",
      },
    },
    error: null,
    isLoading: false,
    mutate: async () => undefined,
  }),
}));

mock.module("../template-picker", () => ({
  TemplatePicker: ({ onSelect }: { onSelect: (template: unknown) => void }) => (
    <button onClick={() => onSelect(getBlankTemplate())} type="button">
      Start blank
    </button>
  ),
}));

mock.module("../agent-spec-editor", () => ({
  AgentSpecEditor: ({
    createdAgentId,
    testRunId,
    surface,
    readinessReady,
    persistedEnabled,
    testAlert,
    onSave,
    onRunTest,
  }: {
    createdAgentId: string | null;
    testRunId: string | null;
    surface?: string;
    readinessReady?: boolean;
    persistedEnabled?: boolean;
    testAlert?: string | null;
    onSave: (payload: unknown) => void | Promise<void>;
    onRunTest: () => void | Promise<void>;
  }) => {
    const [enabled, setEnabled] = useState(false);
    return (
      <div>
        {testAlert ? <div role="alert">{testAlert}</div> : null}
        <span data-testid="created-agent-id">{createdAgentId ?? "none"}</span>
        <span data-testid="test-run-id">{testRunId ?? "none"}</span>
        <span data-testid="editor-surface">{surface ?? "legacy"}</span>
        <span data-testid="readiness-ready">
          {String(readinessReady ?? true)}
        </span>
        <span data-testid="persisted-enabled">
          {String(persistedEnabled ?? false)}
        </span>
        <button
          onClick={() =>
            void onSave(
              buildAgentPayload({
                ...defaultForm,
                name: "Nightly triage",
                repoOwner: "acme",
                repoName: "widgets",
                instructions: "Triage new issues",
                enabled,
              }),
            )
          }
          type="button"
        >
          Save agent
        </button>
        <button onClick={() => setEnabled(true)} type="button">
          Enable agent
        </button>
        <button onClick={() => void onRunTest()} type="button">
          Run a test
        </button>
      </div>
    );
  },
}));

let fetchResult: { ok: boolean; json: () => Promise<unknown> } = {
  ok: true,
  json: async () => ({ agent: { id: "agent-123" } }),
};

const globalFetch = mock(async (_url: string, _opts?: unknown) => fetchResult);
// @ts-expect-error — override global fetch for test
global.fetch = globalFetch;

const builderPromise = import("./new-agent-builder");

describe("NewAgentBuilder — save feedback (#859)", () => {
  beforeEach(() => {
    toastSuccess.mockClear();
    toastError.mockClear();
    globalFetch.mockClear();
    fetchResult = {
      ok: true,
      json: async () => ({ agent: { id: "agent-123" } }),
    };
  });

  test("save success: POSTs /api/background-agents and shows accessible confirmation with a View agent affordance", async () => {
    const { NewAgentBuilder } = await builderPromise;

    const { container } = render(
      <NewAgentBuilder owner="acme" repo="widgets" />,
    );
    const q = within(container);

    await userClick(q.getByRole("button", { name: /start blank/i }));
    await userClick(q.getByRole("button", { name: /save agent/i }));

    expect(globalFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = globalFetch.mock.calls[0] as [
      string,
      { method: string },
    ];
    expect(url).toBe("/api/background-agents");
    expect(opts.method).toBe("POST");

    const status = await q.findByRole("status");
    expect(status.textContent).toContain("Agent created");

    const link = within(status).getByRole("link", { name: /view agent/i });
    expect(link.getAttribute("href")).toBe(
      "/repos/acme/widgets/agents/agent-123",
    );

    expect(toastSuccess).toHaveBeenCalledWith("Agent created successfully.");
  });

  test("save failure: surfaces role=alert error, no success status, no success toast", async () => {
    fetchResult = { ok: false, json: async () => ({}) };
    const { NewAgentBuilder } = await builderPromise;

    const { container } = render(
      <NewAgentBuilder owner="acme" repo="widgets" />,
    );
    const q = within(container);

    await userClick(q.getByRole("button", { name: /start blank/i }));
    await userClick(q.getByRole("button", { name: /save agent/i }));

    const alert = await q.findByRole("alert");
    expect(alert.textContent).toContain("Failed to create background agent");
    expect(q.queryByRole("status")).toBeNull();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  test("a later failed save suppresses the stale success status panel", async () => {
    const { NewAgentBuilder } = await builderPromise;

    const { container } = render(
      <NewAgentBuilder owner="acme" repo="widgets" />,
    );
    const q = within(container);

    await userClick(q.getByRole("button", { name: /start blank/i }));
    await userClick(q.getByRole("button", { name: /save agent/i }));

    // First save succeeded — success status panel is visible.
    expect(await q.findByRole("status")).toBeTruthy();

    // Second save fails (now via PATCH, since createdAgentId is set).
    fetchResult = { ok: false, json: async () => ({}) };
    await userClick(q.getByRole("button", { name: /save agent/i }));

    const alert = await q.findByRole("alert");
    expect(alert.textContent).toContain("Failed to update background agent");
    expect(q.queryByRole("status")).toBeNull();
  });

  test("stays on the page after save so Run a test enables", async () => {
    const { NewAgentBuilder } = await builderPromise;

    const { container } = render(
      <NewAgentBuilder owner="acme" repo="widgets" />,
    );
    const q = within(container);

    await userClick(q.getByRole("button", { name: /start blank/i }));
    await userClick(q.getByRole("button", { name: /save agent/i }));

    expect((await q.findByTestId("created-agent-id")).textContent).toBe(
      "agent-123",
    );
  });
});

describe("NewAgentBuilder — second save updates instead of duplicating (#860)", () => {
  beforeEach(() => {
    toastSuccess.mockClear();
    toastError.mockClear();
    globalFetch.mockClear();
    fetchResult = {
      ok: true,
      json: async () => ({ agent: { id: "agent-123" } }),
    };
  });

  test("two Saves: one POST then one PATCH, never two POSTs", async () => {
    const { NewAgentBuilder } = await builderPromise;

    const { container } = render(
      <NewAgentBuilder owner="acme" repo="widgets" />,
    );
    const q = within(container);

    await userClick(q.getByRole("button", { name: /start blank/i }));
    await userClick(q.getByRole("button", { name: /save agent/i }));
    await userClick(q.getByRole("button", { name: /save agent/i }));

    expect(globalFetch).toHaveBeenCalledTimes(2);
    const [firstUrl, firstOpts] = globalFetch.mock.calls[0] as [
      string,
      { method: string },
    ];
    const [secondUrl, secondOpts] = globalFetch.mock.calls[1] as [
      string,
      { method: string },
    ];
    expect(firstUrl).toBe("/api/background-agents");
    expect(firstOpts.method).toBe("POST");
    expect(secondUrl).toBe("/api/background-agents/agent-123");
    expect(secondOpts.method).toBe("PATCH");
  });

  test("toggle Enabled then Save PATCHes with status enabled", async () => {
    const { NewAgentBuilder } = await builderPromise;

    const { container } = render(
      <NewAgentBuilder owner="acme" repo="widgets" />,
    );
    const q = within(container);

    await userClick(q.getByRole("button", { name: /start blank/i }));
    await userClick(q.getByRole("button", { name: /save agent/i }));
    await userClick(q.getByRole("button", { name: /enable agent/i }));
    await userClick(q.getByRole("button", { name: /save agent/i }));

    const [secondUrl, secondOpts] = globalFetch.mock.calls[1] as [
      string,
      { method: string; body: string },
    ];
    expect(secondUrl).toBe("/api/background-agents/agent-123");
    expect(secondOpts.method).toBe("PATCH");
    expect(JSON.parse(secondOpts.body).status).toBe("enabled");
  });

  test("second save shows update feedback distinct from create", async () => {
    const { NewAgentBuilder } = await builderPromise;

    const { container } = render(
      <NewAgentBuilder owner="acme" repo="widgets" />,
    );
    const q = within(container);

    await userClick(q.getByRole("button", { name: /start blank/i }));
    await userClick(q.getByRole("button", { name: /save agent/i }));
    await userClick(q.getByRole("button", { name: /save agent/i }));

    expect(toastSuccess).toHaveBeenCalledTimes(2);
    expect(toastSuccess).toHaveBeenLastCalledWith("Agent updated.");

    const status = await q.findByRole("status");
    expect(status.textContent).toContain("Agent updated");
  });

  test("Automation surface saves disabled first, tracks persisted enablement, and keeps links canonical", async () => {
    const { NewAgentBuilder } = await builderPromise;
    const { container } = render(
      <NewAgentBuilder owner="acme" repo="widgets" surface="automation" />,
    );
    const q = within(container);

    await userClick(q.getByRole("button", { name: /start blank/i }));
    expect((await q.findByTestId("editor-surface")).textContent).toBe(
      "automation",
    );
    expect((await q.findByTestId("readiness-ready")).textContent).toBe("true");

    await userClick(q.getByRole("button", { name: /save agent/i }));
    const [firstUrl, firstOptions] = globalFetch.mock.calls[0] as [
      string,
      { body: string },
    ];
    expect(firstUrl).toBe("/api/background-agents");
    expect(JSON.parse(firstOptions.body).status).toBe("disabled");
    expect((await q.findByTestId("persisted-enabled")).textContent).toBe(
      "false",
    );
    expect(
      q.getByRole("link", { name: /view automation/i }).getAttribute("href"),
    ).toBe("/automations/background-agent/agent-123");

    await userClick(q.getByRole("button", { name: /enable agent/i }));
    await userClick(q.getByRole("button", { name: /save agent/i }));
    const [secondUrl, secondOptions] = globalFetch.mock.calls[1] as [
      string,
      { body: string },
    ];
    expect(secondUrl).toBe("/api/background-agents/agent-123");
    expect(JSON.parse(secondOptions.body).status).toBe("enabled");
    expect((await q.findByTestId("persisted-enabled")).textContent).toBe(
      "true",
    );
  });
});

describe("NewAgentBuilder — run-test skip feedback (#861)", () => {
  beforeEach(() => {
    toastSuccess.mockClear();
    toastError.mockClear();
    globalFetch.mockClear();
    fetchResult = {
      ok: true,
      json: async () => ({ agent: { id: "agent-123" } }),
    };
  });

  test.each([
    [
      "agent_disabled",
      "This agent is disabled — enable it above, then run the test again.",
    ],
    [
      "no_enabled_trigger",
      "This agent has no enabled trigger to test — add or enable one first.",
    ],
    [
      "repo_not_allowlisted",
      "This repository isn't allowlisted for background agents — check Background agent settings.",
    ],
  ])(
    "skipReason %s renders a prominent alert with the mapped copy",
    async (skipReason, expectedCopy) => {
      const { NewAgentBuilder } = await builderPromise;

      const { container } = render(
        <NewAgentBuilder owner="acme" repo="widgets" />,
      );
      const q = within(container);

      await userClick(q.getByRole("button", { name: /start blank/i }));
      await userClick(q.getByRole("button", { name: /save agent/i }));

      fetchResult = {
        ok: true,
        json: async () => ({
          enabled: true,
          matched: 0,
          created: 0,
          duplicates: 0,
          runIds: [],
          skipReason,
        }),
      };
      await userClick(q.getByRole("button", { name: /run a test/i }));

      const alert = await q.findByRole("alert");
      expect(alert.textContent).toContain(expectedCopy);
      expect((await q.findByTestId("test-run-id")).textContent).toBe("none");
    },
  );

  test("feature-disabled 403 renders the backend error message as an alert", async () => {
    const { NewAgentBuilder } = await builderPromise;

    const { container } = render(
      <NewAgentBuilder owner="acme" repo="widgets" />,
    );
    const q = within(container);

    await userClick(q.getByRole("button", { name: /start blank/i }));
    await userClick(q.getByRole("button", { name: /save agent/i }));

    fetchResult = {
      ok: false,
      json: async () => ({ error: "Background agents are disabled" }),
    };
    await userClick(q.getByRole("button", { name: /run a test/i }));

    const alert = await q.findByRole("alert");
    expect(alert.textContent).toContain("Background agents are disabled");
  });

  test("a successful run: no alert, test-run-id becomes the created run id", async () => {
    const { NewAgentBuilder } = await builderPromise;

    const { container } = render(
      <NewAgentBuilder owner="acme" repo="widgets" />,
    );
    const q = within(container);

    await userClick(q.getByRole("button", { name: /start blank/i }));
    await userClick(q.getByRole("button", { name: /save agent/i }));

    fetchResult = {
      ok: true,
      json: async () => ({
        enabled: true,
        matched: 1,
        created: 1,
        duplicates: 0,
        runIds: ["run-9"],
      }),
    };
    await userClick(q.getByRole("button", { name: /run a test/i }));

    expect((await q.findByTestId("test-run-id")).textContent).toBe("run-9");
    expect(q.queryByRole("alert")).toBeNull();
  });
});
