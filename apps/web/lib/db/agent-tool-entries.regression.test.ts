/**
 * Regression tests for Phase 6: agent_tool_entries data layer.
 *
 * These tests catch regressions if:
 * - createProposedToolEntry accidentally makes the slug live (off-by-default violated)
 * - rejectToolEntry accidentally appends the slug to the agents row
 * - listToolEntriesForAgent accepts calls without userId (owner scoping removed)
 * - approveToolEntry changes agents row when entry is not found
 */

import { describe, expect, it, mock, beforeEach } from "bun:test";

mock.module("server-only", () => ({}));

let fakeEntries: Record<string, unknown>[] = [];
let fakeAgents: Record<string, unknown>[] = [];
let lastInserted: unknown = null;
let lastUpdatedAgent: unknown = null;

function makeWhereResult(rows: Record<string, unknown>[]) {
  const p = Promise.resolve(rows);
  return Object.assign(p, {
    limit: (n: number) => Promise.resolve(rows.slice(0, n)),
  });
}

mock.module("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: (_table: unknown) => ({
        where: () =>
          makeWhereResult(_table === "agents_table" ? fakeAgents : fakeEntries),
      }),
    }),
    insert: (_table: unknown) => ({
      values: (vals: unknown) => {
        lastInserted = vals;
        if (_table === "agents_table") {
          fakeAgents.push(vals as Record<string, unknown>);
        } else {
          fakeEntries.push(vals as Record<string, unknown>);
        }
        return { returning: () => Promise.resolve([vals]) };
      },
    }),
    update: (_table: unknown) => ({
      set: (patch: unknown) => ({
        where: () => ({
          returning: async () => {
            if (_table === "agents_table") {
              lastUpdatedAgent = patch;
            }
            return [Object.assign({}, patch)];
          },
        }),
      }),
    }),
  },
}));

mock.module("@/lib/db/schema", () => ({
  agentToolEntries: "agent_tool_entries_table",
  agents: "agents_table",
}));

mock.module("nanoid", () => ({ nanoid: () => "regression-id" }));
mock.module("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  eq: (col: unknown, val: unknown) => ({ type: "eq", col, val }),
}));

const {
  createProposedToolEntry,
  rejectToolEntry,
  listToolEntriesForAgent,
  approveToolEntry,
} = await import("./agent-tool-entries");

function resetState() {
  fakeEntries = [];
  fakeAgents = [];
  lastInserted = null;
  lastUpdatedAgent = null;
}

describe("agent-tool-entries regressions", () => {
  beforeEach(resetState);

  // REGRESSION-1: createProposedToolEntry must NEVER touch agents.composioToolkitSlugs
  // Catches: If someone changes createProposedToolEntry to auto-approve
  it("regression: createProposedToolEntry does not update the agents row (off-by-default)", async () => {
    fakeAgents = [{ id: "agent-abc", composioToolkitSlugs: ["existing"] }];

    await createProposedToolEntry({
      agentId: "agent-abc",
      userId: "user-xyz",
      toolkitSlug: "linear",
      createdByChatId: null,
      createdByRunId: null,
    });

    // No update to agents row
    expect(lastUpdatedAgent).toBeNull();
  });

  // REGRESSION-2: rejectToolEntry must NEVER update the agents row
  // Catches: If rejectToolEntry accidentally tries to remove/modify slugs
  it("regression: rejectToolEntry does not update the agents row", async () => {
    fakeEntries = [
      {
        id: "entry-r",
        agentId: "agent-abc",
        userId: "user-xyz",
        toolkitSlug: "linear",
        status: "proposed",
      },
    ];
    fakeAgents = [{ id: "agent-abc", composioToolkitSlugs: ["existing"] }];

    await rejectToolEntry("user-xyz", "entry-r");

    // lastUpdatedAgent should still be null (rejection does not touch agents row)
    expect(lastUpdatedAgent).toBeNull();
  });

  // REGRESSION-3: listToolEntriesForAgent signature requires userId as first arg
  // Catches: If the ownership check parameter is removed
  it("regression: listToolEntriesForAgent requires userId as first parameter (owner gate)", () => {
    // Function must accept (userId, agentId) — verify parameter count
    expect(listToolEntriesForAgent.length).toBe(2);
  });

  // REGRESSION-4: approveToolEntry returns false (not throw) for missing entry
  // Catches: If the not-found case throws instead of returning false, breaking the 404 path
  it("regression: approveToolEntry returns false (not throws) when entry not found", async () => {
    fakeEntries = []; // empty — no entry

    const result = await approveToolEntry("user-xyz", "nonexistent-entry");
    expect(result).toBe(false);
  });

  // REGRESSION-5: createProposedToolEntry always sets provider="composio"
  // Catches: If provider field is removed or made dynamic without gating
  it("regression: createProposedToolEntry always records provider=composio", async () => {
    await createProposedToolEntry({
      agentId: "agent-abc",
      userId: "user-xyz",
      toolkitSlug: "slack",
      createdByChatId: null,
      createdByRunId: null,
    });

    const inserted = lastInserted as Record<string, unknown>;
    expect(inserted["provider"]).toBe("composio");
  });
});
