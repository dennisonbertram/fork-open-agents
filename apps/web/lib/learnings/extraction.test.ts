import { describe, expect, test } from "bun:test";
import { redactHarnessPayload } from "@/lib/harness/redaction";
import { toEventPayload, verifyRedaction } from "./extraction";

describe("verifyRedaction", () => {
  // BT-011: planted PEM block → failed/blocked
  test("detects PEM private key block as failed/blocked", () => {
    const text =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA0Z3VS5JJcds3xHn/ygWep4\n-----END RSA PRIVATE KEY-----";
    const result = verifyRedaction(text);
    expect(["failed", "blocked"]).toContain(result.status);
    expect(result.detector).toBe("pem");
  });

  // BT-012: planted GitHub token → failed/blocked
  test("detects GitHub token prefix ghp_ as failed/blocked", () => {
    const text = "The token is ghp_abcdefghijklmnopqrstuvwxyz1234567890";
    const result = verifyRedaction(text);
    expect(["failed", "blocked"]).toContain(result.status);
    expect(result.detector).toBe("known_prefix");
  });

  // BT-013: high-entropy string → failed/blocked
  test("detects high-entropy string as failed/blocked", () => {
    // 40 random-looking hex chars that look like a secret
    const text = "secret=aB3xR7kP2mQ9nL5vY8wJ4hF6tC1dE0gN3zA7pK";
    const result = verifyRedaction(text);
    expect(["failed", "blocked"]).toContain(result.status);
  });

  // BT-014: clean text → passed
  test("returns passed for safe text with no secrets", () => {
    const text =
      "When refactoring React components, prefer small focused components over large monolithic ones.";
    const result = verifyRedaction(text);
    expect(result.status).toBe("passed");
  });

  test("detects sk- token prefix as failed/blocked", () => {
    const text =
      "Using API key sk-proj-abc123defghijklmnopqrstuvwxyz to call the service";
    const result = verifyRedaction(text);
    expect(["failed", "blocked"]).toContain(result.status);
    expect(result.detector).toBe("known_prefix");
  });
});

describe("toEventPayload", () => {
  // BT-015: toEventPayload uses safe keys that survive redactHarnessPayload
  test("uses candidate_text key (not content/body/stdout/stderr)", () => {
    const payload = toEventPayload({
      title: "Avoid global state",
      description: "Global state causes bugs",
      solution: "Use local state",
    });
    expect(payload).not.toHaveProperty("content");
    expect(payload).not.toHaveProperty("body");
    expect(payload).not.toHaveProperty("stdout");
    expect(payload).not.toHaveProperty("stderr");
    // Must have the safe key
    expect(
      Object.hasOwn(payload, "candidate_text") ||
        Object.hasOwn(payload, "learning_excerpt"),
    ).toBe(true);
  });

  test("payload using candidate_text/learning_excerpt survives redactHarnessPayload without wholesale redaction", () => {
    const safeText = "Prefer small React components for better testability";
    const payload = toEventPayload({
      title: "Component design",
      description: safeText,
    });
    const redacted = redactHarnessPayload(payload);

    // The value under the safe key should NOT be "[REDACTED_ARTIFACT_CONTENT]"
    const candidateText =
      (redacted as Record<string, unknown>)["candidate_text"] ??
      (redacted as Record<string, unknown>)["learning_excerpt"];
    expect(candidateText).not.toBe("[REDACTED_ARTIFACT_CONTENT]");
    expect(typeof candidateText).toBe("string");
  });

  test("payload with content key would be wholesale-redacted (confirms why safe keys are needed)", () => {
    // This test documents the problem: content is in ARTIFACT_CONTENT_KEYS
    const unsafePayload = { content: "some learning text" };
    const redacted = redactHarnessPayload(unsafePayload);
    expect((redacted as Record<string, unknown>)["content"]).toBe(
      "[REDACTED_ARTIFACT_CONTENT]",
    );
  });
});
