/**
 * Regression tests for #1093.
 *
 * A failed `/api/background-agents/readiness` fetch must render a
 * load-failure state with a retry, NOT the indefinite
 * "Checking background agent prerequisites." placeholder.
 */

import { registerDomTestHooks, render, userClick, within } from "@/tests/dom";

import { beforeEach, describe, expect, mock, test } from "bun:test";

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
  TemplatePicker: () => <div>template picker</div>,
}));

mock.module("../agent-spec-editor", () => ({
  AgentSpecEditor: () => <div>spec editor</div>,
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
});
