import { createHmac } from "crypto";
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const dispatchWebhookErrorEvent = mock(async () => ({
  enabled: true,
  matched: 1,
  created: 1,
  duplicates: 0,
  runIds: ["run-1"],
}));

mock.module("@/lib/background-agents/dispatcher", () => ({
  dispatchWebhookErrorEvent,
}));

const routeModulePromise = import("./route");

function sign(payload: string, secret: string) {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

function context(publicId = "wh_123") {
  return {
    params: Promise.resolve({ publicId }),
  };
}

describe("POST /api/background-agents/webhook/[publicId]", () => {
  beforeEach(() => {
    process.env.BACKGROUND_AGENTS_WEBHOOK_SECRET = "webhook-secret";
    dispatchWebhookErrorEvent.mockClear();
  });

  test("rejects invalid signatures", async () => {
    const { POST } = await routeModulePromise;
    const payload = JSON.stringify({ externalId: "err-1" });

    const response = await POST(
      new Request("http://localhost/api/background-agents/webhook/wh_123", {
        method: "POST",
        body: payload,
        headers: {
          "x-open-agents-signature": sign(payload, "wrong-secret"),
        },
      }),
      context(),
    );

    expect(response.status).toBe(401);
    expect(dispatchWebhookErrorEvent).not.toHaveBeenCalled();
  });

  test("dispatches signed error events", async () => {
    const { POST } = await routeModulePromise;
    const payload = JSON.stringify({
      externalId: "err-1",
      severity: "critical",
      title: "Checkout failure",
    });

    const response = await POST(
      new Request("http://localhost/api/background-agents/webhook/wh_123", {
        method: "POST",
        body: payload,
        headers: {
          "x-open-agents-signature": sign(payload, "webhook-secret"),
          "x-request-id": "req-1",
        },
      }),
      context(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.runIds).toEqual(["run-1"]);
    expect(dispatchWebhookErrorEvent).toHaveBeenCalledWith({
      webhookPublicId: "wh_123",
      event: {
        externalId: "err-1",
        severity: "critical",
        title: "Checkout failure",
      },
      requestId: "req-1",
    });
  });
});
