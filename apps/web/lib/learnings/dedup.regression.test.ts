/**
 * Regression tests for the learnings dedup, extraction, and runner subsystem.
 * These tests would fail if the implementation in commit b058a9b2 were reverted.
 */
import { describe, expect, test } from "bun:test";
import { computeDedupSignature, decideDedup, scoreOverlap } from "./dedup";
import { verifyRedaction, toEventPayload } from "./extraction";
import { redactHarnessPayload } from "@/lib/harness/redaction";

// REGRESSION-001: dedupSignature must never be empty/null
// If computeDedupSignature returned null/undefined/empty, the NOT NULL DB
// constraint would fail on insert and silently break all extraction runs.
describe("REGRESSION-001: dedupSignature is always a non-empty string", () => {
  test("never returns empty for a minimal candidate (only title)", () => {
    const sig = computeDedupSignature({
      title: "Some learning",
    });
    expect(sig.length).toBeGreaterThan(0);
    expect(sig).not.toBe("");
    expect(sig).not.toBe(null);
    expect(sig).not.toBe(undefined);
  });

  test("never returns empty even for whitespace-only title after normalize", () => {
    // Normalizing "   " → "" + all others empty → hash of "||||" is still non-empty
    const sig = computeDedupSignature({ title: "   " });
    expect(sig.length).toBeGreaterThan(0);
  });
});

// REGRESSION-002: high-overlap dedup decision stays "update" (not "create")
// If decideDedup logic were inverted, previously-seen learnings would be
// duplicated instead of merged, polluting the KB.
describe("REGRESSION-002: high overlap score produces update decision", () => {
  test("score 5 → update (not create or consolidation_review)", () => {
    expect(decideDedup(5)).toBe("update");
  });

  test("score 4 → update (not create or consolidation_review)", () => {
    expect(decideDedup(4)).toBe("update");
  });

  test("score 3 → consolidation_review (not update, not create)", () => {
    expect(decideDedup(3)).toBe("consolidation_review");
  });

  test("score 1 → create (not update or consolidation_review)", () => {
    expect(decideDedup(1)).toBe("create");
  });
});

// REGRESSION-003: PEM blocks in excerpts are always caught by verifyRedaction
// If the PEM detector were removed, a malicious reviewer could plant a private
// key in a PR description and have it persisted to the learnings store.
describe("REGRESSION-003: PEM block always triggers redaction", () => {
  test("RSA private key block is caught", () => {
    const r = verifyRedaction(
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA0Z3VS5JJcds\n-----END RSA PRIVATE KEY-----",
    );
    expect(r.status).not.toBe("passed");
    expect(r.detector).toBe("pem");
  });

  test("generic PRIVATE KEY block is caught", () => {
    const r = verifyRedaction(
      "-----BEGIN PRIVATE KEY-----\nMIIEpAIBAAK\n-----END PRIVATE KEY-----",
    );
    expect(r.status).not.toBe("passed");
  });
});

// REGRESSION-004: safe keys survive redactHarnessPayload
// If the event payload were changed to use "content" or "body", the learning
// excerpt would be wholly redacted as "[REDACTED_ARTIFACT_CONTENT]" and the
// run timeline would show no useful information.
describe("REGRESSION-004: toEventPayload uses safe keys that survive redaction", () => {
  test("candidate_text is not in ARTIFACT_CONTENT_KEYS and is not redacted", () => {
    const payload = toEventPayload({ title: "Use TypeScript strict mode" });
    const redacted = redactHarnessPayload(payload) as Record<string, unknown>;
    // candidate_text should NOT be wholesale-redacted
    expect(redacted["candidate_text"]).not.toBe("[REDACTED_ARTIFACT_CONTENT]");
  });

  test("learning_excerpt is not in ARTIFACT_CONTENT_KEYS and is not redacted", () => {
    const payload = toEventPayload({
      title: "Use TypeScript strict mode",
      description: "Enable strict type checking",
    });
    const redacted = redactHarnessPayload(payload) as Record<string, unknown>;
    expect(redacted["learning_excerpt"]).not.toBe(
      "[REDACTED_ARTIFACT_CONTENT]",
    );
  });
});

// REGRESSION-005: 5-dimension overlap scoring is symmetric
// If scoreOverlap(a, b) !== scoreOverlap(b, a), dedup decisions would depend
// on the order of iteration, causing non-deterministic merging.
describe("REGRESSION-005: overlap scoring is symmetric", () => {
  const a = {
    title: "avoid global state",
    rootCause: "shared mutable state",
    solution: "use local state",
    affectedPaths: ["src/App.tsx"],
    prevention: "prefer hooks",
  };
  const b = {
    title: "use typescript strict mode",
    rootCause: "implicit any causes runtime errors",
    solution: "enable strict in tsconfig",
    affectedPaths: ["tsconfig.json"],
    prevention: "scaffold with strict enabled",
  };

  test("scoreOverlap(a, b) === scoreOverlap(b, a)", () => {
    expect(scoreOverlap(a, b)).toBe(scoreOverlap(b, a));
  });

  test("scoreOverlap(a, a) === 5 (full self-overlap)", () => {
    expect(scoreOverlap(a, a)).toBe(5);
  });
});

// REGRESSION-006: known token prefix ghp_ is always caught
// This is the injection surface for reviewer-planted secrets (must-fix #8).
describe("REGRESSION-006: known token prefix detection", () => {
  test("ghp_ token is caught by known_prefix detector", () => {
    const r = verifyRedaction(
      "User token: ghp_ABCdefGHIjklMNOpqrSTUvwxYZ123456",
    );
    expect(r.status).not.toBe("passed");
    expect(r.detector).toBe("known_prefix");
  });

  test("sk- token is caught by known_prefix detector", () => {
    const r = verifyRedaction("API key: sk-proj-abcdefghijklmnopqrstuvwxyz12");
    expect(r.status).not.toBe("passed");
    expect(r.detector).toBe("known_prefix");
  });
});
