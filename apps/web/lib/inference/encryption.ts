import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";

const ENCRYPTION_VERSION = "v1";
const IV_BYTES = 12;

function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY ?? process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "ENCRYPTION_KEY or BETTER_AUTH_SECRET is required for inference profiles",
    );
  }

  return createHash("sha256")
    .update("open-agents:inference-profiles:")
    .update(secret)
    .digest();
}

function toBase64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export function encryptInferenceSecret(secret: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    ENCRYPTION_VERSION,
    toBase64Url(iv),
    toBase64Url(authTag),
    toBase64Url(ciphertext),
  ].join(":");
}

export function decryptInferenceSecret(payload: string): string {
  const [version, encodedIv, encodedAuthTag, encodedCiphertext] =
    payload.split(":");

  if (
    version !== ENCRYPTION_VERSION ||
    !encodedIv ||
    !encodedAuthTag ||
    !encodedCiphertext
  ) {
    throw new Error("Unsupported encrypted inference secret payload");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    fromBase64Url(encodedIv),
  );
  decipher.setAuthTag(fromBase64Url(encodedAuthTag));

  return Buffer.concat([
    decipher.update(fromBase64Url(encodedCiphertext)),
    decipher.final(),
  ]).toString("utf8");
}

export function fingerprintInferenceSecret(secret: string): string {
  return createHmac("sha256", getEncryptionKey())
    .update(secret)
    .digest("hex")
    .slice(0, 16);
}

export function lastFourSecretChars(secret: string): string {
  return secret.slice(-4);
}
