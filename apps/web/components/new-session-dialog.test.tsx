import { describe, expect, test } from "bun:test";

describe("NewSessionDialog", () => {
  test("uses session language for the accessible dialog title", async () => {
    // The launcher button says "New Session"; keep the sr-only dialog title in
    // the same vocabulary even though the first tab inside the dialog is "New chat".
    const { NEW_SESSION_DIALOG_TITLE } = await import("./new-session-dialog");

    expect(NEW_SESSION_DIALOG_TITLE).toBe("New session");
  });
});
