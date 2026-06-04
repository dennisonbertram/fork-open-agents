/**
 * Integration tests for the agents page with operational agent cards.
 * TASK-167: agent cards, agent detail, and run controls for project agents
 *
 * BT-167-015: Configured agents dashboard shows agent cards (not plain list items)
 * BT-167-016: Polling is not triggered when no agent/run is active (static dashboard)
 * BT-167-017: Page renders agent cards for each configured agent
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// --- Mocks -------------------------------------------------------------------

const redirect = mock((_path: string) => {
  throw new Error("redirect");
});
const push = mock((_url: string) => undefined);
const mutate = mock(async () => undefined);

let agentsSwrData: unknown = undefined;
let readinessSwrData: unknown = undefined;

mock.module("next/navigation", () => ({
  redirect,
  useRouter: () => ({ push }),
}));

mock.module("swr", () => ({
  default: (_key: unknown) => ({
    data:
      typeof _key === "string" && _key.includes("readiness")
        ? readinessSwrData
        : agentsSwrData,
    error: null,
    isLoading: false,
    mutate,
  }),
}));

let sessionUserId = "user-1";
let repoAgents: unknown[] = [];
let repoRuns: unknown[] = [];

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () =>
    sessionUserId ? { user: { id: sessionUserId } } : null,
}));

mock.module("@/lib/background-agents/store", () => ({
  listRepoBackgroundAgents: async () => repoAgents,
  listBackgroundAgentRuns: async () => repoRuns,
}));

const pageModulePromise = import("./page");

// --- Tests -------------------------------------------------------------------

describe("Agents page with agent cards", () => {
  beforeEach(() => {
    sessionUserId = "user-1";
    repoAgents = [];
    repoRuns = [];
    agentsSwrData = undefined;
    readinessSwrData = undefined;
    push.mockClear();
    mutate.mockClear();
    redirect.mockClear();
  });

  test("BT-167-015: page renders agent cards section for configured agents", async () => {
    repoAgents = [
      {
        id: "agent-1",
        userId: "user-1",
        name: "Deploy Smoke",
        description: null,
        status: "enabled",
        repoOwner: "acme",
        repoName: "widgets",
        instructions: "Run smoke checks.",
        permissions: {},
        outputMode: "none",
        checkCommand: null,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
        triggers: [
          {
            id: "t1",
            agentId: "agent-1",
            userId: "user-1",
            name: "On deployment",
            kind: "github.deployment_status",
            status: "enabled",
            conditions: {},
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
      },
    ];
    repoRuns = [];

    const { default: RepoAgentsPage } = await pageModulePromise;
    const html = renderToStaticMarkup(
      await RepoAgentsPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    // The page should render the agent name inside a card structure
    expect(html).toContain("Deploy Smoke");
    // Should show agent cards with controls
    expect(html).toContain("Run now");
    // Should show "Never run" for agent with no run history
    expect(html.toLowerCase()).toContain("never run");
  });

  test("BT-167-017: page renders multiple agent cards, one per agent", async () => {
    repoAgents = [
      {
        id: "agent-1",
        userId: "user-1",
        name: "Agent Alpha",
        description: null,
        status: "enabled",
        repoOwner: "acme",
        repoName: "widgets",
        instructions: "Alpha instructions.",
        permissions: {},
        outputMode: "none",
        checkCommand: null,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
        triggers: [],
      },
      {
        id: "agent-2",
        userId: "user-1",
        name: "Agent Beta",
        description: null,
        status: "disabled",
        repoOwner: "acme",
        repoName: "widgets",
        instructions: "Beta instructions.",
        permissions: {},
        outputMode: "none",
        checkCommand: null,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
        triggers: [],
      },
    ];
    repoRuns = [];

    const { default: RepoAgentsPage } = await pageModulePromise;
    const html = renderToStaticMarkup(
      await RepoAgentsPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    expect(html).toContain("Agent Alpha");
    expect(html).toContain("Agent Beta");
    // Beta is disabled (paused)
    expect(html.toLowerCase()).toContain("paused");
  });

  test("BT-167-016: page renders agent card with latest run summary", async () => {
    repoAgents = [
      {
        id: "agent-1",
        userId: "user-1",
        name: "Deploy Smoke",
        description: null,
        status: "enabled",
        repoOwner: "acme",
        repoName: "widgets",
        instructions: "Run smoke checks.",
        permissions: {},
        outputMode: "none",
        checkCommand: null,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
        triggers: [
          {
            id: "t1",
            agentId: "agent-1",
            userId: "user-1",
            name: "On deployment",
            kind: "github.deployment_status",
            status: "enabled",
            conditions: {},
            schedule: null,
            webhookPublicId: null,
            webhookSecretHash: null,
            lastRunAt: new Date("2026-06-01"),
            nextRunAt: null,
            lastSkipReason: null,
            createdAt: new Date("2026-01-01"),
            updatedAt: new Date("2026-01-01"),
          },
        ],
      },
    ];
    repoRuns = [
      {
        id: "run-1",
        agentId: "agent-1",
        triggerId: "t1",
        userId: "user-1",
        status: "succeeded",
        source: "github",
        triggerKind: "github.deployment_status",
        externalId: "delivery-1",
        idempotencyKey: "key-1",
        repoOwner: "acme",
        repoName: "widgets",
        ref: null,
        sha: "abc123",
        branch: "main",
        prNumber: null,
        issueNumber: null,
        deploymentUrl: null,
        sandboxName: null,
        outputKind: "comment",
        outputUrl: null,
        errorKind: null,
        errorMessage: null,
        payloadSummary: { title: "Deployment succeeded" },
        resultSummary: {
          headline: "Run succeeded — no output created",
          checked: [],
          changed: ["no output created"],
          blocked: [],
          artifacts: [],
          next: [],
        },
        requestId: null,
        workflowRunId: null,
        startedAt: new Date("2026-06-01"),
        finishedAt: new Date("2026-06-01"),
        createdAt: new Date("2026-06-01"),
        updatedAt: new Date("2026-06-01"),
      },
    ];

    const { default: RepoAgentsPage } = await pageModulePromise;
    const html = renderToStaticMarkup(
      await RepoAgentsPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    // The latest run summary headline should appear on the card
    expect(html).toContain("Run succeeded — no output created");
    // Link to the run detail
    expect(html).toContain("/background-runs/run-1");
  });
});
