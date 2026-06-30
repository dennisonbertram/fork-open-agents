import { describe, expect, test } from "bun:test";
import { buildGtmSnapshot } from "./snapshot";

const now = new Date("2026-06-30T12:00:00.000Z");

describe("GTM coordinator snapshot", () => {
  test("surfaces draft signals, pending approvals, source gaps, and next actions", async () => {
    const snapshot = await buildGtmSnapshot({
      userId: "user-1",
      window: "24h",
      now,
      loaders: {
        accounts: async () => [],
        signals: async () => [
          {
            id: "signal-1",
            kind: "pain",
            status: "draft",
            confidence: "medium",
            summary: "Prospects need approval-safe agents",
            accountId: "account-1",
            contactId: null,
            updatedAt: new Date("2026-06-30T10:00:00.000Z"),
            metadata: { prompt: "raw prompt should not leak" },
          },
        ],
        experiments: async () => [],
        approvals: async () => [
          {
            id: "approval-1",
            actionKind: "send_email",
            targetKind: "touchpoint",
            targetId: "touchpoint-1",
            status: "pending",
            updatedAt: new Date("2026-06-30T11:00:00.000Z"),
          },
        ],
      },
    });

    expect(snapshot.window.hours).toBe(24);
    expect(snapshot.needsAttention.map((item) => item.id)).toEqual([
      "approval-1",
      "signal-1",
    ]);
    expect(snapshot.waiting.map((item) => item.id)).toEqual(["approval-1"]);
    expect(snapshot.sourceStatus).toContainEqual(
      expect.objectContaining({
        source: "product_shipments",
        status: "missing",
      }),
    );
    expect(snapshot.nextActions[0]).toMatchObject({
      label: "review pending GTM approval",
      requiresAuthorization: true,
    });
    expect(snapshot.needsAttention[1]?.metadata?.prompt).toMatch("[redacted:");
  });

  test("keeps partial source failures explicit without dropping healthy sources", async () => {
    const snapshot = await buildGtmSnapshot({
      userId: "user-1",
      window: "bad",
      now,
      loaders: {
        accounts: async () => [],
        signals: async () => {
          throw new Error("token=secret");
        },
        experiments: async () => [
          {
            id: "experiment-1",
            title: "Founder-led launch follow-up",
            status: "completed",
            channel: "email",
            outcomeSummary: "3 replies",
            updatedAt: new Date("2026-06-30T09:00:00.000Z"),
          },
        ],
        approvals: async () => [],
      },
    });

    expect(snapshot.window.hours).toBe(24);
    expect(snapshot.recentlyCompleted.map((item) => item.id)).toEqual([
      "experiment-1",
    ]);
    expect(snapshot.sourceStatus).toContainEqual(
      expect.objectContaining({
        source: "account_work",
        status: "failed",
        errorKind: "gtm_source_schema_mismatch",
      }),
    );
  });
});
