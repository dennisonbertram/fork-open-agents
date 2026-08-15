import { beforeEach, describe, expect, mock, test } from "bun:test";

type UpsertMode = "inserted" | "updated" | "conflict";

let upsertMode: UpsertMode = "inserted";
let lastInsertValue: unknown;
let lastUpdateSetValue: unknown;

// Rows returned by the fakeDb select() chain (used by getUsedSessionTitles
// and getChatSummariesBySessionId)
let fakeSelectRows: Array<Record<string, unknown>> = [];

// Columns object passed to `db.select({…})`, captured so tests can assert the
// read path's projection (e.g. that `activeRunSource` is selected).
let lastSelectColumns: unknown;

const fakeInsertedMessage = {
  id: "message-1",
  chatId: "chat-1",
  role: "assistant" as const,
  parts: { id: "message-1", role: "assistant", parts: [] },
  createdAt: new Date(),
};

const fakeDb = {
  // Fluent select chain: db.select({…}).from(table).where(condition) and, for
  // getChatSummariesBySessionId, .from(table).leftJoin(…).where(…).orderBy(…).
  select: (_columns: unknown) => {
    lastSelectColumns = _columns;
    return {
      from: (_table: unknown) => ({
        where: async (_condition: unknown) => fakeSelectRows,
        leftJoin: (_table2: unknown, _condition: unknown) => ({
          where: () => ({
            orderBy: async () => fakeSelectRows,
          }),
        }),
      }),
    };
  },

  // Top-level fluent update chain (used by claimChatActiveStreamId and
  // compareAndSetChatActiveStreamId).
  update: (_table: unknown) => ({
    set: (input: unknown) => {
      lastUpdateSetValue = input;
      return {
        where: () => ({
          returning: async () => [{ id: "chat-1" }],
        }),
      };
    },
  }),

  transaction: async <T>(
    callback: (tx: {
      insert: (table: unknown) => {
        values: (input: unknown) => {
          onConflictDoNothing: (config: unknown) => {
            returning: () => Promise<(typeof fakeInsertedMessage)[]>;
          };
        };
      };
      update: (table: unknown) => {
        set: (input: unknown) => {
          where: (condition: unknown) => {
            returning: () => Promise<(typeof fakeInsertedMessage)[]>;
          };
        };
      };
    }) => Promise<T>,
  ) => {
    const tx = {
      insert: (_table: unknown) => ({
        values: (input: unknown) => {
          lastInsertValue = input;
          return {
            onConflictDoNothing: (_config: unknown) => ({
              returning: async () =>
                upsertMode === "inserted" ? [fakeInsertedMessage] : [],
            }),
          };
        },
      }),
      update: (_table: unknown) => ({
        set: (input: unknown) => {
          lastUpdateSetValue = input;
          return {
            where: (_condition: unknown) => ({
              returning: async () =>
                upsertMode === "updated" ? [fakeInsertedMessage] : [],
            }),
          };
        },
      }),
    };

    return callback(tx);
  },
};

mock.module("./client", () => ({
  db: fakeDb,
}));

const sessionsModulePromise = import("./sessions");

describe("normalizeLegacySandboxState", () => {
  test("rewrites legacy vercel-compatible sandbox ids onto sandboxName", async () => {
    const { normalizeLegacySandboxState } = await sessionsModulePromise;

    const result = normalizeLegacySandboxState({
      type: "hybrid",
      sandboxId: "sbx-legacy-1",
      snapshotId: "snap-legacy-1",
      expiresAt: 123,
    });

    expect(result).toEqual({
      type: "vercel",
      sandboxName: "sbx-legacy-1",
      snapshotId: "snap-legacy-1",
      expiresAt: 123,
    });
  });

  test("moves persisted session_<id> identifiers onto sandboxName", async () => {
    const { normalizeLegacySandboxState } = await sessionsModulePromise;

    expect(
      normalizeLegacySandboxState({
        type: "vercel",
        sandboxId: "session_123",
        expiresAt: 456,
      }),
    ).toEqual({
      type: "vercel",
      sandboxName: "session_123",
      expiresAt: 456,
    });
  });

  test("leaves supported sandbox states unchanged", async () => {
    const { normalizeLegacySandboxState } = await sessionsModulePromise;

    const state = {
      type: "vercel",
      sandboxName: "session_current-1",
      expiresAt: 456,
    } as const;

    expect(normalizeLegacySandboxState(state)).toEqual(state);
  });
});

describe("getUsedSessionTitles", () => {
  beforeEach(() => {
    fakeSelectRows = [];
  });

  test("returns an empty Set when the user has no sessions", async () => {
    const { getUsedSessionTitles } = await sessionsModulePromise;
    fakeSelectRows = [];

    const result = await getUsedSessionTitles("user-1");
    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(0);
  });

  test("returns a Set containing all existing session titles", async () => {
    const { getUsedSessionTitles } = await sessionsModulePromise;
    fakeSelectRows = [
      { title: "Tokyo" },
      { title: "Paris" },
      { title: "Lagos" },
    ];

    const result = await getUsedSessionTitles("user-1");
    expect(result.size).toBe(3);
    expect(result.has("Tokyo")).toBe(true);
    expect(result.has("Paris")).toBe(true);
    expect(result.has("Lagos")).toBe(true);
  });

  test("deduplicates titles if the DB returns duplicates", async () => {
    const { getUsedSessionTitles } = await sessionsModulePromise;
    fakeSelectRows = [{ title: "Rome" }, { title: "Rome" }];

    const result = await getUsedSessionTitles("user-1");
    expect(result.size).toBe(1);
    expect(result.has("Rome")).toBe(true);
  });
});

