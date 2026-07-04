import { describe, expect, test } from "bun:test";
import { formatRunTimestamp } from "./format-run-timestamp";

describe("formatRunTimestamp (#863)", () => {
  test("formats a Date instance in explicit UTC with the zone label", () => {
    expect(formatRunTimestamp(new Date("2026-07-03T21:20:00Z"))).toBe(
      "Jul 3, 2026, 9:20 PM UTC",
    );
  });

  test("formats an ISO string input identically to the equivalent Date", () => {
    expect(formatRunTimestamp("2026-07-03T21:20:00.000Z")).toBe(
      "Jul 3, 2026, 9:20 PM UTC",
    );
  });

  test("never renders the browser/server-local-timezone-shifted hour", () => {
    const result = formatRunTimestamp(new Date("2026-07-03T21:20:00Z"));
    expect(result).not.toMatch(/5:20/);
  });

  test("null value falls back to the default '-'", () => {
    expect(formatRunTimestamp(null)).toBe("-");
  });

  test("undefined value falls back to the default '-'", () => {
    expect(formatRunTimestamp(undefined)).toBe("-");
  });

  test("a custom fallback is used when provided", () => {
    expect(formatRunTimestamp(null, { fallback: "Never" })).toBe("Never");
  });

  test("an invalid date string falls back to the default '-'", () => {
    expect(formatRunTimestamp("not-a-date")).toBe("-");
  });
});
