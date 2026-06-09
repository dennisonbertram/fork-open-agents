/**
 * Regression tests for shouldCollapseSingleOption.
 *
 * These tests catch future breakage if the collapse logic is reverted,
 * weakened, or accidentally inverted. Each scenario covers a distinct
 * boundary case.
 */
import { describe, expect, test } from "bun:test";
import { shouldCollapseSingleOption } from "./preferences-helpers";

describe("shouldCollapseSingleOption — regression coverage", () => {
  test("the exact SANDBOX_OPTIONS shape (one 'vercel' entry) collapses", () => {
    // Mirrors the real SANDBOX_OPTIONS constant so a future addition is caught.
    const sandboxOptions = [{ id: "vercel", name: "Vercel" }];
    expect(shouldCollapseSingleOption(sandboxOptions)).toBe(true);
  });

  test("adding a second sandbox option promotes back to a Select", () => {
    const twoOptions = [
      { id: "vercel", name: "Vercel" },
      { id: "docker", name: "Docker" },
    ];
    expect(shouldCollapseSingleOption(twoOptions)).toBe(false);
  });

  test("the helper does not mutate the input array", () => {
    const options = [{ id: "vercel", name: "Vercel" }];
    const originalLength = options.length;
    shouldCollapseSingleOption(options);
    expect(options.length).toBe(originalLength);
  });
});
