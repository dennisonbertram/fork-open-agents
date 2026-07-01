import { describe, expect, mock, test } from "bun:test";
import { gtmEvents } from "@/lib/db/schema";

mock.module("server-only", () => ({}));

const whereCalls: Array<{ table: unknown; condition: unknown }> = [];
let selectResults: unknown[][] = [];

mock.module("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: (condition: unknown) => {
          whereCalls.push({ table, condition });
          if (table === gtmEvents) {
            return {
              orderBy: () => ({
                limit: async () => selectResults.shift() ?? [],
              }),
            };
          }
          return selectResults.shift() ?? [];
        },
      }),
    }),
  },
}));

const storePromise = import("./diagnosis-store");

function collectQueryFacts(value: unknown) {
  const seen = new WeakSet<object>();
  const facts = {
    columnNames: new Set<string>(),
    paramValues: new Set<string>(),
  };

  const visit = (item: unknown) => {
    if (!item || typeof item !== "object") {
      return;
    }
    if (seen.has(item)) {
      return;
    }
    seen.add(item);

    const record = item as Record<string | symbol, unknown>;
    if (typeof record.name === "string") {
      facts.columnNames.add(record.name);
    }
    if (typeof record.value === "string") {
      facts.paramValues.add(record.value);
    }

    for (const nested of Reflect.ownKeys(record).map((key) => record[key])) {
      if (Array.isArray(nested)) {
        for (const entry of nested) {
          visit(entry);
        }
      } else {
        visit(nested);
      }
    }
  };

  visit(value);
  return facts;
}

describe("GTM diagnosis store", () => {
  test("redacts diagnosis titles and scopes ledger evidence by entity kind", async () => {
    whereCalls.length = 0;
    selectResults = [
      [
        {
          id: "shared-id",
          kind: "pain",
          status: "active",
          confidence: "high",
          summary: "token=secret",
          updatedAt: new Date("2026-06-30T12:00:00.000Z"),
        },
      ],
      [
        {
          id: "event-1",
          eventName: "gtm.signal.recorded",
          status: "succeeded",
          errorKind: null,
          requestId: "req-1",
          level: "info",
          redactionStatus: "redacted",
          createdAt: new Date("2026-06-30T12:01:00.000Z"),
        },
      ],
    ];
    const { buildDbBackedGtmDiagnosis } = await storePromise;

    const diagnosis = await buildDbBackedGtmDiagnosis({
      userId: "user-1",
      source: "account_work",
      id: "shared-id",
    });

    expect(diagnosis?.item.title).toMatch("[redacted:");
    expect(diagnosis?.evidence.map((item) => item.id)).toEqual(["event-1"]);

    const eventWhere = whereCalls.find((call) => call.table === gtmEvents);
    expect(eventWhere).toBeDefined();
    const facts = collectQueryFacts(eventWhere?.condition);
    expect(facts.columnNames).toContain("entity_kind");
    expect(facts.paramValues).toContain("signal");
  });
});
