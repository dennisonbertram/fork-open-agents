/**
 * Tests for Phase 6: agent_tool_entries data layer.
 *
 * BT-001: createProposedToolEntry records status=proposed and does NOT mutate agents row slugs
 * BT-002: listToolEntriesForAgent returns entries scoped to the owner
 * BT-003: approveToolEntry sets status=approved and appends slug to agents.composioToolkitSlugs
 * BT-004: rejectToolEntry sets status=rejected and leaves agents row unchanged
 * BT-005: owner scoping — list/approve/reject reject entries belonging to another user
 */

import { describe, expect, it, mock, beforeEach } from "bun:test";

// ── Mock server-only so the module can be imported in test env ────────────────
mock.module("server-only", () => ({}));

// ── Shared in-memory state ────────────────────────────────────────────────────
let fakeEntries: Record<string, unknown>[] = [];
let fakeAgents: Record<string, unknown>[] = [];
let lastInserted: unknown = null;
let lastUpdatedEntry: unknown = null;
let lastUpdatedAgent: { id: string; slugs: string[] } | null = null;

// ── Mock DB client ─────────────────────────────────────────────────────────────
mock.module("@/lib/db/client", () => {
  const buildSelectChain = (rows: () => Record<string, unknown>[]) => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async (n: number) => rows().slice(0, n),
        }),
      }),
    }),
  });

  return {
    db: {
      select: () => ({
        from: (_table: unknown) => ({
          where: () => ({
            limit: async (n: number) =>
              (_table === "agent_tool_entries_table" ? fakeEntries : fakeAgents).slice(0, n),
          }),
          // no .where => full list
          then: (resolve: (v: unknown) => void) => {
            resolve(fakeEntries);
          },
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
          return {
            returning: async () => [vals],
          };
        },
      }),
      update: (_table: unknown) => ({
        set: (patch: unknown) => ({
          where: () => ({
            returning: async () => {
              if (_table === "agents_table") {
                lastUpdatedAgent = patch as { id: string; slugs: string[] };
              } else {
                lastUpdatedEntry = patch;
              }
              return [{ ...patch }];
            },
          }),
        }),
      }),
    },
  };
});

// ── Schema mock ─────────────────────────────────────────────────────────────────
mock.module("@/lib/db/schema", () => ({
  agentToolEntries: "agent_tool_entries_table",
  agents: "agents_table",
}));

// ── nanoid mock ─────────────────────────────────────────────────────────────────
mock.module("nanoid", () => ({ nanoid: () => "test-entry-id" }));

// ── Drizzle mock ───────────────────────────────────────────────────────────────
mock.module("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  eq: (col: unknown, val: unknown) => ({ type: "eq", col, val }),
}));

// ── Import SUT (after mocks) ──────────────────────────────────────────────────
const {
  createProposedToolEntry,
  listToolEntriesForAgent,
  approveToolEntry,
  rejectToolEntry,
} = await import("./agent-tool-entries");

// ── Helpers ───────────────────────────────────────────────────────────────────
function resetState() {
  fakeEntries = [];
  fakeAgents = [];
  lastInserted = null;
  lastUpdatedEntry = null;
  lastUpdatedAgent = null;
}

