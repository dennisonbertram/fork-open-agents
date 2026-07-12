import { describe, expect, mock, test } from "bun:test";
import type { NormalizedBackgroundTriggerEvent } from "./types";
import type { LearningsStore } from "../learnings/types";
import { runLearningsExtraction } from "../learnings/runner";

mock.module("server-only", () => ({}));

// ---- Fake LLM generate ----
function makeFakeGenerate(overrides?: {
  title?: string;
  description?: string;
  rootCause?: string;
  solution?: string;
  prevention?: string;
  type?: string;
  scope?: string;
  affectedPaths?: string[];
  tags?: string[];
  severity?: string;
  confidence?: string;
  actionable?: boolean;
  qualityScore?: number;
  reviewerSourced?: boolean;
  excerpt?: string;
}) {
  return async (_prompt: string) => ({
    candidates: [
      {
        title: overrides?.title ?? "Avoid global state",
        description:
          overrides?.description ??
          "Global state causes unpredictable re-renders in React",
        rootCause: overrides?.rootCause ?? "Shared mutable state",
        solution: overrides?.solution ?? "Use local state with useState",
        prevention: overrides?.prevention ?? "Prefer component-local state",
        type: overrides?.type ?? "convention",
        scope: overrides?.scope ?? "repo",
        affectedPaths: overrides?.affectedPaths ?? ["src/App.tsx"],
        tags: overrides?.tags ?? ["react", "state"],
        severity: overrides?.severity ?? "medium",
        confidence: overrides?.confidence ?? "medium",
        actionable: overrides?.actionable ?? true,
        qualityScore: overrides?.qualityScore ?? 4,
        reviewerSourced: overrides?.reviewerSourced ?? false,
        excerpt:
          overrides?.excerpt ?? "Use useState instead of global variables",
      },
    ],
  });
}

// ---- Fake store ----
function makeFakeStore(): LearningsStore & {
  learnings: unknown[];
  runs: unknown[];
  events: unknown[];
} {
  const store = {
    learnings: [] as unknown[],
    runs: [] as unknown[],
    events: [] as unknown[],

    async findForDedup(_params: {
      userId: string;
      repoOwner: string;
      repoName: string;
    }) {
      return store.learnings as Awaited<
        ReturnType<LearningsStore["findForDedup"]>
      >;
    },

    async createLearning(learning: unknown) {
      store.learnings.push(learning);
      return { id: "fake-id-1", ...(learning as object) } as Awaited<
        ReturnType<LearningsStore["createLearning"]>
      >;
    },

    async updateLearning(id: string, updates: unknown) {
      const idx = store.learnings.findIndex(
        (l) => (l as Record<string, unknown>)["id"] === id,
      );
      if (idx >= 0) {
        store.learnings[idx] = {
          ...(store.learnings[idx] as object),
          ...(updates as object),
        };
      }
      return { id, ...(updates as object) } as Awaited<
        ReturnType<LearningsStore["updateLearning"]>
      >;
    },

    async recordExtractionRun(run: unknown) {
      store.runs.push(run);
      return { id: "fake-run-id", ...(run as object) } as Awaited<
        ReturnType<LearningsStore["recordExtractionRun"]>
      >;
    },
  };
  return store;
}

// ---- Fake octokit ----
function makeFakeOctokit(diff = "diff --git a/src/App.tsx\n+Use local state") {
  return {
    rest: {
      pulls: {
        get: async () => ({
          data: {
            number: 42,
            title: "Refactor state management",
            body: "This PR refactors React state to use local state",
            head: { sha: "abc123" },
            base: { ref: "main" },
            user: { login: "author" },
            merged: true,
          },
        }),
        listFiles: async () => ({
          data: [
            {
              filename: "src/App.tsx",
              status: "modified",
              patch: "+import { useState } from 'react'",
            },
          ],
        }),
      },
    },
    request: async (_url: string) => ({ data: diff }),
  };
}

