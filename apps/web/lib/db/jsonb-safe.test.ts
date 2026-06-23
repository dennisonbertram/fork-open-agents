import { describe, expect, test } from "bun:test";
import { sanitizeJsonbValue } from "./jsonb-safe";

describe("sanitizeJsonbValue", () => {
  test("replaces null bytes in nested strings with a PostgreSQL-safe literal", () => {
    expect(
      sanitizeJsonbValue({
        key: "safe",
        text: "model\0cache",
        nested: [{ "hash\0key": "value\0tail" }],
      }),
    ).toEqual({
      key: "safe",
      text: "model\\u0000cache",
      nested: [{ "hash\\u0000key": "value\\u0000tail" }],
    });
  });

  test("preserves object identity when no strings need sanitizing", () => {
    const value = {
      parts: [{ type: "text", text: "hello" }],
    };

    expect(sanitizeJsonbValue(value)).toBe(value);
  });
});
