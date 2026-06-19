import { describe, expect, test } from "bun:test";
import { shouldCollapseSingleOption } from "./preferences-helpers";

describe("shouldCollapseSingleOption", () => {
  test("returns true when the options array is empty", () => {
    expect(shouldCollapseSingleOption([])).toBe(true);
  });

  test("returns true when there is exactly one option", () => {
    expect(shouldCollapseSingleOption([{ id: "vercel", name: "Vercel" }])).toBe(
      true,
    );
  });

  test("returns false when there are two options", () => {
    expect(
      shouldCollapseSingleOption([
        { id: "vercel", name: "Vercel" },
        { id: "other", name: "Other" },
      ]),
    ).toBe(false);
  });

  test("returns false when there are three or more options", () => {
    expect(
      shouldCollapseSingleOption([
        { id: "a", name: "A" },
        { id: "b", name: "B" },
        { id: "c", name: "C" },
      ]),
    ).toBe(false);
  });
});
