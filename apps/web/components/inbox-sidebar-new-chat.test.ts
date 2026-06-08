import { describe, expect, test } from "bun:test";
import { buildSandboxFreeChatInput } from "./inbox-sidebar-new-chat";

describe("buildSandboxFreeChatInput", () => {
  test("BT-001: returns input with no repo fields set", () => {
    const input = buildSandboxFreeChatInput();
    expect(input.repoOwner).toBeUndefined();
    expect(input.repoName).toBeUndefined();
    expect(input.cloneUrl).toBeUndefined();
    expect(input.branch).toBeUndefined();
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

  test("BT-005: returned object has no extraneous repo keys", () => {
    const input = buildSandboxFreeChatInput();
    const keys = Object.keys(input);
    expect(keys).not.toContain("repoOwner");
    expect(keys).not.toContain("repoName");
    expect(keys).not.toContain("cloneUrl");
    expect(keys).not.toContain("branch");
  });
});
