import { describe, expect, test } from "bun:test";
import { getSkillActionLabels } from "./skills-section";

describe("getSkillActionLabels", () => {
  test("names edit/delete/toggle actions with the target slash skill", () => {
    expect(getSkillActionLabels("code-review", true)).toEqual({
      edit: "Edit /code-review",
      delete: "Delete /code-review",
      toggle: "Disable /code-review",
    });

    expect(getSkillActionLabels("code-review", false).toggle).toBe(
      "Enable /code-review",
    );
  });
});
