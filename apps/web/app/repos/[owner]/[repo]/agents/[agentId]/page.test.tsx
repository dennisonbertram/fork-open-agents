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
import { DEFAULT_ON_TOOL_NAMES } from "@/lib/background-agents/builtin-toolpack";

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
      outputMode: "comment",
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
        outputKind: "comment",
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

    // Artifacts from the run's resultSummary
    expect(html.toLowerCase()).toMatch(/artifact|output/);
    // The comment artifact URL should appear
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

  test("BT-167-015: renders Standard toolpack summary and derived GitHub scope for outputMode ready_pr", async () => {
    mockAgent = {
      ...(mockAgent as Record<string, unknown>),
      outputMode: "ready_pr",
      builtinToolNames: ["read", "bash"],
      composioToolkitSlugs: ["linear"],
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

    // Standard toolpack lists the persisted builtinToolNames verbatim
    expect(html).toContain("Standard toolpack");
    expect(html).toContain("read, bash");
    // GitHub scope is derived via resolveGitHubToolConfig, which migrates a
    // legacy outputMode:"ready_pr" agent (no persisted enabledActions) to
    // the agreed default action set — open_pull_request + comment.
    expect(html).toContain("Open pull request");
    expect(html).toContain("Comment on PR or issue");
    // Composio toolkit slugs are still shown
    expect(html).toContain("linear");
  });

  test("BT-167-016: shows default toolpack copy and read-only GitHub scope when builtinToolNames is null and outputMode is none", async () => {
    mockAgent = {
      ...(mockAgent as Record<string, unknown>),
      outputMode: "none",
      builtinToolNames: null,
      composioToolkitSlugs: [],
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

    // Null builtinToolNames means the agent is on the default toolpack
    expect(html).toContain("default toolpack (web_fetch off)");
    // outputMode "none" is not ready_pr, so GitHub is read-only, no PR copy
    expect(html.toLowerCase()).toContain("read-only");
    expect(html.toLowerCase()).not.toContain("open pull requests");
  });

  test("REG-167-001: GitHub scope stays derived from outputMode alone, even when a legacy saved permission says write for a Report-only agent", async () => {
    // Guards against re-introducing the agent-spec.ts:190-199-style
    // two-control coupling bug (fixed in step-2) at the display layer: a
    // legacy agent.permissions.github.contents of "write" must NOT make
    // the detail page claim PR-opening access for a Report-only agent.
    mockAgent = {
      ...(mockAgent as Record<string, unknown>),
      outputMode: "none",
      permissions: { github: { contents: "write", pullRequests: "write" } },
      builtinToolNames: null,
      composioToolkitSlugs: [],
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

    expect(html.toLowerCase()).toContain("read-only");
    expect(html.toLowerCase()).not.toContain("open pull requests");
  });

  test("REG-167-002: does not render an 'Other tools (Composio)' line when composioToolkitSlugs is empty", async () => {
    mockAgent = {
      ...(mockAgent as Record<string, unknown>),
      outputMode: "none",
      builtinToolNames: null,
      composioToolkitSlugs: [],
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

    expect(html).not.toContain("Other tools (Composio)");
  });

  test("REG-721-fix1: the detail page's 'default toolpack (web_fetch off)' claim for a null builtinToolNames agent matches the shared DEFAULT_ON_TOOL_NAMES preset the executor actually runs with", async () => {
    // Guards the executor/detail-page consistency fixed in the
    // adversarial-review must-fix finding: the page's null-case copy is a
    // literal string, not derived from DEFAULT_ON_TOOL_NAMES. This test
    // pins DEFAULT_ON_TOOL_NAMES to exclude web_fetch so a future change to
    // the shared preset (e.g. someone adding web_fetch back to the default)
    // is caught here, not just at the executor layer — see the paired
    // executor.test.ts REG-721-fix1 test for the runtime-side half of this
    // invariant.
    mockAgent = {
      ...(mockAgent as Record<string, unknown>),
      outputMode: "none",
      builtinToolNames: null,
      composioToolkitSlugs: [],
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

    expect(html).toContain("default toolpack (web_fetch off)");
    const defaultOnToolNames: readonly string[] = DEFAULT_ON_TOOL_NAMES;
    expect(defaultOnToolNames.includes("web_fetch")).toBe(false);
  });

  // --- (A5) Write-scope summary ---------------------------------------------

  test("(A5) shows 'this repo' scope for a ready_pr agent with no persisted writeScopeMode (legacy default)", async () => {
    mockAgent = {
      ...(mockAgent as Record<string, unknown>),
      outputMode: "ready_pr",
      permissions: { github: { contents: "write", pullRequests: "write" } },
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

    expect(html).toContain("Open pull request");
    expect(html.toLowerCase()).toContain("repo scope: this repo");
  });

  test("(A5) shows the resolved repo count for a ready_pr agent with writeScopeMode 'repo_list'", async () => {
    mockAgent = {
      ...(mockAgent as Record<string, unknown>),
      outputMode: "ready_pr",
      permissions: {
        github: {
          contents: "write",
          pullRequests: "write",
          writeScopeMode: "repo_list",
          writeScopeRepos: ["acme/other-a", "acme/other-b"],
        },
      },
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

    // 2 selected repos + the home repo = 3 repos in scope.
    expect(html).toContain("3 repos");
  });

  test("(A5) shows 'all repos your installation can reach' for a ready_pr agent with writeScopeMode 'all_repos'", async () => {
    mockAgent = {
      ...(mockAgent as Record<string, unknown>),
      outputMode: "ready_pr",
      permissions: {
        github: {
          contents: "write",
          pullRequests: "write",
          writeScopeMode: "all_repos",
        },
      },
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

    expect(html.toLowerCase()).toContain(
      "all repos your installation can reach",
    );
  });

  test("(TASK-740) new-model agent with enabledActions:['merge_pull_request'] and requireCiGreenToMerge:false renders the action label and an irreversible/CI-gate-off indicator", async () => {
    mockAgent = {
      ...(mockAgent as Record<string, unknown>),
      outputMode: "none",
      permissions: {
        github: {
          enabledActions: ["merge_pull_request"],
          requireCiGreenToMerge: false,
        },
      },
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

    expect(html).toContain("Merge pull request");
    expect(html.toLowerCase()).toContain("irreversible");
    // No bare agent.outputMode string should ever be displayed directly.
    expect(html).not.toMatch(/Output mode/);
  });

  test("REG-A5-001: a Report-only (non ready_pr) agent never shows a write-scope repo count, even with a stale persisted writeScopeMode", async () => {
    // Guards against re-displaying a legacy/stale writeScopeMode for a
    // report-only agent — buildAgentPayload (TASK-A3) already forces
    // writeScopeMode back to "this_repo" on save for non-ready_pr agents, but
    // a pre-existing DB row saved before that fix could still carry a
    // broader value; the display layer must not surface it as if it were
    // still meaningful.
    mockAgent = {
      ...(mockAgent as Record<string, unknown>),
      outputMode: "none",
      permissions: {
        github: {
          contents: "read",
          writeScopeMode: "all_repos",
          writeScopeRepos: ["acme/other-a"],
        },
      },
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

    expect(html.toLowerCase()).not.toContain("all repos your installation");
    expect(html).not.toContain("2 repos");
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
});
