import { describe, expect, test } from "bun:test";

describe("legacy repository route compatibility", () => {
  test("keeps the deliberate legacy route handlers in place", async () => {
    const routeFiles = [
      "project/page.tsx",
      "agents/page.tsx",
      "agents/new/page.tsx",
      "actions/page.tsx",
      "secrets/page.tsx",
      "loops/page.tsx",
    ];

    for (const routeFile of routeFiles) {
      expect(await Bun.file(`${import.meta.dir}/${routeFile}`).exists()).toBe(
        true,
      );
    }
  });
});
