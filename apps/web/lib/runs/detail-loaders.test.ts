import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const getOwnedBackgroundAgentRunWithAgent = mock(
  async (): Promise<unknown> => undefined,
);
const listBackgroundAgentEvents = mock(async (): Promise<unknown[]> => []);
const listBackgroundAgentOutputs = mock(async (): Promise<unknown[]> => []);
const getOwnedAgentLoopRunWithLoop = mock(
  async (): Promise<unknown> => undefined,
);
const getAgentLoopRunWithLoop = mock(async (): Promise<unknown> => undefined);
const listAgentLoopComposioEvents = mock(async (): Promise<unknown[]> => []);
const listAgentLoopEvents = mock(async (): Promise<unknown[]> => []);
const listStepRunsForRun = mock(async (): Promise<unknown[]> => []);
const listWatchdogRunsForLoopRun = mock(async (): Promise<unknown[]> => []);

mock.module("@/lib/background-agents/store", () => ({
  getOwnedBackgroundAgentRunWithAgent,
  listBackgroundAgentEvents,
  listBackgroundAgentOutputs,
}));

mock.module("@/lib/agent-loops/store", () => ({
  getOwnedAgentLoopRunWithLoop,
  getAgentLoopRunWithLoop,
  listAgentLoopComposioEvents,
  listAgentLoopEvents,
  listStepRunsForRun,
  listWatchdogRunsForLoopRun,
}));

const loadersModule = import("./detail-loaders");

beforeEach(() => {
  getOwnedBackgroundAgentRunWithAgent.mockReset();
  getOwnedBackgroundAgentRunWithAgent.mockResolvedValue(undefined);
  listBackgroundAgentEvents.mockReset();
  listBackgroundAgentEvents.mockResolvedValue([]);
  listBackgroundAgentOutputs.mockReset();
  listBackgroundAgentOutputs.mockResolvedValue([]);
  getAgentLoopRunWithLoop.mockReset();
  getAgentLoopRunWithLoop.mockResolvedValue(undefined);
  getOwnedAgentLoopRunWithLoop.mockReset();
  getOwnedAgentLoopRunWithLoop.mockResolvedValue(undefined);
  listAgentLoopComposioEvents.mockReset();
  listAgentLoopComposioEvents.mockResolvedValue([]);
  listAgentLoopEvents.mockReset();
  listAgentLoopEvents.mockResolvedValue([]);
  listStepRunsForRun.mockReset();
  listStepRunsForRun.mockResolvedValue([]);
  listWatchdogRunsForLoopRun.mockReset();
  listWatchdogRunsForLoopRun.mockResolvedValue([]);
});

describe("owned Run detail loaders", () => {
  test("missing background ids return one null result without probing child evidence", async () => {
    const { loadOwnedBackgroundRunDetail } = await loadersModule;

    const result = await loadOwnedBackgroundRunDetail({
      userId: "user-1",
      runId: "missing-or-not-owned",
    });

    expect(result).toBeNull();
    expect(listBackgroundAgentEvents).not.toHaveBeenCalled();
    expect(listBackgroundAgentOutputs).not.toHaveBeenCalled();
  });

  test("wrong-user loop ids return the same null result without probing child evidence", async () => {
    const { loadOwnedLoopRunDetail } = await loadersModule;

    const result = await loadOwnedLoopRunDetail({
      userId: "user-1",
      runId: "run-1",
    });

    expect(result).toBeNull();
    expect(getOwnedAgentLoopRunWithLoop).toHaveBeenCalledWith({
      userId: "user-1",
      runId: "run-1",
    });
    expect(getAgentLoopRunWithLoop).not.toHaveBeenCalled();
    expect(listAgentLoopComposioEvents).not.toHaveBeenCalled();
    expect(listAgentLoopEvents).not.toHaveBeenCalled();
    expect(listStepRunsForRun).not.toHaveBeenCalled();
    expect(listWatchdogRunsForLoopRun).not.toHaveBeenCalled();
  });

  test("owned loop first render merges source-scoped Composio evidence like the poll API", async () => {
    getOwnedAgentLoopRunWithLoop.mockResolvedValue({
      run: { id: "run-1", userId: "user-1" },
      loop: {
        id: "loop-1",
        name: "Release",
        repoOwner: "acme",
        repoName: "shop",
        guardrails: null,
      },
    });
    listAgentLoopEvents.mockResolvedValue([{ id: "event-1" }]);
    listAgentLoopComposioEvents.mockResolvedValue([{ id: "composio-1" }]);
    const { loadOwnedLoopRunDetail } = await loadersModule;

    const result = await loadOwnedLoopRunDetail({
      userId: "user-1",
      runId: "run-1",
    });

    expect(result?.events.map((event) => event.id)).toEqual([
      "event-1",
      "composio-1",
    ]);
    expect(listAgentLoopComposioEvents).toHaveBeenCalledWith("run-1");
  });
});
