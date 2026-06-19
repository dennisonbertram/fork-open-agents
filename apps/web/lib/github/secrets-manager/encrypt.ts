import "server-only";

import sodium, {
  base64_variants,
  from_base64,
  ready,
  to_base64,
} from "libsodium-wrappers";

export async function sealSecretValue(input: {
  publicKeyBase64: string;
  plaintext: string;
}): Promise<string> {
  await ready;

  const publicKey = from_base64(
    input.publicKeyBase64,
    base64_variants.ORIGINAL,
  );
  const sealed = sodium.crypto_box_seal(input.plaintext, publicKey);

  return to_base64(sealed, base64_variants.ORIGINAL);
}
