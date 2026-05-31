import { createHmac } from "crypto";
import { describe, expect, test } from "bun:test";
import { verifyBackgroundWebhookSignature } from "./signature";

function sign(payload: string, secret: string) {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

describe("verifyBackgroundWebhookSignature", () => {
  test("accepts valid signatures", () => {
    const payload = JSON.stringify({ externalId: "err-1" });
    expect(
      verifyBackgroundWebhookSignature({
        payload,
        secret: "secret",
        signatureHeader: sign(payload, "secret"),
      }),
    ).toBe(true);
  });

  test("rejects missing or invalid signatures", () => {
    const payload = JSON.stringify({ externalId: "err-1" });
    expect(
      verifyBackgroundWebhookSignature({
        payload,
        secret: "secret",
        signatureHeader: null,
      }),
    ).toBe(false);
    expect(
      verifyBackgroundWebhookSignature({
        payload,
        secret: "secret",
        signatureHeader: sign(payload, "other-secret"),
      }),
    ).toBe(false);
  });
});
