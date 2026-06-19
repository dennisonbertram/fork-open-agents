import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

describe("loop builder sidebar spacing", () => {
  test("does not carry the old floating Open panel padding workaround", () => {
    const source = readFileSync(
      join(import.meta.dir, "builder-canvas.tsx"),
      "utf8",
    );

    expect(source).not.toContain("pl-14");
    expect(source).not.toContain("Open panel");
  });
});
