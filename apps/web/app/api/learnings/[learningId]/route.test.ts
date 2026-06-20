import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

type LearningRow = {
  id: string;
  userId: string;
  repoOwner: string;
  repoName: string;
  confidence: "proven" | "high" | "medium" | "low" | "speculative";
  status: "active" | "consolidation_review" | "archived" | "superseded";
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  evidence: [];
};

let authResult: AuthResult = { ok: true, userId: "user-1" };
let learningRow: LearningRow | undefined;

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

const getRepoLearningWithEvidence = mock(async () => learningRow);
const updateOwnedRepoLearning = mock(
  async ({ updates }: { updates: Partial<LearningRow> }) => {
    if (!learningRow || learningRow.userId !== "user-1") {
      return undefined;
    }
    learningRow = { ...learningRow, ...updates };
    return learningRow;
  },
);

mock.module("@/lib/learnings/store", () => ({
  getRepoLearningWithEvidence,
  updateOwnedRepoLearning,
}));

function applyUpdates(updates: Partial<LearningRow>) {
  if (learningRow) {
    learningRow = { ...learningRow, ...updates };
  }
}

const routeModulePromise = import("./route");

describe("/api/learnings/[learningId]", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    learningRow = {
      id: "learning-1",
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      confidence: "medium",
      status: "active",
      lastUsedAt: null,
      createdAt: new Date("2026-06-19T12:00:00.000Z"),
      updatedAt: new Date("2026-06-19T12:00:00.000Z"),
      evidence: [],
    };
    getRepoLearningWithEvidence.mockClear();
    updateOwnedRepoLearning.mockClear();
    updateOwnedRepoLearning.mockImplementation(
      async ({ updates }: { updates: Partial<LearningRow> }) => {
        if (!learningRow || learningRow.userId !== "user-1") {
          return undefined;
        }
        applyUpdates(updates);
        return learningRow;
      },
    );
  });

  test("PATCH archives an owned learning", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      new Request("http://localhost/api/learnings/learning-1", {
        method: "PATCH",
        body: JSON.stringify({ status: "archived" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ learningId: "learning-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.learning.status).toBe("archived");
    expect(updateOwnedRepoLearning).toHaveBeenCalledWith({
      userId: "user-1",
      learningId: "learning-1",
      updates: { status: "archived" },
    });
    expect(learningRow?.status).toBe("archived");
  });

  test("PATCH rejects non-owner mutations", async () => {
    learningRow = {
      id: "learning-1",
      userId: "user-2",
      repoOwner: "acme",
      repoName: "widgets",
      confidence: "medium",
      status: "active",
      lastUsedAt: null,
      createdAt: new Date("2026-06-19T12:00:00.000Z"),
      updatedAt: new Date("2026-06-19T12:00:00.000Z"),
      evidence: [],
    };
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      new Request("http://localhost/api/learnings/learning-1", {
        method: "PATCH",
        body: JSON.stringify({ status: "archived" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ learningId: "learning-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.errorKind).toBe("not_owner");
    expect(updateOwnedRepoLearning).not.toHaveBeenCalled();
  });

  test("PATCH rejects non-allowlisted fields with a typed errorKind", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      new Request("http://localhost/api/learnings/learning-1", {
        method: "PATCH",
        body: JSON.stringify({ title: "mutate provenance" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ learningId: "learning-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errorKind).toBe("validation_failed");
    expect(updateOwnedRepoLearning).not.toHaveBeenCalled();
  });
});
