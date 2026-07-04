/**
 * Tests for Agent Detail page — /repos/:owner/:repo/agents/:agentId
 * TASK-167: agent cards, agent detail, and run controls for project agents
 *
 * Behavioral tests:
 * BT-167-010: Agent detail renders purpose/trigger/permissions sections
 * BT-167-011: Agent detail renders recent runs with summaries (NOT a chat transcript)
 * BT-167-012: Agent detail has links to raw run timelines (/background-runs/:runId)
 * BT-167-013: Agent detail renders artifacts section
 * BT-167-014: Agent detail renders current state (enabled/disabled)
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// --- Mocks -------------------------------------------------------------------

const redirect = mock((_path: string) => {
  throw new Error("redirect");
});

mock.module("next/navigation", () => ({
  redirect,
  useRouter: () => ({ push: () => undefined }),
}));

mock.module("swr", () => ({
  default: () => ({
    data: undefined,
    error: null,
    isLoading: false,
    mutate: async () => undefined,
  }),
}));

let sessionUserId: string | null = "user-1";
mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () =>
    sessionUserId ? { user: { id: sessionUserId } } : null,
}));

let mockAgent: unknown = null;
let mockRuns: unknown[] = [];

mock.module("@/lib/background-agents/store", () => ({
  getOwnedBackgroundAgentWithTriggers: async () => mockAgent,
  listBackgroundAgentRuns: async () => mockRuns,
  listRepoBackgroundAgents: async () => [],
  listBackgroundAgentOutputs: async () => [],
}));

// --- Setup -------------------------------------------------------------------

const pageModulePromise = import("./page");

describe("AgentDetailPage", () => {
  beforeEach(() => {
    sessionUserId = "user-1";
    redirect.mockClear();
    mockAgent = {
      id: "agent-1",
      userId: "user-1",
      name: "Deploy Smoke",
      description: "Validates deployments.",
      status: "enabled",
      repoOwner: "acme",
      repoName: "widgets",
      instructions: "Run smoke checks after each deployment to production.",
      permissions: { github: { contents: "read" } },
      checkCommand: null,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
      triggers: [
        {
          id: "trigger-1",
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
    };
    mockRuns = [
      {
        id: "run-1",
        agentId: "agent-1",
        triggerId: "trigger-1",
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
        outputUrl: "https://github.com/acme/widgets/issues/1#comment-1",
        errorKind: null,
        errorMessage: null,
        payloadSummary: { title: "Production deployment succeeded" },
        resultSummary: {
          headline: "Run succeeded — created comment",
          checked: ["Smoke tests passed"],
          changed: [],
          blocked: [],
          artifacts: [
            {
              kind: "comment",
              label: "comment",
              url: "https://github.com/acme/widgets/issues/1#comment-1",
              prNumber: null,
            },
          ],
          next: [],
          warnings: [],
        },
        requestId: null,
        workflowRunId: null,
        startedAt: new Date("2026-06-01T12:00:00Z"),
        finishedAt: new Date("2026-06-01T12:05:00Z"),
        createdAt: new Date("2026-06-01T12:00:00Z"),
        updatedAt: new Date("2026-06-01T12:05:00Z"),
      },
    ];
  });

  test("BT-167-010: renders agent name, purpose/instructions, trigger, permissions, and current state", async () => {
    const { default: AgentDetailPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await AgentDetailPage({
        params: Promise.resolve({
          owner: "acme",
          repo: "widgets",
          agentId: "agent-1",
        }),
      }),
    );

    // Name
    expect(html).toContain("Deploy Smoke");
    // Instructions / purpose section
    expect(html).toContain("Run smoke checks after each deployment");
    // Trigger section
    expect(html).toContain("deployment_status");
    // Permissions section
    expect(html).toContain("contents");
    // Current state — enabled
    expect(html.toLowerCase()).toContain("enabled");
  });

  test("BT-167-011: renders recent runs with result summary headlines (not chat transcript)", async () => {
    const { default: AgentDetailPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await AgentDetailPage({
        params: Promise.resolve({
          owner: "acme",
          repo: "widgets",
          agentId: "agent-1",
        }),
      }),
    );

    // Should show the run headline from resultSummary
    expect(html).toContain("Run succeeded — created comment");
    // Must NOT look like a chat transcript (no message bubbles, no "You said")
    expect(html).not.toContain("You said");
    expect(html).not.toContain("message-bubble");
    expect(html).not.toContain("Assistant:");
  });

  test("BT-167-012: renders links to raw run timelines (/background-runs/:runId)", async () => {
    const { default: AgentDetailPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await AgentDetailPage({
        params: Promise.resolve({
          owner: "acme",
          repo: "widgets",
          agentId: "agent-1",
        }),
      }),
    );

    expect(html).toContain("/background-runs/run-1");
  });

  test("BT-167-013: renders artifacts section with output links", async () => {
    const { default: AgentDetailPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await AgentDetailPage({
        params: Promise.resolve({
          owner: "acme",
          repo: "widgets",
          agentId: "agent-1",
        }),
      }),
    );

    // Artifacts from the run's resultSummary — the comment artifact URL
    // should appear as a link.
    expect(html).toContain(
      "https://github.com/acme/widgets/issues/1#comment-1",
    );
    expect(html).toContain("comment");
  });

  test("BT-167-014: shows current state as 'Paused' when agent is disabled", async () => {
    mockAgent = {
      ...(mockAgent as Record<string, unknown>),
      status: "disabled",
    };
    const { default: AgentDetailPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await AgentDetailPage({
        params: Promise.resolve({
          owner: "acme",
          repo: "widgets",
          agentId: "agent-1",
        }),
      }),
    );

    expect(html.toLowerCase()).toContain("paused");
  });

  test("redirects to / when not authenticated", async () => {
    sessionUserId = null;
    const { default: AgentDetailPage } = await pageModulePromise;

    await expect(
      AgentDetailPage({
        params: Promise.resolve({
          owner: "acme",
          repo: "widgets",
          agentId: "agent-1",
        }),
      }),
    ).rejects.toThrow("redirect");

    expect(redirect).toHaveBeenCalledWith("/");
  });

  test("redirects to agents list when agent not found", async () => {
    mockAgent = null;
    const { default: AgentDetailPage } = await pageModulePromise;

    await expect(
      AgentDetailPage({
        params: Promise.resolve({
          owner: "acme",
          repo: "widgets",
          agentId: "missing-agent",
        }),
      }),
    ).rejects.toThrow("redirect");

    expect(redirect).toHaveBeenCalledWith("/repos/acme/widgets/agents");
  });

  test("renders a 'Runs' section header (not 'Chat history')", async () => {
    const { default: AgentDetailPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await AgentDetailPage({
        params: Promise.resolve({
          owner: "acme",
          repo: "widgets",
          agentId: "agent-1",
        }),
      }),
    );

    // Should have a runs section
    expect(html).toMatch(/Runs|Recent runs/i);
    // Must NOT be a chat transcript
    expect(html.toLowerCase()).not.toContain("chat history");
    expect(html.toLowerCase()).not.toContain("conversation");
  });

  // #863: this page's trigger/run timestamps must render in the SAME
  // explicit, labeled UTC treatment as the agent list and schedule card, so
  // the same instant never shows two different wall-clock times.
  test("BT-863: run createdAt and trigger lastRunAt render via the shared UTC-labeled formatter", async () => {
    (
      mockAgent as { triggers: Array<Record<string, unknown>> }
    ).triggers[0]!.lastRunAt = new Date("2026-07-03T21:20:00Z");
    (mockRuns[0] as Record<string, unknown>).createdAt = new Date(
      "2026-07-03T21:20:00Z",
    );

    const { default: AgentDetailPage } = await pageModulePromise;

    const html = renderToStaticMarkup(
      await AgentDetailPage({
        params: Promise.resolve({
          owner: "acme",
          repo: "widgets",
          agentId: "agent-1",
        }),
      }),
    );

    expect(html).toContain("Jul 3, 2026, 9:20 PM UTC");
  });
});
