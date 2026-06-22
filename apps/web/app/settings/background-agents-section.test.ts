import { describe, expect, test } from "bun:test";
import {
  getBackgroundAgentActionLabels,
  getBackgroundRunActionLabels,
} from "./background-agents-section";

describe("background agent action labels", () => {
  test("include the target agent and repository", () => {
    expect(
      getBackgroundAgentActionLabels({
        name: "PR Backlog Maintainer",
        repoOwner: "dennisonbertram",
        repoName: "fork-open-agents",
      }),
    ).toEqual({
      edit: "Edit background agent PR Backlog Maintainer",
      test: "Test background agent PR Backlog Maintainer",
      repo: "Open agent settings for dennisonbertram/fork-open-agents",
      delete: "Delete background agent PR Backlog Maintainer",
      copyWebhook: "Copy webhook URL for PR Backlog Maintainer",
    });
  });

  test("include the target run repository and ref", () => {
    expect(
      getBackgroundRunActionLabels({
        id: "run_1",
        status: "succeeded",
        source: "github",
        triggerKind: "pull_request",
        externalId: "ext",
        repoOwner: "dennisonbertram",
        repoName: "fork-open-agents",
        ref: "refs/pull/1/head",
        sha: null,
        branch: "feature",
        prNumber: 123,
        issueNumber: null,
        outputKind: "pull_request",
        outputUrl: "https://github.com/example/pr/1",
        errorKind: null,
        createdAt: "2026-06-22T00:00:00.000Z",
        startedAt: null,
        finishedAt: null,
      }).details,
    ).toBe(
      "Open details for background run dennisonbertram/fork-open-agents PR #123",
    );
  });
});
