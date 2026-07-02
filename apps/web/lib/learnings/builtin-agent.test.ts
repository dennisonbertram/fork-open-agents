import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ---- Mocks for dependency injection ----

type FakeAgent = {
  id: string;
  userId: string;
  name: string;
  status: "enabled" | "disabled";
  repoOwner: string;
  repoName: string;
  instructions: string;
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
let repoReadinessResult: {
  ready: boolean;
  reason: string | null;
  installationId: number | null;
  repositoryId: number | null;
  defaultBranch: string | null;
  message: string;
  repoOwner: string;
  repoName: string;
  requiredUserPermission: string;
} = {
  ready: true,
  reason: null,
  installationId: 42,
  repositoryId: 100,
  defaultBranch: "main",
  message: "ok",
  repoOwner: "acme",
  repoName: "widgets",
  requiredUserPermission: "write",
};

const createBackgroundAgent = mock(
  async (_userId: string, input: Record<string, unknown>) => {
    const agent: FakeAgent = {
      id: `agent-${createdAgents.length + 1}`,
      userId: _userId,
      name: input.name as string,
      status: input.status as "enabled" | "disabled",
      repoOwner: input.repoOwner as string,
      repoName: input.repoName as string,
      instructions: input.instructions as string,
      triggers: ((input.triggers ?? []) as Array<Record<string, unknown>>).map(
        (t, i) => ({
          id: `trigger-${createdAgents.length + 1}-${i}`,
          agentId: `agent-${createdAgents.length + 1}`,
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

const listRepoBackgroundAgents = mock(async () => {
  // Return whatever is in createdAgents matching the repo
  return createdAgents;
});

const updateBackgroundAgent = mock(
  async (_userId: string, agentId: string, input: Record<string, unknown>) => {
    // Apply the status change to the in-memory array so subsequent
    // listRepoBackgroundAgents calls reflect the updated state
    const agent = createdAgents.find((a) => a.id === agentId);
    if (agent && input.status !== undefined) {
      agent.status = input.status as "enabled" | "disabled";
    }
    return agent ?? null;
  },
);

const getBackgroundAgentRepoReadiness = mock(async () => repoReadinessResult);

mock.module("@/lib/background-agents/store", () => ({
  createBackgroundAgent,
  listRepoBackgroundAgents,
  updateBackgroundAgent,
}));

mock.module("@/lib/background-agents/repo-readiness", () => ({
  getBackgroundAgentRepoReadiness,
}));

const modulePromise = import("./builtin-agent");

describe("ensureRepoLearningsAgent", () => {
  beforeEach(() => {
    createdAgents = [];
    repoReadinessResult = {
      ready: true,
      reason: null,
      installationId: 42,
      repositoryId: 100,
      defaultBranch: "main",
      message: "ok",
      repoOwner: "acme",
      repoName: "widgets",
      requiredUserPermission: "write",
    };
    createBackgroundAgent.mockClear();
    listRepoBackgroundAgents.mockClear();
    updateBackgroundAgent.mockClear();
    getBackgroundAgentRepoReadiness.mockClear();
    listRepoBackgroundAgents.mockImplementation(async () => createdAgents);
  });

  test("creates exactly one agent + trigger set on first call", async () => {
    const { ensureRepoLearningsAgent } = await modulePromise;

    await ensureRepoLearningsAgent("user-1", "acme", "widgets", true);

    expect(createBackgroundAgent).toHaveBeenCalledTimes(1);
    expect(createdAgents).toHaveLength(1);
    const agent = createdAgents[0];
    expect(agent.triggers).toHaveLength(2);
  });

  test("second call is a no-op — does not create a duplicate agent", async () => {
    const { ensureRepoLearningsAgent } = await modulePromise;

    await ensureRepoLearningsAgent("user-1", "acme", "widgets", true);
    await ensureRepoLearningsAgent("user-1", "acme", "widgets", true);

    expect(createBackgroundAgent).toHaveBeenCalledTimes(1);
    expect(createdAgents).toHaveLength(1);
  });

  test("created agent has the builtin marker in instructions", async () => {
    const { ensureRepoLearningsAgent, LEARNINGS_AGENT_MARKER } =
      await modulePromise;

    await ensureRepoLearningsAgent("user-1", "acme", "widgets", true);

    const agent = createdAgents[0];
    expect(agent.instructions).toContain(LEARNINGS_AGENT_MARKER);
  });

  test("isLearningsAgent detects marker in instructions", async () => {
    const { ensureRepoLearningsAgent, isLearningsAgent } = await modulePromise;

    await ensureRepoLearningsAgent("user-1", "acme", "widgets", true);

    const agent = createdAgents[0];
    expect(isLearningsAgent(agent)).toBe(true);
    expect(isLearningsAgent({ instructions: "some other agent" })).toBe(false);
  });

  test("created agent has two triggers with correct kinds", async () => {
    const { ensureRepoLearningsAgent } = await modulePromise;

    await ensureRepoLearningsAgent("user-1", "acme", "widgets", true);

    const agent = createdAgents[0];
    const kinds = agent.triggers.map((t) => t.kind).sort();
    expect(kinds).toEqual(
      ["github.pull_request", "github.pull_request_review"].sort(),
    );
  });

  test("pull_request trigger has conditions actions:closed and mergedOnly:true", async () => {
    const { ensureRepoLearningsAgent } = await modulePromise;

    await ensureRepoLearningsAgent("user-1", "acme", "widgets", true);

    const agent = createdAgents[0];
    const prTrigger = agent.triggers.find(
      (t) => t.kind === "github.pull_request",
    );
    expect(prTrigger).toBeDefined();
    expect(prTrigger?.conditions).toMatchObject({
      actions: ["closed"],
      mergedOnly: true,
    });
  });

  test("pull_request_review trigger has conditions actions:submitted", async () => {
    const { ensureRepoLearningsAgent } = await modulePromise;

    await ensureRepoLearningsAgent("user-1", "acme", "widgets", true);

    const agent = createdAgents[0];
    const reviewTrigger = agent.triggers.find(
      (t) => t.kind === "github.pull_request_review",
    );
    expect(reviewTrigger).toBeDefined();
    expect(reviewTrigger?.conditions).toMatchObject({
      actions: ["submitted"],
    });
  });

  test("created agent defaults to disabled status (default OFF)", async () => {
    const { ensureRepoLearningsAgent } = await modulePromise;

    // Calling with enabled=false creates a disabled agent
    await ensureRepoLearningsAgent("user-1", "acme", "widgets", false);

    const agent = createdAgents[0];
    expect(agent.status).toBe("disabled");
  });

  test("created agent is enabled when enabled=true", async () => {
    const { ensureRepoLearningsAgent } = await modulePromise;

    await ensureRepoLearningsAgent("user-1", "acme", "widgets", true);

    const agent = createdAgents[0];
    expect(agent.status).toBe("enabled");
  });

  test("returns errorKind user_no_write and creates no agent when user lacks write access", async () => {
    repoReadinessResult = {
      ready: false,
      reason: "user_no_write",
      installationId: null,
      repositoryId: null,
      defaultBranch: null,
      message: "You need write access",
      repoOwner: "acme",
      repoName: "widgets",
      requiredUserPermission: "write",
    };
    const { ensureRepoLearningsAgent } = await modulePromise;

    const result = await ensureRepoLearningsAgent(
      "user-1",
      "acme",
      "widgets",
      true,
    );

    expect(result.errorKind).toBe("user_no_write");
    expect(createBackgroundAgent).not.toHaveBeenCalled();
    expect(createdAgents).toHaveLength(0);
  });

  test("returns errorKind no_installation when no GitHub App installation found", async () => {
    repoReadinessResult = {
      ready: false,
      reason: "no_installation",
      installationId: null,
      repositoryId: null,
      defaultBranch: null,
      message: "GitHub App not installed",
      repoOwner: "acme",
      repoName: "widgets",
      requiredUserPermission: "write",
    };
    const { ensureRepoLearningsAgent } = await modulePromise;

    const result = await ensureRepoLearningsAgent(
      "user-1",
      "acme",
      "widgets",
      true,
    );

    expect(result.errorKind).toBe("no_installation");
    expect(createBackgroundAgent).not.toHaveBeenCalled();
  });
});

describe("disableRepoLearningsAgent", () => {
  beforeEach(() => {
    createdAgents = [];
    repoReadinessResult = {
      ready: true,
      reason: null,
      installationId: 42,
      repositoryId: 100,
      defaultBranch: "main",
      message: "ok",
      repoOwner: "acme",
      repoName: "widgets",
      requiredUserPermission: "write",
    };
    createBackgroundAgent.mockClear();
    listRepoBackgroundAgents.mockClear();
    updateBackgroundAgent.mockClear();
    getBackgroundAgentRepoReadiness.mockClear();
    listRepoBackgroundAgents.mockImplementation(async () => createdAgents);
  });

  test("disable flips status to disabled non-destructively (no row deletion)", async () => {
    const { ensureRepoLearningsAgent, disableRepoLearningsAgent } =
      await modulePromise;

    // First enable
    await ensureRepoLearningsAgent("user-1", "acme", "widgets", true);
    const agentId = createdAgents[0].id;
    expect(createdAgents[0].status).toBe("enabled");

    // Then disable
    await disableRepoLearningsAgent("user-1", "acme", "widgets");

    // Agent row still exists (non-destructive) but status is disabled
    expect(createdAgents).toHaveLength(1);
    expect(createdAgents[0].id).toBe(agentId);
    expect(createdAgents[0].status).toBe("disabled");
  });

  test("re-enable after disable reuses the same agent row id", async () => {
    const { ensureRepoLearningsAgent, disableRepoLearningsAgent } =
      await modulePromise;

    await ensureRepoLearningsAgent("user-1", "acme", "widgets", true);
    const originalId = createdAgents[0].id;

    await disableRepoLearningsAgent("user-1", "acme", "widgets");
    await ensureRepoLearningsAgent("user-1", "acme", "widgets", true);

    // Still exactly one agent, same id
    expect(createdAgents).toHaveLength(1);
    expect(createdAgents[0].id).toBe(originalId);
    // createBackgroundAgent still called only once total
    expect(createBackgroundAgent).toHaveBeenCalledTimes(1);
  });
});
