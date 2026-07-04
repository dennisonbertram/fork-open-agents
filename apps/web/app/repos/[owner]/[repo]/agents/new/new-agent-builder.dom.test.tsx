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
    data: { enabled: true, ready: true, missing: [], checks: [] },
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
    onSave,
  }: {
    createdAgentId: string | null;
    onSave: (payload: unknown) => void | Promise<void>;
  }) => (
    <div>
      <span data-testid="created-agent-id">{createdAgentId ?? "none"}</span>
      <button
        onClick={() =>
          void onSave(
            buildAgentPayload({
              ...defaultForm,
              name: "Nightly triage",
              repoOwner: "acme",
              repoName: "widgets",
              instructions: "Triage new issues",
            }),
          )
        }
        type="button"
      >
        Save agent
      </button>
    </div>
  ),
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
