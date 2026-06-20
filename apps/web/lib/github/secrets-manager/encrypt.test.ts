import { describe, expect, mock, test } from "bun:test";
import sodium, {
  base64_variants,
  from_base64,
  ready,
  to_base64,
  to_string,
} from "libsodium-wrappers";

mock.module("server-only", () => ({}));

const encryptModulePromise = import("./encrypt");

describe("sealSecretValue", () => {
  test("encrypts with libsodium sealed-box using ORIGINAL base64", async () => {
    const { sealSecretValue } = await encryptModulePromise;
    await ready;
    const keypair = sodium.crypto_box_keypair();
    const publicKeyBase64 = to_base64(
      keypair.publicKey,
      base64_variants.ORIGINAL,
    );
    const plaintext = "super-secret-value";

    const ciphertext = await sealSecretValue({ publicKeyBase64, plaintext });

    expect(ciphertext).not.toContain("-");
    expect(ciphertext).not.toContain("_");
    expect(ciphertext.length).toBeGreaterThan(plaintext.length);

    const opened = sodium.crypto_box_seal_open(
      from_base64(ciphertext, base64_variants.ORIGINAL),
      keypair.publicKey,
      keypair.privateKey,
    );
    expect(to_string(opened)).toBe(plaintext);
  });
});
