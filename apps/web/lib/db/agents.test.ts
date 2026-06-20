import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { agents } from "./schema";

type IndexConfig = ReturnType<typeof getTableConfig>["indexes"][number];

function findIndex(name: string): IndexConfig | undefined {
  return getTableConfig(agents).indexes.find((idx) => idx.config.name === name);
}

function columnNames(index: IndexConfig | undefined): string[] {
  return (index?.config.columns ?? []).map(
    (column: unknown) => (column as { name?: string }).name ?? "",
  );
}

describe("agents scope-aware uniqueness", () => {
  test("allows repo-scoped agents to differ by repo owner/name", () => {
    const index = findIndex("agents_repo_role_scope_idx");

    expect(index).toBeDefined();
    expect(index?.config.unique).toBe(true);
    expect(columnNames(index)).toEqual([
      "user_id",
      "role",
      "repo_owner",
      "repo_name",
    ]);
    expect(index?.config.where).toBeDefined();
  });

  test("allows session-scoped agents to differ by session id", () => {
    const index = findIndex("agents_session_role_scope_idx");

    expect(index).toBeDefined();
    expect(index?.config.unique).toBe(true);
    expect(columnNames(index)).toEqual(["user_id", "role", "session_id"]);
    expect(index?.config.where).toBeDefined();
  });

  test("preserves one user-default agent per user and role", () => {
    const index = findIndex("agents_user_default_role_scope_idx");

    expect(index).toBeDefined();
    expect(index?.config.unique).toBe(true);
    expect(columnNames(index)).toEqual(["user_id", "role"]);
    expect(index?.config.where).toBeDefined();
  });
});
