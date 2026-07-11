import { describe, expect, test } from "bun:test";
import {
  buildRunsQueryKey,
  decodeRunsCursor,
  encodeRunsCursor,
  parseRunsQuery,
} from "./query";

describe("Runs query contract", () => {
  test("validates paired repository and Automation filters", () => {
    expect(parseRunsQuery(new URLSearchParams("repoOwner=acme"))).toMatchObject(
      { ok: false },
    );
    expect(
      parseRunsQuery(
        new URLSearchParams(
          "automationSource=background_agent&automationId=agent-1&limit=25",
        ),
      ),
    ).toMatchObject({
      ok: true,
      value: {
        limit: 25,
        filters: {
          automationSource: "background_agent",
          automationId: "agent-1",
        },
      },
    });
  });

  test("round-trips a versioned cursor and binds it to filters", () => {
    const filters = {
      view: "active" as const,
      repoOwner: "acme",
      repoName: "shop",
    };
    const cursor = encodeRunsCursor({
      createdAt: "2026-07-11T12:00:00.000Z",
      id: "background_agent:run-1",
      queryKey: buildRunsQueryKey(filters),
    });

    expect(decodeRunsCursor(cursor, filters)).toEqual({
      createdAt: "2026-07-11T12:00:00.000Z",
      id: "background_agent:run-1",
      queryKey: buildRunsQueryKey(filters),
    });
    expect(() =>
      decodeRunsCursor(cursor, { ...filters, view: "completed" }),
    ).toThrow("filters");
  });

  test("rejects malformed limits and cursors", () => {
    expect(parseRunsQuery(new URLSearchParams("limit=500"))).toMatchObject({
      ok: false,
    });
    expect(
      parseRunsQuery(new URLSearchParams("cursor=not-a-cursor")),
    ).toMatchObject({ ok: false });
  });
});
