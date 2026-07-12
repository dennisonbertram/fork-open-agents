import { describe, expect, it } from "bun:test";
import { backgroundAgentErrorKinds } from "@/lib/background-agents/types";
import {
  ALL_KNOWN_BACKGROUND_RUN_ERROR_KINDS,
  getBackgroundRunErrorCopy,
} from "./error-copy";

describe("getBackgroundRunErrorCopy", () => {
  it("returns whatHappened + whatToDo copy for every known errorKind", () => {
    for (const kind of ALL_KNOWN_BACKGROUND_RUN_ERROR_KINDS) {
      const copy = getBackgroundRunErrorCopy(kind);
      expect(copy.whatHappened).toBeTruthy();
      expect(copy.whatToDo).toBeTruthy();
      expect(copy.isKnown).toBe(true);
    }
  });

  it("falls back to an honest generic message for an unknown kind", () => {
    const copy = getBackgroundRunErrorCopy(
      "some_future_kind_nobody_mapped_yet",
    );
    expect(copy.isKnown).toBe(false);
    expect(copy.whatHappened).toBeTruthy();
    expect(copy.whatToDo).toBeTruthy();
    expect(copy.rawKind).toBe("some_future_kind_nobody_mapped_yet");
  });

  it("maps permission_missing to a GitHub-connect/access action with an href", () => {
    const copy = getBackgroundRunErrorCopy("permission_missing");
    expect(copy.whatToDo.toLowerCase()).toMatch(/access|permission|github/);
    expect(copy.actionHref).toBe("/settings/connections");
  });

  it("maps installation_missing to a GitHub-connect action with an href", () => {
    const copy = getBackgroundRunErrorCopy("installation_missing");
    expect(copy.whatToDo.toLowerCase()).toContain("github");
    expect(copy.actionHref).toBe("/settings/connections");
  });

  it("never echoes raw errorMessage content into headline copy", () => {
    const copy = getBackgroundRunErrorCopy("sandbox_unavailable", {
      errorMessage:
        "Failed to connect sandbox: ECONNREFUSED at internal-host:9999 token=SECRET123",
    });
    expect(copy.whatHappened).not.toContain("SECRET123");
    expect(copy.whatHappened).not.toContain("internal-host");
    expect(copy.whatToDo).not.toContain("SECRET123");
  });

  it("stays in sync with backgroundAgentErrorKinds in lib/background-agents/types.ts", () => {
    const knownSet = new Set<string>(ALL_KNOWN_BACKGROUND_RUN_ERROR_KINDS);
    for (const kind of backgroundAgentErrorKinds) {
      expect(knownSet.has(kind)).toBe(true);
    }
  });
});
