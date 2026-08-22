import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const USERS_TABLE = { __table: "users", id: "users.id" };
const ACCOUNTS_TABLE = { __table: "accounts", id: "accounts.id" };

type InsertCall = { table: string; values: Record<string, unknown> };
type UpdateCall = { table: string; set: Record<string, unknown> };

let insertCalls: InsertCall[] = [];
let updateCalls: UpdateCall[] = [];
let upsertInstallationCalls: Array<Record<string, unknown>> = [];

function tableNameFor(table: unknown): string {
  if (table === USERS_TABLE) {
    return "users";
  }
  if (table === ACCOUNTS_TABLE) {
    return "accounts";
  }
  return "unknown";
}

function makeInsert(table: unknown) {
  const tableName = tableNameFor(table);
  return {
    values: (values: Record<string, unknown>) => {
      insertCalls.push({ table: tableName, values });
      return {
        onConflictDoUpdate: (opts: { set: Record<string, unknown> }) => {
          updateCalls.push({ table: tableName, set: opts.set });
          return Promise.resolve(undefined);
        },
      };
    },
  };
}

mock.module("@/lib/db/client", () => ({
  db: {
    insert: (table: unknown) => makeInsert(table),
  },
}));

mock.module("@/lib/db/schema", () => ({
  users: USERS_TABLE,
  accounts: ACCOUNTS_TABLE,
}));

mock.module("@/lib/db/installations", () => ({
  upsertInstallation: async (data: Record<string, unknown>) => {
    upsertInstallationCalls.push(data);
    return { id: "inst-1", ...data };
  },
}));

const seedModulePromise = import("./test-auth-seed");

describe("seedTestAuthUser", () => {
  beforeEach(() => {
    insertCalls = [];
    updateCalls = [];
    upsertInstallationCalls = [];
  });

  test("upserts the demo user, a GitHub account without a usable token, and an installation", async () => {
    const { seedTestAuthUser, TEST_AUTH_GITHUB_ACCOUNT_ID } =
      await seedModulePromise;

    const result = await seedTestAuthUser();

    expect(result).toEqual({ userId: "dev-managed-runtime-user" });

    const userInsert = insertCalls.find((call) => call.table === "users");
    expect(userInsert?.values.id).toBe("dev-managed-runtime-user");
    expect(userInsert?.values.username).toBe("managed-runtime-demo");

    const accountInsert = insertCalls.find((call) => call.table === "accounts");
    expect(accountInsert?.values.id).toBe(TEST_AUTH_GITHUB_ACCOUNT_ID);
    expect(accountInsert?.values.providerId).toBe("github");
    expect(accountInsert?.values.userId).toBe("dev-managed-runtime-user");
    expect(accountInsert?.values.accessToken).toBeNull();

    expect(upsertInstallationCalls).toEqual([
      {
        userId: "dev-managed-runtime-user",
        installationId: 1,
        accountLogin: "managed-runtime-demo",
        accountType: "User",
        repositorySelection: "selected",
      },
    ]);
  });

  test("does not import or call the sandbox connector", async () => {
    const source = await Bun.file(
      new URL("test-auth-seed.ts", import.meta.url),
    ).text();

    expect(source).not.toContain("@open-agents/sandbox");
    expect(source).not.toContain("connectSandbox");
    expect(source).not.toContain("prepareManagedRuntimeDemo");
  });
});
