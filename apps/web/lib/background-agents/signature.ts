import { createHmac, timingSafeEqual } from "crypto";

export function verifyBackgroundWebhookSignature(params: {
  payload: string;
  signatureHeader: string | null;
  secret: string;
}): boolean {
  if (!params.signatureHeader) {
    return false;
  }

  const digest = createHmac("sha256", params.secret)
    .update(params.payload)
    .digest("hex");
  const expected = Buffer.from(`sha256=${digest}`);
  const provided = Buffer.from(params.signatureHeader);

  if (expected.length !== provided.length) {
    return false;
  }

  return timingSafeEqual(expected, provided);
}
