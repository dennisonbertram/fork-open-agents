import { describe, expect, test } from "bun:test";
import { buildSandboxFreeChatInput } from "./inbox-sidebar-new-chat";

describe("buildSandboxFreeChatInput", () => {
  test("BT-001: returns input with no repo fields set", () => {
    const input = buildSandboxFreeChatInput();
    // Accessing via index signature to avoid TS errors on known-absent keys
    const asRecord = input as Record<string, unknown>;
    expect(asRecord["repoOwner"]).toBeUndefined();
    expect(asRecord["repoName"]).toBeUndefined();
    expect(asRecord["cloneUrl"]).toBeUndefined();
    expect(asRecord["branch"]).toBeUndefined();
  });

  test("BT-002: autoCommitPush and autoCreatePr are false so no git automation is triggered", () => {
    const input = buildSandboxFreeChatInput();
    expect(input.autoCommitPush).toBe(false);
    expect(input.autoCreatePr).toBe(false);
  });

  test("BT-003: isNewBranch is false — no branch creation should happen", () => {
    const input = buildSandboxFreeChatInput();
    expect(input.isNewBranch).toBe(false);
  });

  test("BT-004: sandboxType is vercel (satisfies the CreateSessionInput union)", () => {
    const input = buildSandboxFreeChatInput();
    expect(input.sandboxType).toBe("vercel");
  });

  test("BT-005: returned object has no extraneous repo keys at runtime", () => {
    const input = buildSandboxFreeChatInput();
    const keys = Object.keys(input);
    expect(keys).not.toContain("repoOwner");
    expect(keys).not.toContain("repoName");
    expect(keys).not.toContain("cloneUrl");
    expect(keys).not.toContain("branch");
  });
});

// Regression tests — these catch future breakage of the sandbox-free chat contract

describe("buildSandboxFreeChatInput regression", () => {
  test("REG-001: output is a plain object, not null/undefined (so callers can spread it safely)", () => {
    const input = buildSandboxFreeChatInput();
    expect(input).toBeTruthy();
    expect(typeof input).toBe("object");
  });

  test("REG-002: returning repo fields would accidentally provision a VM — must never happen", () => {
    // If someone adds repoOwner to the return, the session will request a sandbox.
    // This test fails if that regression is introduced.
    const input = buildSandboxFreeChatInput();
    const asRecord = input as Record<string, unknown>;
    expect(asRecord["repoOwner"]).toBeUndefined();
    expect(asRecord["cloneUrl"]).toBeUndefined();
  });

  test("REG-003: autoCommitPush must remain false — enabling it without a repo would cause an error", () => {
    const input = buildSandboxFreeChatInput();
    expect(input.autoCommitPush).toBe(false);
  });

  test("REG-004: autoCreatePr must remain false — PR creation without a repo would cause an API error", () => {
    const input = buildSandboxFreeChatInput();
    expect(input.autoCreatePr).toBe(false);
  });

  test("REG-005: isNewBranch must remain false — branch creation without a repo would fail the session", () => {
    const input = buildSandboxFreeChatInput();
    expect(input.isNewBranch).toBe(false);
  });

  test("REG-006: calling the function multiple times always returns independent objects", () => {
    const first = buildSandboxFreeChatInput();
    const second = buildSandboxFreeChatInput();
    // Mutating one should not affect the other
    (first as Record<string, unknown>)["injected"] = true;
    expect((second as Record<string, unknown>)["injected"]).toBeUndefined();
  });
});