describe("upsertChatMessageScoped", () => {
  beforeEach(() => {
    upsertMode = "inserted";
    lastInsertValue = undefined;
    lastUpdateSetValue = undefined;
  });

  test("returns inserted when no existing row conflicts", async () => {
    const { upsertChatMessageScoped } = await sessionsModulePromise;
    upsertMode = "inserted";

    const result = await upsertChatMessageScoped({
      id: "message-1",
      chatId: "chat-1",
      role: "assistant",
      parts: { id: "message-1", role: "assistant", parts: [] },
    });

    expect(result.status).toBe("inserted");
  });

  test("returns updated when id exists in same chat and role", async () => {
    const { upsertChatMessageScoped } = await sessionsModulePromise;
    upsertMode = "updated";

    const result = await upsertChatMessageScoped({
      id: "message-1",
      chatId: "chat-1",
      role: "assistant",
      parts: { id: "message-1", role: "assistant", parts: [{ type: "text" }] },
    });

    expect(result.status).toBe("updated");
  });

  test("returns conflict when id exists for different chat/role scope", async () => {
    const { upsertChatMessageScoped } = await sessionsModulePromise;
    upsertMode = "conflict";

    const result = await upsertChatMessageScoped({
      id: "message-1",
      chatId: "chat-1",
      role: "assistant",
      parts: { id: "message-1", role: "assistant", parts: [{ type: "text" }] },
    });

    expect(result.status).toBe("conflict");
  });

  test("sanitizes null bytes before writing chat message JSON", async () => {
    const { upsertChatMessageScoped } = await sessionsModulePromise;
    upsertMode = "updated";

    await upsertChatMessageScoped({
      id: "message-1",
      chatId: "chat-1",
      role: "assistant",
      parts: {
        id: "message-1",
        role: "assistant",
        parts: [{ type: "text", text: "hash input: model\0cache" }],
      },
    });

    expect(lastInsertValue).toMatchObject({
      parts: {
        parts: [{ text: "hash input: model\\u0000cache" }],
      },
    });
    expect(lastUpdateSetValue).toMatchObject({
      parts: {
        parts: [{ text: "hash input: model\\u0000cache" }],
      },
    });
  });
});

describe("claimChatActiveStreamId (#1269 activeRunSource)", () => {
  test("records activeRunSource alongside the claim when a source is provided", async () => {
    const { claimChatActiveStreamId } = await sessionsModulePromise;
    lastUpdateSetValue = undefined;

    await claimChatActiveStreamId("chat-1", "run-1", "mcp");

    expect(lastUpdateSetValue).toMatchObject({
      activeStreamId: "run-1",
      activeRunSource: "mcp",
    });
  });

  test("does not touch activeRunSource when no source is provided (workflow self-claim path)", async () => {
    const { claimChatActiveStreamId } = await sessionsModulePromise;
    lastUpdateSetValue = undefined;

    await claimChatActiveStreamId("chat-1", "run-1");

    expect(lastUpdateSetValue).not.toHaveProperty("activeRunSource");
  });
});

describe("compareAndSetChatActiveStreamId (#1269 activeRunSource)", () => {
  test("clears activeRunSource to null when clearing the stream id to null", async () => {
    const { compareAndSetChatActiveStreamId } = await sessionsModulePromise;
    lastUpdateSetValue = undefined;

    await compareAndSetChatActiveStreamId("chat-1", "run-1", null);

    expect(lastUpdateSetValue).toMatchObject({
      activeStreamId: null,
      activeRunSource: null,
    });
  });
});

describe("getChatSummariesBySessionId (#1269 activeRunSource)", () => {
  test("selects activeRunSource so a null source passes through unchanged on the read path", async () => {
    const { getChatSummariesBySessionId } = await sessionsModulePromise;
    lastSelectColumns = undefined;
    fakeSelectRows = [
      { id: "chat-1", activeRunSource: null, isStreaming: false },
    ];

    const rows = await getChatSummariesBySessionId("session-1", "user-1");

    // The live-run source is exposed on the chat payload alongside isStreaming.
    expect(lastSelectColumns).toMatchObject({
      activeRunSource: expect.anything(),
    });
    // toMatchObject, not toEqual: `rows` is typed with the query's full column
    // set, so an exact-equality literal cannot satisfy the overload. The claim
    // under test is that a null source passes through untouched.
    expect(rows).toMatchObject([
      { id: "chat-1", activeRunSource: null, isStreaming: false },
    ]);
  });
});
