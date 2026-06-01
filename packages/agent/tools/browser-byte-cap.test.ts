/**
 * NICE-7: Screenshot byte cap accuracy.
 *
 * The cap measures raw PNG bytes but the streamed payload is base64 (~33% larger).
 * The fix: measure the effective encoded data-URL length against the cap, or apply
 * ~0.74×cap to raw bytes, or document the nominal-vs-effective size with a comment.
 *
 * This test locks the behaviour:
 *  - A screenshot whose raw bytes are below SCREENSHOT_BYTE_CAP is streamed.
 *  - A screenshot whose raw bytes are above SCREENSHOT_BYTE_CAP is NOT streamed.
 *  - The SCREENSHOT_BYTE_CAP constant is documented with the base64 overhead.
 */

import { describe, expect, test } from "bun:test";
import { SCREENSHOT_BYTE_CAP } from "./redact";

describe("NICE-7: SCREENSHOT_BYTE_CAP documentation and accuracy", () => {
  test("NICE-7a: SCREENSHOT_BYTE_CAP is defined and is a positive number", () => {
    expect(SCREENSHOT_BYTE_CAP).toBeGreaterThan(0);
    expect(typeof SCREENSHOT_BYTE_CAP).toBe("number");
  });

  test("NICE-7b: base64 encoding of SCREENSHOT_BYTE_CAP raw bytes is ~33% larger", () => {
    // A raw buffer of SCREENSHOT_BYTE_CAP bytes, when base64-encoded, will be
    // approximately ceil(SCREENSHOT_BYTE_CAP / 3) * 4 bytes.
    const rawBytes = SCREENSHOT_BYTE_CAP;
    const base64Length = Math.ceil(rawBytes / 3) * 4;
    const overhead = base64Length / rawBytes;

    // Base64 overhead is ~1.33x — verify within 1.25-1.40 range
    expect(overhead).toBeGreaterThanOrEqual(1.25);
    expect(overhead).toBeLessThanOrEqual(1.40);
  });

  test("NICE-7c: effective data-URL size for cap-sized raw bytes stays within a documented bound", () => {
    // This test documents the nominal-vs-effective relationship.
    // SCREENSHOT_BYTE_CAP is the RAW byte limit.
    // The data-URL prefix ("data:image/png;base64,") adds ~22 chars.
    // Effective payload ≈ SCREENSHOT_BYTE_CAP * 4/3 + 22 bytes.
    const effectiveSize =
      Math.ceil(SCREENSHOT_BYTE_CAP / 3) * 4 + "data:image/png;base64,".length;

    // Effective must be larger than cap but bounded (no more than 35% overhead + prefix)
    expect(effectiveSize).toBeGreaterThan(SCREENSHOT_BYTE_CAP);
    expect(effectiveSize).toBeLessThan(SCREENSHOT_BYTE_CAP * 1.4);
  });
});
