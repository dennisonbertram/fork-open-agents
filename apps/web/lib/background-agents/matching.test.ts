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

  // TASK-274: mergedOnly condition
  test("mergedOnly:true does not match closed PR with merged:false", () => {
    const closedNotMerged: NormalizedBackgroundTriggerEvent = {
      source: "github",
      kind: "github.pull_request",
      externalId: "pr:2:closed:abc",
      repoOwner: "acme",
      repoName: "widgets",
      action: "closed",
      merged: false,
    };
    expect(
      triggerMatchesEvent(
        { conditions: { actions: ["closed"], mergedOnly: true } },
        closedNotMerged,
      ),
    ).toBe(false);
  });

  test("mergedOnly:true matches closed PR with merged:true", () => {
    const closedMerged: NormalizedBackgroundTriggerEvent = {
      source: "github",
      kind: "github.pull_request",
      externalId: "pr:3:closed:def",
      repoOwner: "acme",
      repoName: "widgets",
      action: "closed",
      merged: true,
    };
    expect(
      triggerMatchesEvent(
        { conditions: { actions: ["closed"], mergedOnly: true } },
        closedMerged,
      ),
    ).toBe(true);
  });

  test("absent mergedOnly behaves as before (does not filter on merged)", () => {
    const closedNotMerged: NormalizedBackgroundTriggerEvent = {
      source: "github",
      kind: "github.pull_request",
      externalId: "pr:4:closed:ghi",
      repoOwner: "acme",
      repoName: "widgets",
      action: "closed",
      merged: false,
    };
    expect(
      triggerMatchesEvent(
        { conditions: { actions: ["closed"] } },
        closedNotMerged,
      ),
    ).toBe(true);
  });

  test("mergedOnly:false does not filter — matches regardless of merged", () => {
    const closedNotMerged: NormalizedBackgroundTriggerEvent = {
      source: "github",
      kind: "github.pull_request",
      externalId: "pr:5:closed:jkl",
      repoOwner: "acme",
      repoName: "widgets",
      action: "closed",
      merged: false,
    };
    expect(
      triggerMatchesEvent(
        { conditions: { actions: ["closed"], mergedOnly: false } },
        closedNotMerged,
      ),
    ).toBe(true);
  });
});
