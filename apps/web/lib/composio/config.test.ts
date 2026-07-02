import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { getComposioConfiguredStatus } = await import("./config");

describe("getComposioConfiguredStatus copy (#800)", () => {
  test("message distinguishes 'configured' (env present) from 'verified working'", () => {
    const status = getComposioConfiguredStatus();

    expect(status.message.toLowerCase()).toContain("configured");
    // Must not claim it's verified/working without a live check having run —
    // that's the overclaim this ticket fixes.
    expect(status.message.toLowerCase()).not.toBe("composio is configured.");
  });
});
