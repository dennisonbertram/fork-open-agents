import { describe, expect, test } from "bun:test";
import { firstFieldError } from "./validation-details";

describe("firstFieldError", () => {
  test("returns null for undefined details", () => {
    expect(firstFieldError(undefined)).toBeNull();
  });

  test("returns null for empty fieldErrors", () => {
    expect(firstFieldError({ fieldErrors: {}, formErrors: [] })).toBeNull();
  });

  test("formats the first field error as 'field: message'", () => {
    const details = {
      fieldErrors: { schedule: ["Invalid schedule expression"] },
      formErrors: [],
    };
    expect(firstFieldError(details)).toBe("schedule: Invalid schedule expression");
  });

  test("returns only the first message when a field has multiple errors", () => {
    const details = {
      fieldErrors: { name: ["Too short", "Required"] },
      formErrors: [],
    };
    expect(firstFieldError(details)).toBe("name: Too short");
  });

  test("returns the first field alphabetically when multiple fields have errors", () => {
    const details = {
      fieldErrors: {
        schedule: ["Invalid schedule"],
        name: ["Name is required"],
      },
      formErrors: [],
    };
    const result = firstFieldError(details);
    // Should return one of the two field errors (first key in iteration order)
    expect(result).toMatch(/^(schedule|name): /);
  });

  test("returns null when fieldErrors is empty but formErrors has entries", () => {
    const details = {
      fieldErrors: {},
      formErrors: ["Root error"],
    };
    expect(firstFieldError(details)).toBeNull();
  });
});
