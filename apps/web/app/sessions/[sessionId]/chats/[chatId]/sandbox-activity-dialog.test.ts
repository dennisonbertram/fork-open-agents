import { describe, expect, test } from "bun:test";
import {
  SANDBOX_ACTIVITY_HEADER_CONTENT_CLASS_NAME,
  SANDBOX_ACTIVITY_STATUS_BADGE_CLASS_NAME,
  SANDBOX_ACTIVITY_TITLE_CLASS_NAME,
} from "./sandbox-activity-dialog";

describe("sandbox activity dialog layout", () => {
  test("keeps the status badge near the title and away from the close button", () => {
    expect(SANDBOX_ACTIVITY_HEADER_CONTENT_CLASS_NAME).toContain("pr-8");
    expect(SANDBOX_ACTIVITY_HEADER_CONTENT_CLASS_NAME).not.toContain(
      "justify-between",
    );
    expect(SANDBOX_ACTIVITY_TITLE_CLASS_NAME).toContain("flex-wrap");
    expect(SANDBOX_ACTIVITY_STATUS_BADGE_CLASS_NAME).toContain("py-0.5");
  });
});
