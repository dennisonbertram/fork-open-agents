import { describe, expect, test } from "bun:test";
import {
  bashPolicy,
  classifyToolApproval,
  externalWritePolicy,
  gitPushPolicy,
} from "./approval-policy";

// BT-001: bashPolicy — safe commands return requires:false
describe("bashPolicy", () => {
  test("safe command returns requires:false", () => {
    const result = bashPolicy("ls -la");
    expect(result.requires).toBe(false);
    expect(result.category).toBeNull();
  });

  test("git status does not require approval", () => {
    const result = bashPolicy("git status --short");
    expect(result.requires).toBe(false);
  });

  // BT-002: bashPolicy — dangerous rm -rf returns requires:true with category
  test("rm -rf requires approval with dangerous-command category", () => {
    const result = bashPolicy("rm -rf tmp");
    expect(result.requires).toBe(true);
    expect(result.category).toBe("dangerous-command");
  });

  test("find -delete requires approval", () => {
    const result = bashPolicy("find . -delete");
    expect(result.requires).toBe(true);
    expect(result.category).toBe("dangerous-command");
  });

  test("dotenv access requires approval with sensitive-file category", () => {
    const result = bashPolicy("cat .env.local");
    expect(result.requires).toBe(true);
    expect(result.category).toBe("sensitive-file");
  });

  test("nested dotenv access requires approval", () => {
    const result = bashPolicy("grep API_KEY apps/web/.env.example");
    expect(result.requires).toBe(true);
    expect(result.category).toBe("sensitive-file");
  });
});

// BT-003: gitPushPolicy — git force-push commands require approval
describe("gitPushPolicy", () => {
  test("git push --force requires approval", () => {
    const result = gitPushPolicy("git push --force origin main");
    expect(result.requires).toBe(true);
    expect(result.category).toBe("git-force-push");
  });

  test("git push -f requires approval", () => {
    const result = gitPushPolicy("git push -f origin main");
    expect(result.requires).toBe(true);
    expect(result.category).toBe("git-force-push");
  });

  test("git push --force-with-lease requires approval", () => {
    const result = gitPushPolicy("git push --force-with-lease");
    expect(result.requires).toBe(true);
    expect(result.category).toBe("git-force-push");
  });

  test("git reset --hard requires approval", () => {
    const result = gitPushPolicy("git reset --hard HEAD~1");
    expect(result.requires).toBe(true);
    expect(result.category).toBe("git-force-push");
  });

  test("git clean -fd requires approval", () => {
    const result = gitPushPolicy("git clean -fd");
    expect(result.requires).toBe(true);
    expect(result.category).toBe("git-force-push");
  });

  test("ordinary git push does not require approval", () => {
    const result = gitPushPolicy("git push origin main");
    expect(result.requires).toBe(false);
  });

  test("git status does not require approval", () => {
    const result = gitPushPolicy("git status");
    expect(result.requires).toBe(false);
  });
});

// BT-004: externalWritePolicy — non-GET/HEAD HTTP methods require approval
describe("externalWritePolicy", () => {
  test("GET does not require approval", () => {
    const result = externalWritePolicy("GET");
    expect(result.requires).toBe(false);
  });

  test("HEAD does not require approval", () => {
    const result = externalWritePolicy("HEAD");
    expect(result.requires).toBe(false);
  });

  test("POST requires approval with external-write category", () => {
    const result = externalWritePolicy("POST");
    expect(result.requires).toBe(true);
    expect(result.category).toBe("external-write");
  });

  test("PUT requires approval", () => {
    const result = externalWritePolicy("PUT");
    expect(result.requires).toBe(true);
    expect(result.category).toBe("external-write");
  });

  test("PATCH requires approval", () => {
    const result = externalWritePolicy("PATCH");
    expect(result.requires).toBe(true);
    expect(result.category).toBe("external-write");
  });

  test("DELETE requires approval", () => {
    const result = externalWritePolicy("DELETE");
    expect(result.requires).toBe(true);
    expect(result.category).toBe("external-write");
  });
});

// BT-005: classifyToolApproval — policy composition with first-match-wins
describe("classifyToolApproval", () => {
  test("bash safe command → requires:false", () => {
    const result = classifyToolApproval("bash", { command: "ls -la" });
    expect(result.requires).toBe(false);
  });

  test("bash dangerous command → requires:true with category dangerous-command", () => {
    const result = classifyToolApproval("bash", { command: "rm -rf /tmp" });
    expect(result.requires).toBe(true);
    expect(result.category).toBe("dangerous-command");
  });

  test("bash git force-push → requires:true with category git-force-push", () => {
    const result = classifyToolApproval("bash", {
      command: "git push --force origin main",
    });
    expect(result.requires).toBe(true);
    expect(result.category).toBe("git-force-push");
  });

  // BT-006: webFetch GET → requires:false
  test("webFetch GET → requires:false", () => {
    const result = classifyToolApproval("webFetch", { method: "GET" });
    expect(result.requires).toBe(false);
  });

  // BT-007: webFetch POST → requires:true
  test("webFetch POST → requires:true with external-write category", () => {
    const result = classifyToolApproval("webFetch", { method: "POST" });
    expect(result.requires).toBe(true);
    expect(result.category).toBe("external-write");
  });

  test("webFetch with undefined method defaults to read-only (no approval)", () => {
    const result = classifyToolApproval("webFetch", {});
    expect(result.requires).toBe(false);
  });

  // BT-008: unknown outward-facing tool → conservative default requires:true
  test("unknown outward-facing tool → requires:true (conservative default)", () => {
    const result = classifyToolApproval("unknownExternalTool", {});
    expect(result.requires).toBe(true);
    expect(result.category).toBe("unknown-outward-facing");
  });

  // BT-009: read-only/internal tools default to requires:false
  test("read tool → requires:false (internal read-only)", () => {
    const result = classifyToolApproval("read", { filePath: "README.md" });
    expect(result.requires).toBe(false);
  });

  test("list tool → requires:false (internal read-only)", () => {
    const result = classifyToolApproval("list", {});
    expect(result.requires).toBe(false);
  });

  test("task tool → requires:false (internal orchestration)", () => {
    const result = classifyToolApproval("task", {});
    expect(result.requires).toBe(false);
  });

  test("glob tool → requires:false (internal read-only)", () => {
    const result = classifyToolApproval("glob", {});
    expect(result.requires).toBe(false);
  });

  test("grep tool → requires:false (internal read-only)", () => {
    const result = classifyToolApproval("grep", {});
    expect(result.requires).toBe(false);
  });
});