// ---- Fake recordEvent ----
function makeFakeRecordEvent() {
  const events: unknown[] = [];
  const fn = async (params: unknown) => {
    events.push(params);
  };
  fn.events = events;
  return fn as typeof fn & { events: unknown[] };
}

const mergedPREvent: NormalizedBackgroundTriggerEvent = {
  source: "github",
  kind: "github.pull_request",
  externalId: "pull_request:200:closed:abc123",
  repoOwner: "owner",
  repoName: "repo",
  action: "closed",
  merged: true,
  prNumber: 42,
  sha: "abc123",
  ref: "feature",
  branch: "main",
};

describe("runLearningsExtraction", () => {
  test("rechecks live authorization immediately before provider, model, and store boundaries", async () => {
    const operations: string[] = [];
    const store = makeFakeStore();
    const guardedStore: LearningsStore = {
      findForDedup: async (params) => {
        operations.push("store.findForDedup");
        return store.findForDedup(params);
      },
      createLearning: async (learning) => {
        operations.push("store.createLearning");
        return store.createLearning(learning);
      },
      updateLearning: async (id, updates) => {
        operations.push("store.updateLearning");
        return store.updateLearning(id, updates);
      },
      recordExtractionRun: async (run) => {
        operations.push("store.recordExtractionRun");
        return store.recordExtractionRun(run);
      },
    };
    const octokit = makeFakeOctokit();
    const guardedOctokit = {
      rest: {
        pulls: {
          get: async (...args: Parameters<typeof octokit.rest.pulls.get>) => {
            operations.push("github.get");
            return octokit.rest.pulls.get(...args);
          },
          listFiles: async (
            ...args: Parameters<typeof octokit.rest.pulls.listFiles>
          ) => {
            operations.push("github.listFiles");
            return octokit.rest.pulls.listFiles(...args);
          },
        },
      },
      request: async (...args: Parameters<typeof octokit.request>) => {
        operations.push("github.request");
        return octokit.request(...args);
      },
    };

    await runLearningsExtraction({
      event: mergedPREvent,
      userId: "user-123",
      installationId: 99,
      backgroundAgentRunId: "run-guard-order",
      octokit: guardedOctokit,
      generate: async (prompt) => {
        operations.push("model.generate");
        return makeFakeGenerate()(prompt);
      },
      store: guardedStore,
      recordEvent: async () => {
        operations.push("event.record");
      },
      assertLiveAuthorization: async () => {
        operations.push("authorize");
      },
    });

    for (const [index, operation] of operations.entries()) {
      if (
        operation === "model.generate" ||
        operation.startsWith("store.") ||
        operation === "event.record"
      ) {
        expect(operations[index - 1]).toBe("authorize");
      }
    }
    const firstGithubOperation = operations.findIndex((operation) =>
      operation.startsWith("github."),
    );
    expect(firstGithubOperation).toBeGreaterThan(0);
    expect(operations[firstGithubOperation - 1]).toBe("authorize");
    expect(operations.at(-1)).toBe("authorize");
  });

  test("stops before a persistent store write when live authorization is revoked", async () => {
    const store = makeFakeStore();
    let modelCompleted = false;

    await expect(
      runLearningsExtraction({
        event: mergedPREvent,
        userId: "user-123",
        installationId: 99,
        backgroundAgentRunId: "run-revoked-before-store",
        octokit: makeFakeOctokit() as unknown as Parameters<
          typeof runLearningsExtraction
        >[0]["octokit"],
        generate: async (prompt) => {
          const result = await makeFakeGenerate()(prompt);
          modelCompleted = true;
          return result;
        },
        store,
        recordEvent: async () => undefined,
        assertLiveAuthorization: async () => {
          if (modelCompleted) throw new Error("authorization revoked");
        },
      }),
    ).rejects.toThrow("authorization revoked");
    expect(store.learnings).toHaveLength(0);
    expect(store.runs).toHaveLength(0);
  });

  // BT-016: merged-PR drives extraction, persists one learning (single-source confidence="medium"), one extraction-run summary (accepted=1), emits redacted event
  test("merged PR event: persists one learning with confidence medium and one extraction run with accepted=1", async () => {
    const store = makeFakeStore();
    const recordEvent = makeFakeRecordEvent();

    const result = await runLearningsExtraction({
      event: mergedPREvent,
      userId: "user-123",
      installationId: 99,
      backgroundAgentRunId: "run-abc",
      octokit: makeFakeOctokit() as unknown as Parameters<
        typeof runLearningsExtraction
      >[0]["octokit"],
      generate: makeFakeGenerate() as unknown as Parameters<
        typeof runLearningsExtraction
      >[0]["generate"],
      store,
      recordEvent,
    });

    expect(result.candidatesExtracted).toBeGreaterThanOrEqual(1);
    expect(result.accepted).toBe(1);
    expect(store.learnings).toHaveLength(1);
    // Single-source learning gets confidence="medium"
    expect((store.learnings[0] as Record<string, unknown>)["confidence"]).toBe(
      "medium",
    );
    // One extraction run summary
    expect(store.runs).toHaveLength(1);
    expect((store.runs[0] as Record<string, unknown>)["accepted"]).toBe(1);
    // At least one event emitted
    expect(recordEvent.events.length).toBeGreaterThan(0);
  });

  // BT-017: candidate with planted secret is dropped before persist, errorKind=redaction_blocked
  test("candidate with planted secret is dropped (redaction_blocked) and not persisted", async () => {
    const store = makeFakeStore();
    const recordEvent = makeFakeRecordEvent();
    const secretExcerpt =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA0Z3VS5JJcds3x\n-----END RSA PRIVATE KEY-----";

    const result = await runLearningsExtraction({
      event: mergedPREvent,
      userId: "user-123",
      installationId: 99,
      backgroundAgentRunId: "run-secret",
      octokit: makeFakeOctokit() as unknown as Parameters<
        typeof runLearningsExtraction
      >[0]["octokit"],
      generate: makeFakeGenerate({
        excerpt: secretExcerpt,
      }) as unknown as Parameters<typeof runLearningsExtraction>[0]["generate"],
      store,
      recordEvent,
    });

    expect(store.learnings).toHaveLength(0);
    expect(result.rejected).toBeGreaterThanOrEqual(1);
    expect(result.errorKind).toBe("redaction_blocked");
  });

  // BT-018: reviewer-sourced candidate starts at confidence="low"
  test("reviewer-sourced candidate starts at confidence=low", async () => {
    const store = makeFakeStore();
    const recordEvent = makeFakeRecordEvent();

    await runLearningsExtraction({
      event: mergedPREvent,
      userId: "user-123",
      installationId: 99,
      backgroundAgentRunId: "run-reviewer",
      octokit: makeFakeOctokit() as unknown as Parameters<
        typeof runLearningsExtraction
      >[0]["octokit"],
      generate: makeFakeGenerate({
        reviewerSourced: true,
      }) as unknown as Parameters<typeof runLearningsExtraction>[0]["generate"],
      store,
      recordEvent,
    });

    expect(store.learnings).toHaveLength(1);
    expect((store.learnings[0] as Record<string, unknown>)["confidence"]).toBe(
      "low",
    );
  });

  // BT-019: non-merged event does not trigger extraction
  test("non-merged PR event (merged:false) does not persist any learning", async () => {
    const store = makeFakeStore();
    const recordEvent = makeFakeRecordEvent();
    const closedNotMergedEvent: NormalizedBackgroundTriggerEvent = {
      ...mergedPREvent,
      merged: false,
      action: "closed",
    };

    const result = await runLearningsExtraction({
      event: closedNotMergedEvent,
      userId: "user-123",
      installationId: 99,
      backgroundAgentRunId: "run-closed",
      octokit: makeFakeOctokit() as unknown as Parameters<
        typeof runLearningsExtraction
      >[0]["octokit"],
      generate: makeFakeGenerate() as unknown as Parameters<
        typeof runLearningsExtraction
      >[0]["generate"],
      store,
      recordEvent,
    });

    expect(store.learnings).toHaveLength(0);
    expect(result.accepted).toBe(0);
  });
});
