/**
 * Regression tests for builtin-agent.ts and related wiring (TASK-274).
 *
 * Each test catches a specific scenario that would fail if the implementation
 * in 86166f7f were reverted or key behaviors were silently broken.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ---- Import real isLearningsAgent / LEARNINGS_AGENT_MARKER ----
const modulePromise = import("./builtin-agent");

describe("REGRESSION: LEARNINGS_AGENT_MARKER and isLearningsAgent", () => {
  test("marker is a non-empty string — changing it would break existing rows", async () => {
    const { LEARNINGS_AGENT_MARKER } = await modulePromise;
    expect(typeof LEARNINGS_AGENT_MARKER).toBe("string");
    expect(LEARNINGS_AGENT_MARKER.length).toBeGreaterThan(0);
    expect(LEARNINGS_AGENT_MARKER).toContain("[builtin:");
  });

  test("isLearningsAgent returns false for arbitrary instructions", async () => {
    const { isLearningsAgent } = await modulePromise;
    expect(isLearningsAgent({ instructions: "" })).toBe(false);
    expect(
      isLearningsAgent({ instructions: "Fix the failing smoke check." }),
    ).toBe(false);
    expect(
      isLearningsAgent({ instructions: "Instructions with [builtin:other]" }),
    ).toBe(false);
  });

  test("isLearningsAgent returns true when instructions contain the exact marker", async () => {
    const { isLearningsAgent, LEARNINGS_AGENT_MARKER } = await modulePromise;
    expect(
      isLearningsAgent({
        instructions: `${LEARNINGS_AGENT_MARKER} Do stuff`,
      }),
    ).toBe(true);
  });
});

// ---- Mocks for store/readiness ----
type FakeAgent = {
  id: string;
  userId: string;
  name: string;
  status: "enabled" | "disabled";
  repoOwner: string;
  repoName: string;
  instructions: string;
  outputMode: string;
  triggers: FakeTrigger[];
};

type FakeTrigger = {
  id: string;
  agentId: string;
  kind: string;
  status: "enabled" | "disabled";
  conditions: Record<string, unknown>;
};

let createdAgents: FakeAgent[] = [];

const createBackgroundAgent = mock(
  async (_userId: string, input: Record<string, unknown>) => {
    const agent: FakeAgent = {
      id: `agent-r-${createdAgents.length + 1}`,
      userId: _userId,
      name: input.name as string,
      status: input.status as "enabled" | "disabled",
      repoOwner: input.repoOwner as string,
      repoName: input.repoName as string,
      instructions: input.instructions as string,
      outputMode: input.outputMode as string,
      triggers: ((input.triggers ?? []) as Array<Record<string, unknown>>).map(
        (t, i) => ({
          id: `trigger-r-${createdAgents.length + 1}-${i}`,
          agentId: `agent-r-${createdAgents.length + 1}`,
          kind: t.kind as string,
          status: t.status as "enabled" | "disabled",
          conditions: t.conditions as Record<string, unknown>,
        }),
      ),
    };
    createdAgents.push(agent);
    return agent;
  },
);

const updateBackgroundAgent = mock(
  async (_userId: string, agentId: string, input: Record<string, unknown>) => {
    const agent = createdAgents.find((a) => a.id === agentId);
    if (agent && input.status !== undefined) {
      agent.status = input.status as "enabled" | "disabled";
    }
    return agent ?? null;
  },
);

mock.module("@/lib/background-agents/store", () => ({
  createBackgroundAgent,
  listRepoBackgroundAgents: mock(async () => createdAgents),
  updateBackgroundAgent,
}));

mock.module("@/lib/background-agents/repo-readiness", () => ({
  getBackgroundAgentRepoReadiness: mock(async () => ({
    ready: true,
    reason: null,
    installationId: 42,
    repositoryId: 100,
    defaultBranch: "main",
    message: "ok",
    repoOwner: "acme",
    repoName: "widgets",
    requiredUserPermission: "write",
  })),
}));

describe("REGRESSION: ensureRepoLearningsAgent idempotency", () => {
  beforeEach(() => {
    createdAgents = [];
    createBackgroundAgent.mockClear();
    updateBackgroundAgent.mockClear();
  });

  test("three calls still produce only one agent row", async () => {
    const { ensureRepoLearningsAgent } = await modulePromise;

    await ensureRepoLearningsAgent("user-1", "acme", "widgets", true);
    await ensureRepoLearningsAgent("user-1", "acme", "widgets", true);
    await ensureRepoLearningsAgent("user-1", "acme", "widgets", true);

    expect(createBackgroundAgent).toHaveBeenCalledTimes(1);
    expect(createdAgents).toHaveLength(1);
  });

  test("enabled flag false creates a disabled agent", async () => {
    const { ensureRepoLearningsAgent } = await modulePromise;

    const result = await ensureRepoLearningsAgent(
      "user-1",
      "acme",
      "widgets",
      false,
    );

    expect(result.errorKind).toBeUndefined();
    expect(createdAgents[0]?.status).toBe("disabled");
  });

  test("agent has exactly 2 triggers (PR + review) — revert would break dispatch", async () => {
    const { ensureRepoLearningsAgent } = await modulePromise;

    await ensureRepoLearningsAgent("user-1", "acme", "widgets", true);

    const agent = createdAgents[0];
    expect(agent.triggers).toHaveLength(2);
    const kinds = agent.triggers.map((t) => t.kind).sort();
    expect(kinds).toEqual(
      ["github.pull_request", "github.pull_request_review"].sort(),
    );
  });

  test("PR trigger has mergedOnly:true — revert would extract unmerged PRs", async () => {
    const { ensureRepoLearningsAgent } = await modulePromise;

    await ensureRepoLearningsAgent("user-1", "acme", "widgets", true);

    const prTrigger = createdAgents[0]?.triggers.find(
      (t) => t.kind === "github.pull_request",
    );
    expect(prTrigger?.conditions).toMatchObject({ mergedOnly: true });
  });
});

// ---- Regression: mergedOnly matching ----
describe("REGRESSION: mergedOnly condition in trigger matching", () => {
  test("mergedOnly:true blocks non-merged event — revert would dispatch on close without merge", async () => {
    const { triggerMatchesEvent } =
      await import("../background-agents/matching");
    const closedEvent = {
      source: "github" as const,
      kind: "github.pull_request" as const,
      externalId: "pr:99",
      repoOwner: "o",
      repoName: "r",
      action: "closed",
      merged: false,
    };

    expect(
      triggerMatchesEvent(
        { conditions: { actions: ["closed"], mergedOnly: true } },
        closedEvent,
      ),
    ).toBe(false);
  });

  test("mergedOnly:true allows merged event — revert would skip the extraction path", async () => {
    const { triggerMatchesEvent } =
      await import("../background-agents/matching");
    const mergedEvent = {
      source: "github" as const,
      kind: "github.pull_request" as const,
      externalId: "pr:100",
      repoOwner: "o",
      repoName: "r",
      action: "closed",
      merged: true,
    };

    expect(
      triggerMatchesEvent(
        { conditions: { actions: ["closed"], mergedOnly: true } },
        mergedEvent,
      ),
    ).toBe(true);
  });
});

// ---- Regression: pull_request_review in requiredGitHubAppEvents ----
describe("REGRESSION: pull_request_review in required events", () => {
  test("missing pull_request_review subscription is reported as missing — revert would silently skip", async () => {
    const { LEARNINGS_AGENT_MARKER } = await modulePromise;
    // Marker exists (sanity); the real regression is in github-app-webhooks.ts
    expect(LEARNINGS_AGENT_MARKER).toBeTruthy();

    // Verify the requiredGitHubAppEvents array includes pull_request_review
    // by checking that the webhooks module is importable and the check works
    mock.module("server-only", () => ({}));
    mock.module("@/lib/github/app", () => ({
      getAppOctokit: () => ({
        request: async () => ({
          data: {
            slug: "test-app",
            events: ["pull_request", "issues", "deployment_status"], // missing pull_request_review
            permissions: {
              contents: "write",
              pull_requests: "write",
              issues: "read",
              deployments: "read",
              statuses: "read",
              metadata: "read",
            },
          },
        }),
      }),
    }));

    process.env.GITHUB_APP_ID = "123";
    process.env.GITHUB_APP_PRIVATE_KEY = "pk";
    process.env.GITHUB_WEBHOOK_SECRET = "ws";
    process.env.NEXT_PUBLIC_GITHUB_APP_SLUG = "slug";

    const { getGitHubAppWebhookReadinessCheck } =
      await import("../background-agents/github-app-webhooks");
    const check = await getGitHubAppWebhookReadinessCheck();
    expect(check.missing).toContain("event:pull_request_review");

    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    delete process.env.GITHUB_WEBHOOK_SECRET;
    delete process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;
  });
});
