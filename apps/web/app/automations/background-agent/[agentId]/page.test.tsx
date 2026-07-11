import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const redirect = mock((path: string) => {
  throw new Error(`redirect:${path}`);
});
const notFound = mock(() => {
  throw new Error("not-found");
});
let sessionUserId: string | null = "user-1";
let ownedAgent: Record<string, unknown> | null;
let runs: Record<string, unknown>[];
const getOwnedBackgroundAgentWithTriggers = mock(async () => ownedAgent);
const listBackgroundAgentRuns = mock(async () => runs);

mock.module("next/navigation", () => ({ redirect, notFound }));
mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () =>
    sessionUserId ? { user: { id: sessionUserId } } : null,
}));
mock.module("@/lib/background-agents/store", () => ({
  getOwnedBackgroundAgentWithTriggers,
  listBackgroundAgentRuns,
  listBackgroundAgentOutputs: async () => [],
}));
mock.module("swr", () => ({
  default: () => ({
    data: undefined,
    isLoading: false,
    mutate: async () => {},
  }),
}));

const pageModulePromise = import("./page");

function fixtureAgent() {
  return {
    id: "agent-1",
    userId: "user-1",
    name: "PR reviewer",
    description: null,
    status: "enabled",
    repoOwner: "Acme Org",
    repoName: "widgets/api",
    instructions: "Review changes.",
    permissions: { github: { contents: "read" } },
    checkCommand: null,
    composioToolkitSlugs: [],
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-10T00:00:00.000Z"),
    triggers: [],
  };
}

describe("canonical single-step Automation detail page", () => {
  beforeEach(() => {
    sessionUserId = "user-1";
    ownedAgent = fixtureAgent();
    runs = [
      {
        id: "run-1",
        agentId: "agent-1",
        status: "succeeded",
        triggerKind: "github.pull_request",
        resultSummary: null,
        createdAt: new Date("2026-07-10T01:00:00.000Z"),
      },
    ];
    redirect.mockClear();
    notFound.mockClear();
    getOwnedBackgroundAgentWithTriggers.mockClear();
    listBackgroundAgentRuns.mockClear();
  });

  test("redirects before owner-scoped data access when signed out", async () => {
    sessionUserId = null;
    const { default: AutomationDetailPage } = await pageModulePromise;

    await expect(
      AutomationDetailPage({
        params: Promise.resolve({ agentId: "agent-1" }),
      }),
    ).rejects.toThrow("redirect:/");
    expect(getOwnedBackgroundAgentWithTriggers).not.toHaveBeenCalled();
  });

  test("uses authenticated ownership and returns the same not-found for missing or foreign ids", async () => {
    ownedAgent = null;
    const { default: AutomationDetailPage } = await pageModulePromise;

    await expect(
      AutomationDetailPage({
        params: Promise.resolve({ agentId: "foreign-agent" }),
      }),
    ).rejects.toThrow("not-found");
    expect(getOwnedBackgroundAgentWithTriggers).toHaveBeenCalledWith({
      userId: "user-1",
      agentId: "foreign-agent",
    });
    expect(listBackgroundAgentRuns).not.toHaveBeenCalled();
  });

  test("keeps definition actions in Automations and run evidence in canonical Runs", async () => {
    const { default: AutomationDetailPage } = await pageModulePromise;
    const html = renderToStaticMarkup(
      await AutomationDetailPage({
        params: Promise.resolve({ agentId: "agent-1" }),
      }),
    );

    expect(listBackgroundAgentRuns).toHaveBeenCalledWith({
      userId: "user-1",
      repoOwner: "Acme Org",
      repoName: "widgets/api",
      limit: 20,
    });
    expect(html).toContain("Single-step Automation");
    expect(html).toContain("/automations/background-agent/agent-1/edit");
    expect(html).toContain("/runs/background-agent/run-1");
    expect(html).toContain('href="/automations"');
    expect(html).not.toContain("/background-runs/run-1");
  });
});
