import { describe, expect, test } from "bun:test";
import type { BackgroundAgentTrigger } from "@/lib/db/schema";
import {
  getTriggerIdentityKey,
  matchTriggersByIdentity,
} from "./trigger-upsert";

function makeExistingTrigger(
  overrides: Partial<BackgroundAgentTrigger>,
): BackgroundAgentTrigger {
  return {
    id: "trigger-1",
    agentId: "agent-1",
    loopId: null,
    userId: "user-1",
    name: "Nightly",
    kind: "schedule.cron",
    status: "enabled",
    conditions: {},
    schedule: "7 * * * *",
    webhookPublicId: null,
    webhookSecretHash: null,
    lastRunAt: null,
    nextRunAt: null,
    lastSkipReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("getTriggerIdentityKey", () => {
  test("is stable regardless of object key order in conditions", () => {
    const keyA = getTriggerIdentityKey({
      name: "PR checks",
      kind: "github.pull_request",
      conditions: { branches: ["main"], actions: ["opened"] },
      schedule: null,
    });
    const keyB = getTriggerIdentityKey({
      name: "PR checks",
      kind: "github.pull_request",
      conditions: { actions: ["opened"], branches: ["main"] },
      schedule: null,
    });

    expect(keyA).toBe(keyB);
  });

  test("differs when nested condition values differ (deep sort, not shallow)", () => {
    const keyA = getTriggerIdentityKey({
      name: "PR checks",
      kind: "github.pull_request",
      conditions: { actions: ["opened"], branches: ["main"] },
      schedule: null,
    });
    const keyB = getTriggerIdentityKey({
      name: "PR checks",
      kind: "github.pull_request",
      conditions: { actions: ["opened"], branches: ["develop"] },
      schedule: null,
    });

    expect(keyA).not.toBe(keyB);
  });

  test("differs when schedule differs", () => {
    const keyA = getTriggerIdentityKey({
      name: "Nightly",
      kind: "schedule.cron",
      conditions: {},
      schedule: "7 * * * *",
    });
    const keyB = getTriggerIdentityKey({
      name: "Nightly",
      kind: "schedule.cron",
      conditions: {},
      schedule: "0 9 * * *",
    });

    expect(keyA).not.toBe(keyB);
  });

  test("treats null and undefined schedule as equivalent (normalized to empty)", () => {
    const keyA = getTriggerIdentityKey({
      name: "PR checks",
      kind: "github.pull_request",
      conditions: {},
      schedule: null,
    });
    const keyB = getTriggerIdentityKey({
      name: "PR checks",
      kind: "github.pull_request",
      conditions: {},
    });

    expect(keyA).toBe(keyB);
  });
});

describe("matchTriggersByIdentity", () => {
  test("matches an incoming trigger to the existing row with the same identity", () => {
    const existing = makeExistingTrigger({ id: "trigger-existing" });

    const matches = matchTriggersByIdentity({
      incoming: [
        {
          name: "Nightly",
          kind: "schedule.cron",
          conditions: {},
          schedule: "7 * * * *",
        },
      ],
      existing: [existing],
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe("trigger-existing");
  });

  test("returns null for a trigger whose identity has no existing match", () => {
    const existing = makeExistingTrigger({ id: "trigger-existing" });

    const matches = matchTriggersByIdentity({
      incoming: [
        {
          name: "Nightly",
          kind: "schedule.cron",
          conditions: {},
          schedule: "0 9 * * *", // different schedule → different identity
        },
      ],
      existing: [existing],
    });

    expect(matches).toEqual([null]);
  });

  test("consumes each existing row at most once for duplicate identities", () => {
    const rowA = makeExistingTrigger({ id: "row-a" });
    const rowB = makeExistingTrigger({ id: "row-b" });

    const matches = matchTriggersByIdentity({
      incoming: [
        {
          name: "Nightly",
          kind: "schedule.cron",
          conditions: {},
          schedule: "7 * * * *",
        },
        {
          name: "Nightly",
          kind: "schedule.cron",
          conditions: {},
          schedule: "7 * * * *",
        },
        {
          name: "Nightly",
          kind: "schedule.cron",
          conditions: {},
          schedule: "7 * * * *",
        },
      ],
      existing: [rowA, rowB],
    });

    expect(matches.map((m) => m?.id ?? null)).toEqual(["row-a", "row-b", null]);
  });
});