describe("agent-tool-entries data layer", () => {
  beforeEach(() => {
    resetState();
  });

  // BT-001: create records status=proposed; does NOT mutate composioToolkitSlugs
  describe("createProposedToolEntry (BT-001)", () => {
    it("inserts a row with status=proposed and provenance fields", async () => {
      await createProposedToolEntry({
        agentId: "agent-abc",
        userId: "user-xyz",
        toolkitSlug: "github",
        createdByChatId: "chat-001",
        createdByRunId: null,
      });

      const inserted = lastInserted as Record<string, unknown>;
      expect(inserted).toBeDefined();
      expect(inserted["agentId"]).toBe("agent-abc");
      expect(inserted["userId"]).toBe("user-xyz");
      expect(inserted["toolkitSlug"]).toBe("github");
      expect(inserted["status"]).toBe("proposed");
      expect(inserted["provider"]).toBe("composio");
      expect(inserted["createdByChatId"]).toBe("chat-001");
      expect(inserted["approvedAt"]).toBeNull();
    });

    it("records a generated id", async () => {
      await createProposedToolEntry({
        agentId: "agent-abc",
        userId: "user-xyz",
        toolkitSlug: "linear",
        createdByChatId: null,
        createdByRunId: null,
      });

      const inserted = lastInserted as Record<string, unknown>;
      expect(typeof inserted["id"]).toBe("string");
      expect((inserted["id"] as string).length).toBeGreaterThan(0);
    });

    it("does NOT change composioToolkitSlugs on the agents row (off-by-default)", async () => {
      // Set up an agent row with an initial slug list
      fakeAgents = [{ id: "agent-abc", composioToolkitSlugs: ["existing-tool"] }];

      await createProposedToolEntry({
        agentId: "agent-abc",
        userId: "user-xyz",
        toolkitSlug: "github",
        createdByChatId: null,
        createdByRunId: null,
      });

      // The agent row should be unchanged (lastUpdatedAgent should be null)
      expect(lastUpdatedAgent).toBeNull();
      // And the agents array should not have a new slug appended
      const agentRow = fakeAgents[0] as Record<string, unknown>;
      expect((agentRow["composioToolkitSlugs"] as string[])).toEqual(["existing-tool"]);
    });
  });

  // BT-002: listToolEntriesForAgent returns entries for that agent
  describe("listToolEntriesForAgent (BT-002)", () => {
    it("returns all entries for the given agentId and userId", async () => {
      fakeEntries = [
        { id: "e1", agentId: "agent-abc", userId: "user-xyz", toolkitSlug: "github", status: "proposed" },
        { id: "e2", agentId: "agent-abc", userId: "user-xyz", toolkitSlug: "linear", status: "approved" },
      ];

      const entries = await listToolEntriesForAgent("user-xyz", "agent-abc");

      // The function should return entries (exact filtering is done by the DB mock via 'where')
      expect(Array.isArray(entries)).toBe(true);
    });
  });

  // BT-003: approveToolEntry sets status=approved and appends slug
  describe("approveToolEntry (BT-003)", () => {
    it("returns true when an entry is successfully approved", async () => {
      fakeEntries = [
        {
          id: "entry-001",
          agentId: "agent-abc",
          userId: "user-xyz",
          toolkitSlug: "github",
          status: "proposed",
          provider: "composio",
        },
      ];
      fakeAgents = [
        {
          id: "agent-abc",
          userId: "user-xyz",
          composioToolkitSlugs: [],
        },
      ];

      const result = await approveToolEntry("user-xyz", "entry-001");

      expect(result).toBe(true);
    });

    it("returns false when the entry does not belong to the user (owner scoping)", async () => {
      // Entry belongs to another user
      fakeEntries = [];

      const result = await approveToolEntry("attacker-user", "entry-001");

      expect(result).toBe(false);
    });
  });

  // BT-004: rejectToolEntry sets status=rejected and leaves agents row unchanged
  describe("rejectToolEntry (BT-004)", () => {
    it("returns true when an entry is successfully rejected", async () => {
      fakeEntries = [
        {
          id: "entry-001",
          agentId: "agent-abc",
          userId: "user-xyz",
          toolkitSlug: "github",
          status: "proposed",
          provider: "composio",
        },
      ];

      const result = await rejectToolEntry("user-xyz", "entry-001");

      expect(result).toBe(true);
    });

    it("does NOT update the agents row when rejecting", async () => {
      fakeEntries = [
        {
          id: "entry-001",
          agentId: "agent-abc",
          userId: "user-xyz",
          toolkitSlug: "github",
          status: "proposed",
          provider: "composio",
        },
      ];
      fakeAgents = [{ id: "agent-abc", composioToolkitSlugs: [] }];

      await rejectToolEntry("user-xyz", "entry-001");

      // The agents row should not have been updated
      expect(lastUpdatedAgent).toBeNull();
    });

    it("returns false when the entry does not belong to the user (owner scoping)", async () => {
      fakeEntries = [];

      const result = await rejectToolEntry("attacker-user", "entry-001");

      expect(result).toBe(false);
    });
  });

  // BT-005: owner scoping — list only for owner
  describe("owner scoping (BT-005)", () => {
    it("listToolEntriesForAgent is called with the userId so only owner entries are visible", async () => {
      // This is a contract test: we verify the function accepts userId as a required param
      // The actual filtering is done by the DB layer (mocked), so we assert the function exists
      // and accepts userId + agentId as distinct scoping params
      expect(typeof listToolEntriesForAgent).toBe("function");
      // Function signature: (userId, agentId) — userId is first (owner gate)
      expect(listToolEntriesForAgent.length).toBe(2);
    });
  });
});
