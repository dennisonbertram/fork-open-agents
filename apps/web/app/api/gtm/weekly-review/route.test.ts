import { beforeEach, describe, expect, mock, test } from "bun:test";
import { GtmWeeklyReviewError } from "@/lib/gtm-weekly-review/types";

mock.module("server-only", () => ({}));

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

let authResult: AuthResult = { ok: true, userId: "operator-1" };
const runGtmWeeklyReview = mock(async () => ({
  reviewRunId: "run-1",
  status: "blocked",
  experimentSummaries: [],
  sourceGaps: [],
  nextBets: [],
  learningCandidates: [],
  approvalIds: [],
  persistedLearningIds: [],
  dedupedCount: 0,
}));
const listActiveGtmLearningsForContext = mock(async () => [
  {
    learningId: "insight-1",
    title: "Founder DMs work",
    summary: "Founder-led outreach produced replies.",
    confidence: "medium",
    sourceId: "run-1",
    evidenceRefs: [],
    updatedAt: new Date("2026-06-27T00:00:00Z"),
  },
]);

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/gtm-weekly-review/store", () => ({
  runGtmWeeklyReview,
  listActiveGtmLearningsForContext,
}));

const routeModulePromise = import("./route");

describe("/api/gtm/weekly-review", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "operator-1" };
    runGtmWeeklyReview.mockClear();
    listActiveGtmLearningsForContext.mockClear();
  });

  test("requires authentication for weekly review runs", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/gtm/weekly-review", {
        method: "POST",
        body: "{}",
      }),
    );

    expect(response.status).toBe(401);
    expect(runGtmWeeklyReview).not.toHaveBeenCalled();
  });

  test("runs a user-scoped weekly review with explicit approvals", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/gtm/weekly-review", {
        method: "POST",
        headers: { "x-request-id": "req-1" },
        body: JSON.stringify({
          weekStart: "2026-06-22",
          weekEnd: "2026-06-29",
          approvals: [{ candidateKey: "experiment-1", decision: "approved" }],
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(runGtmWeeklyReview).toHaveBeenCalledWith({
      userId: "operator-1",
      requestId: "req-1",
      weekStart: "2026-06-22",
      weekEnd: "2026-06-29",
      approvals: [{ candidateKey: "experiment-1", decision: "approved" }],
    });
  });

  test("lists active GTM learning context", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.learnings[0].learningId).toBe("insight-1");
    expect(listActiveGtmLearningsForContext).toHaveBeenCalledWith("operator-1");
  });

  test("returns typed weekly review errors", async () => {
    runGtmWeeklyReview.mockRejectedValue(
      new GtmWeeklyReviewError("invalid_review_window", "Bad window"),
    );
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/gtm/weekly-review", {
        method: "POST",
        body: JSON.stringify({
          weekStart: "nope",
          weekEnd: "2026-06-29",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errorKind).toBe("invalid_review_window");
  });
});
