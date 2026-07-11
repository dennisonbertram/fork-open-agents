import { describe, expect, test } from "bun:test";

describe("legacy Run detail pages", () => {
  test("remain present while canonical routes are additive", async () => {
    const [backgroundPage, loopPage] = await Promise.all([
      Bun.file(
        new URL("../background-runs/[runId]/page.tsx", import.meta.url),
      ).exists(),
      Bun.file(
        new URL("../loops/[loopId]/runs/[runId]/page.tsx", import.meta.url),
      ).exists(),
    ]);

    expect(backgroundPage).toBe(true);
    expect(loopPage).toBe(true);
  });
});
