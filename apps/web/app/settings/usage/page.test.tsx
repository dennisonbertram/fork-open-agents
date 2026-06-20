import { describe, expect, test } from "bun:test";

describe("Usage page", () => {
  test("redirects to the live profile usage surface", async () => {
    const { default: UsagePage } = await import("./page");
    expect(() => UsagePage()).toThrow("NEXT_REDIRECT");
  });
});
