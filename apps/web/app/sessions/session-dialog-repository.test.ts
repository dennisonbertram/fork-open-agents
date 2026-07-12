import { describe, expect, test } from "bun:test";
import { nextSessionDialogRepository } from "./session-dialog-repository";

describe("nextSessionDialogRepository", () => {
  test("sets an explicit repository when opening from repository context", () => {
    expect(
      nextSessionDialogRepository(null, {
        type: "open",
        repository: { owner: "acme", repo: "widgets" },
      }),
    ).toEqual({ owner: "acme", repo: "widgets" });
  });

  test("clears a stale repository on close and on a later generic open", () => {
    const seeded = { owner: "acme", repo: "widgets" };
    expect(nextSessionDialogRepository(seeded, { type: "close" })).toBeNull();
    expect(
      nextSessionDialogRepository(seeded, {
        type: "open",
        repository: undefined,
      }),
    ).toBeNull();
  });
});
