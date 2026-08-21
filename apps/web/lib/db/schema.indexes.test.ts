import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { usageEvents, verification } from "./schema";

type IndexConfig = ReturnType<typeof getTableConfig>["indexes"][number];

function findIndex(
  table: Parameters<typeof getTableConfig>[0],
  name: string,
): IndexConfig | undefined {
  return getTableConfig(table).indexes.find((idx) => idx.config.name === name);
}

function columnNames(index: IndexConfig | undefined): string[] {
  return (index?.config.columns ?? []).map(
    (column: unknown) => (column as { name?: string }).name ?? "",
  );
}

describe("hot-path DB indexes (#1400)", () => {
  test("usage_events has (userId, createdAt) index usage_events_user_created_idx", () => {
    const index = findIndex(usageEvents, "usage_events_user_created_idx");

    expect(index).toBeDefined();
    expect(index?.config.unique).toBeFalsy();
    expect(columnNames(index)).toEqual(["user_id", "created_at"]);
  });

  test("verification has identifier index verification_identifier_idx", () => {
    const index = findIndex(verification, "verification_identifier_idx");

    expect(index).toBeDefined();
    expect(index?.config.unique).toBeFalsy();
    expect(columnNames(index)).toEqual(["identifier"]);
  });
});
