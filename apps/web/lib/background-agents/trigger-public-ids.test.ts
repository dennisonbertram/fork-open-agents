import { describe, expect, test } from "bun:test";
import {
  getExistingWebhookPublicIds,
  getWebhookPublicIdForUpdatedTrigger,
} from "./trigger-public-ids";

describe("webhook public id preservation", () => {
  test("preserves existing webhook public ids when triggers are replaced on edit", () => {
    const existingWebhookPublicIds = getExistingWebhookPublicIds([
      {
        kind: "github.pull_request",
        webhookPublicId: null,
      },
      {
        kind: "webhook.error",
        webhookPublicId: "wh_existing",
      },
    ]);

    expect(
      getWebhookPublicIdForUpdatedTrigger({
        trigger: { kind: "webhook.error" },
        existingWebhookPublicIds,
      }),
    ).toBe("wh_existing");
    expect(existingWebhookPublicIds).toEqual([]);
  });

  test("keeps non-webhook triggers without public ids", () => {
    expect(
      getWebhookPublicIdForUpdatedTrigger({
        trigger: { kind: "github.issue" },
        existingWebhookPublicIds: ["wh_existing"],
      }),
    ).toBeNull();
  });
});
