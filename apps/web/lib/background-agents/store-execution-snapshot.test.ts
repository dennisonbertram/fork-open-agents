import { beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  BackgroundAgent,
  BackgroundAgentRun,
  BackgroundAgentTrigger,
} from "@/lib/db/schema";

mock.module("server-only", () => ({}));

let insertedRunValues: Record<string, unknown> | null = null;
let persistedRun: Record<string, unknown> | null = null;
let runInsertWins = true;
const recordedEvents: Array<Record<string, unknown>> = [];

const db = {
  insert: (_table: unknown) => ({
    values: (values: Record<string, unknown>) => {
      const isEvent = typeof values.eventName === "string";
      if (isEvent) recordedEvents.push(values);
      else insertedRunValues = values;
      return {
        onConflictDoNothing: () => ({
          returning: async () => {
            if (isEvent) return [{ ...values, sequence: 1 }];
            if (!runInsertWins) return [];
            persistedRun = values;
            return [values];
          },
        }),
      };
    },
  }),
  select: () => ({
    from: () => ({
      where: async () => [{ nextSeq: 1 }],
    }),
  }),
  query: {
    backgroundAgentRuns: {
      findFirst: async () => persistedRun,
    },
  },
};

mock.module("@/lib/db/client", () => ({ db }));
mock.module("nanoid", () => ({ nanoid: () => "run-snapshot-1" }));

const { createRunForTrigger, recordBackgroundAgentEvent } =
  await import("./store");

function buildAgent(
  overrides: Partial<BackgroundAgent> = {},
): BackgroundAgent {
  const now = new Date("2026-07-11T12:00:00.000Z");
  return {
    id: "agent-1",
    userId: "user-1",
    name: "Accepted definition",
    description: null,
    status: "enabled",
    repoOwner: "acme",
    repoName: "widgets",
    instructions: "accepted instructions",
    permissions: {},
    checkCommand: "bun --bun run ci",
    composioToolkitSlugs: ["github"],
    builtinToolNames: ["bash"],
    githubActions: { comment_on_pr_or_issue: true },
    writeScope: { mode: "this_repo" },
    requireCiGreenForMerge: true,
    runBudgetPerTarget: 10,
    modelId: "anthropic/claude-haiku-4.5",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const trigger = {
  id: "trigger-1",
  agentId: "agent-1",
  loopId: null,
  userId: "user-1",
  name: "Pull request",
  kind: "github.pull_request",
  status: "enabled",
  conditions: {},
  schedule: null,
  webhookPublicId: null,
  webhookSecretHash: null,
  lastRunAt: null,
  nextRunAt: null,
  lastSkipReason: null,
  createdAt: new Date("2026-07-11T12:00:00.000Z"),
  updatedAt: new Date("2026-07-11T12:00:00.000Z"),
} satisfies BackgroundAgentTrigger;

const event = {
  source: "github" as const,
  kind: "github.pull_request" as const,
  externalId: "delivery-1",
  repoOwner: "acme",
  repoName: "widgets",
  prNumber: 42,
};

beforeEach(() => {
  insertedRunValues = null;
  persistedRun = null;
  runInsertWins = true;
  recordedEvents.length = 0;
});

describe("createRunForTrigger execution snapshots", () => {
  test("persists one snapshot/version/hash in the winning idempotent insert", async () => {
    const result = await createRunForTrigger({
      agent: buildAgent(),
      trigger,
      event,
      requestId: "request-1",
    });

    expect(result.created).toBe(true);
    expect(insertedRunValues).toMatchObject({
      definitionVersion: 1,
      definitionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      executionSnapshot: {
        snapshotVersion: 1,
        instructions: "accepted instructions",
      },
    });
    expect(recordedEvents).toContainEqual(
      expect.objectContaining({
        eventName: "background-agent.snapshot.frozen",
        payload: expect.objectContaining({
          definitionVersion: 1,
          definitionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          snapshotSource: "frozen",
        }),
      }),
    );
  });

  test("duplicate delivery returns the original immutable snapshot after source edit", async () => {
    const first = await createRunForTrigger({
      agent: buildAgent(),
      trigger,
      event,
    });
    const original = first.run as BackgroundAgentRun & {
      executionSnapshot: { instructions: string };
      definitionHash: string;
    };

    runInsertWins = false;
    insertedRunValues = null;
    const duplicate = await createRunForTrigger({
      agent: buildAgent({ instructions: "mutated instructions" }),
      trigger,
      event,
    });
    const returned = duplicate.run as typeof original;

    expect(duplicate.created).toBe(false);
    expect(returned.executionSnapshot.instructions).toBe(
      "accepted instructions",
    );
    expect(returned.definitionHash).toBe(original.definitionHash);
    expect(recordedEvents.filter((entry) => entry.eventName === "background-agent.snapshot.frozen")).toHaveLength(1);
  });
});

describe("background event source identity", () => {
  test("uses the Run's fresh nullable agent id after source deletion", async () => {
    persistedRun = { id: "run-snapshot-1", agentId: null };

    await recordBackgroundAgentEvent({
      runId: "run-snapshot-1",
      agentId: "stale-agent-id",
      userId: "user-1",
      eventName: "background-agent.progress.observed",
      status: "succeeded",
    });

    expect(recordedEvents.at(-1)).toMatchObject({ agentId: null });
  });
});
