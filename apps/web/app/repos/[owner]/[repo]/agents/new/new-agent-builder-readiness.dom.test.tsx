/**
 * Regression tests for #1093.
 *
 * A failed `/api/background-agents/readiness` fetch must render a
 * load-failure state with a retry, NOT the indefinite
 * "Checking background agent prerequisites." placeholder.
 */

import { registerDomTestHooks, render, userClick, within } from "@/tests/dom";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { getBlankTemplate } from "../agent-templates";

registerDomTestHooks();

let readinessState: { data?: unknown; error?: unknown } = { error: undefined };
const mutateReadiness = mock(async () => undefined);

mock.module("swr", () => ({
  default: () => ({
    data: readinessState.data,
    error: readinessState.error,
    isLoading: false,
    mutate: mutateReadiness,
  }),
}));

mock.module("sonner", () => ({
  toast: { success: () => {}, error: () => {} },
}));

mock.module("../template-picker", () => ({
  TemplatePicker: ({ onSelect }: { onSelect: (template: unknown) => void }) => (
    <button onClick={() => onSelect(getBlankTemplate())} type="button">
      Start blank
    </button>
  ),
}));

mock.module("../agent-spec-editor", () => ({
  AgentSpecEditor: ({ readinessReady }: { readinessReady?: boolean }) => (
    <span data-testid="readiness-ready">{String(readinessReady ?? true)}</span>
  ),
}));

const builderPromise = import("./new-agent-builder");

const readyPayload = {
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
};

describe("NewAgentBuilder — readiness load failure (#1093)", () => {
  beforeEach(() => {
    mutateReadiness.mockClear();
  });

  test("readiness fetch failure renders a load-failure state with retry, not the checking placeholder", async () => {
    readinessState = { error: new Error("Failed to load") };
    const { NewAgentBuilder } = await builderPromise;
    const { container } = render(
      <NewAgentBuilder owner="acme" repo="widgets" />,
    );
    const q = within(container);

    const retry = q.getByRole("button", { name: /retry/i });
    expect(
      q.queryByText(/Checking background agent prerequisites\./i),
    ).toBeNull();

    await userClick(retry);
    expect(mutateReadiness).toHaveBeenCalled();
  });

  test("the checking placeholder still renders while readiness is in flight", async () => {
    readinessState = {};
    const { NewAgentBuilder } = await builderPromise;
    const { container } = render(
      <NewAgentBuilder owner="acme" repo="widgets" />,
    );
    const q = within(container);

    expect(
      q.getByText(/Checking background agent prerequisites\./i),
    ).toBeTruthy();
    expect(q.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  test("successful readiness still renders the verdict panel", async () => {
    readinessState = { data: readyPayload };
    const { NewAgentBuilder } = await builderPromise;
    const { container } = render(
      <NewAgentBuilder owner="acme" repo="widgets" />,
    );
    const q = within(container);

    expect(
      q.queryByText(/Checking background agent prerequisites\./i),
    ).toBeNull();
    expect(
      q.getByRole("link", { name: /open background agent settings/i }),
    ).toBeTruthy();
  });

  test("a failed revalidation over a cached ready verdict keeps the panel, signals staleness, and downgrades readiness", async () => {
    readinessState = {
      data: readyPayload,
      error: new Error("Failed to refresh"),
    };
    const { NewAgentBuilder } = await builderPromise;
    const { container } = render(
      <NewAgentBuilder owner="acme" repo="widgets" />,
    );
    const q = within(container);

    // Cached content stays on screen — a transient blip must not tear it down.
    expect(
      q.getByRole("link", { name: /open background agent settings/i }),
    ).toBeTruthy();
    // …but the failure must be reachable, not hidden behind stale content.
    expect(q.getByText(/couldn't be refreshed/i)).toBeTruthy();

    // A stale "ready" is an assertion about safety: do not let it enable anything.
    await userClick(q.getByRole("button", { name: /start blank/i }));
    expect(q.getByTestId("readiness-ready").textContent).toBe("false");
  });
});
