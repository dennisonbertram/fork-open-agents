import { describe, expect, test } from "bun:test";
import { triggerMatchesEvent } from "./matching";
import type { NormalizedBackgroundTriggerEvent } from "./types";

const baseEvent: NormalizedBackgroundTriggerEvent = {
  source: "github",
  kind: "github.pull_request",
  externalId: "pr:1",
  repoOwner: "dennisonbertram",
  repoName: "fork-open-agents",
  action: "opened",
  branch: "main",
  labels: ["bug", "ui"],
};

describe("triggerMatchesEvent", () => {
  test("matches when no conditions are configured", () => {
    expect(triggerMatchesEvent({ conditions: {} }, baseEvent)).toBe(true);
  });

  test("requires configured action and branch", () => {
    expect(
      triggerMatchesEvent(
        { conditions: { actions: ["opened"], branches: ["main"] } },
        baseEvent,
      ),
    ).toBe(true);
    expect(
      triggerMatchesEvent(
        { conditions: { actions: ["closed"], branches: ["main"] } },
        baseEvent,
      ),
    ).toBe(false);
    expect(
      triggerMatchesEvent(
        { conditions: { actions: ["opened"], branches: ["release"] } },
        baseEvent,
      ),
    ).toBe(false);
  });

  test("matches when any configured label is present", () => {
    expect(
      triggerMatchesEvent(
        { conditions: { labels: ["security", "ui"] } },
        baseEvent,
      ),
    ).toBe(true);
    expect(
      triggerMatchesEvent({ conditions: { labels: ["security"] } }, baseEvent),
    ).toBe(false);
  });
});
