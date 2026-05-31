import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_VERSION = 1;
const MAX_TTL_MS = 24 * 60 * 60 * 1000;

type DiagnosticTokenPayload = {
  v: typeof TOKEN_VERSION;
  sid: string;
  cid: string;
  exp: number;
};

function getTokenSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET ?? process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "BETTER_AUTH_SECRET or ENCRYPTION_KEY is required for diagnostic bundle tokens",
    );
  }
  return secret;
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(encodedPayload: string): string {
  return createHmac("sha256", getTokenSecret())
    .update(encodedPayload)
    .digest("base64url");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePayload(value: unknown): DiagnosticTokenPayload | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    value.v !== TOKEN_VERSION ||
    typeof value.sid !== "string" ||
    typeof value.cid !== "string" ||
    typeof value.exp !== "number"
  ) {
    return null;
  }

  return {
    v: TOKEN_VERSION,
    sid: value.sid,
    cid: value.cid,
    exp: value.exp,
  };
}

export function createDiagnosticBundleToken(params: {
  sessionId: string;
  chatId: string;
  expiresAt: Date;
}): string {
  const now = Date.now();
  const expiresAtMs = Math.min(params.expiresAt.getTime(), now + MAX_TTL_MS);
  const payload: DiagnosticTokenPayload = {
    v: TOKEN_VERSION,
    sid: params.sessionId,
    cid: params.chatId,
    exp: expiresAtMs,
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  return `${encodedPayload}.${signPayload(encodedPayload)}`;
}

export function verifyDiagnosticBundleToken(params: {
  token: string;
  sessionId: string;
  chatId: string;
  now?: Date;
}): boolean {
  const [encodedPayload, signature, extra] = params.token.split(".");
  if (!encodedPayload || !signature || extra !== undefined) {
    return false;
  }

  const expectedSignature = signPayload(encodedPayload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return false;
  }

  let payload: DiagnosticTokenPayload | null = null;
  try {
    payload = parsePayload(JSON.parse(decodeBase64Url(encodedPayload)));
  } catch {
    return false;
  }

  const nowMs = params.now?.getTime() ?? Date.now();
  return (
    payload !== null &&
    payload.sid === params.sessionId &&
    payload.cid === params.chatId &&
    payload.exp > nowMs
  );
}
