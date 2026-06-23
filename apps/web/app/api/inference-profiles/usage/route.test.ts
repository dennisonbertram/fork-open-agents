import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { InferenceProfileUsageSummaryRow } from "@/lib/db/usage";

mock.module("server-only", () => ({}));

let currentSession: { user: { id: string } } | null = {
  user: { id: "user-1" },
};
let usageRows: InferenceProfileUsageSummaryRow[] = [];
const usageCalls: string[] = [];

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () =>
    currentSession?.user
      ? { ok: true, userId: currentSession.user.id }
      : {
          ok: false,
          response: Response.json(
            { error: "Not authenticated" },
            { status: 401 },
          ),
        },
}));

mock.module("@/lib/db/usage", () => ({
  getInferenceProfileUsageSummary: async (userId: string) => {
    usageCalls.push(userId);
    return usageRows;
  },
}));

const routeModulePromise = import("./route");

describe("/api/inference-profiles/usage", () => {
  beforeEach(() => {
    currentSession = { user: { id: "user-1" } };
    usageRows = [
      {
        inferenceProfileId: "profile-fireworks",
        provider: "anthropic",
        modelId: "accounts/fireworks/models/glm-5.2",
        inputTokens: 10_000,
        cachedInputTokens: 2_000,
        outputTokens: 5_000,
        messageCount: 3,
        toolCallCount: 4,
      },
    ];
    usageCalls.length = 0;
  });

  test("returns usage summaries for the authenticated user", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET();
    const body = (await response.json()) as {
      usage: InferenceProfileUsageSummaryRow[];
    };

    expect(response.status).toBe(200);
    expect(usageCalls).toEqual(["user-1"]);
    expect(body.usage).toEqual(usageRows);
  });

  test("returns 401 when unauthenticated", async () => {
    currentSession = null;
    const { GET } = await routeModulePromise;

    const response = await GET();
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe("Not authenticated");
    expect(usageCalls).toEqual([]);
  });
});
