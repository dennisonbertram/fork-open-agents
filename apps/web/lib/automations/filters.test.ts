import { describe, expect, test } from "bun:test";
import { parseAutomationFilters } from "./filters";

describe("Automation filters", () => {
  test("normalizes kind and status case while preserving repository display case", () => {
    const result = parseAutomationFilters(
      new URLSearchParams({
        repository: "Acme/Widgets",
        kind: "SINGLE_STEP",
        state: "ENABLED",
      }),
    );

    expect(result).toEqual({
      ok: true,
      filters: {
        repository: { owner: "Acme", name: "Widgets" },
        kind: "single_step",
        state: "enabled",
      },
    });
  });
});
