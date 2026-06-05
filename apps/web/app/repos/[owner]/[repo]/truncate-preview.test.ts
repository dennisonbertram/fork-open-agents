import { describe, expect, test } from "bun:test";
import {
  INSTRUCTION_PREVIEW_CAP,
  SUMMARY_PREVIEW_CAP,
  truncatePreview,
} from "./truncate-preview";

// REGRESSION-003: truncatePreview helper exact-boundary behavior
describe("truncatePreview", () => {
  test("REGRESSION-003a: returns string unchanged when length equals cap", () => {
    const text = "A".repeat(140);
    expect(truncatePreview(text, 140)).toBe(text);
  });

  test("REGRESSION-003b: returns string unchanged when length is under cap", () => {
    const text = "Short text";
    expect(truncatePreview(text, 140)).toBe("Short text");
  });

  test("REGRESSION-003c: truncates and appends ellipsis when length exceeds cap by one", () => {
    const text = "A".repeat(141);
    const result = truncatePreview(text, 140);
    expect(result).toBe("A".repeat(140) + "…");
    expect(result).not.toContain("A".repeat(141));
  });

  test("REGRESSION-003d: truncates well beyond the cap — tail chars must not appear", () => {
    const tail = "TAIL_CHARS";
    const text = "A".repeat(150) + tail;
    const result = truncatePreview(text, 140);
    expect(result).not.toContain(tail);
    expect(result.endsWith("…")).toBe(true);
    // total length is cap + 1 (the ellipsis char)
    expect(result.length).toBe(141);
  });

  test("REGRESSION-003e: INSTRUCTION_PREVIEW_CAP is 140", () => {
    expect(INSTRUCTION_PREVIEW_CAP).toBe(140);
  });

  test("REGRESSION-003f: SUMMARY_PREVIEW_CAP is 120", () => {
    expect(SUMMARY_PREVIEW_CAP).toBe(120);
  });

  test("REGRESSION-003g: empty string is returned unchanged", () => {
    expect(truncatePreview("", 140)).toBe("");
  });
});
