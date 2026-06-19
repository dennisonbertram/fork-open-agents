import { describe, expect, test } from "bun:test";
import { isGitHubToolHost, webFetchTool } from "./fetch";

type ExecuteFn = (
  input: { url: string; method?: string },
  options: { experimental_context?: unknown; abortSignal?: AbortSignal },
) => Promise<{ success: boolean; error?: string }>;

const execute = (webFetchTool as unknown as { execute: ExecuteFn }).execute;

describe("isGitHubToolHost", () => {
  test("matches GitHub web and API hosts (case-insensitive)", () => {
    for (const host of [
      "github.com",
      "www.github.com",
      "api.github.com",
      "API.GitHub.com",
    ]) {
      expect(isGitHubToolHost(host)).toBe(true);
    }
  });

  test("does not match raw content, lookalikes, or suffix attacks", () => {
    for (const host of [
      "raw.githubusercontent.com",
      "githubusercontent.com",
      "example.com",
      "notgithub.com",
      "github.com.evil.com",
    ]) {
      expect(isGitHubToolHost(host)).toBe(false);
    }
  });
});

describe("web_fetch GitHub guardrail", () => {
  test("blocks GitHub hosts when GitHub tools are available", async () => {
    const result = await execute(
      { url: "https://api.github.com/repos/owner/repo/issues" },
      { experimental_context: { githubToolAvailable: true } },
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("GitHub tools");
  });

  test("does not block when GitHub tools are unavailable", async () => {
    // Falls through to sandbox resolution, which throws because no sandbox is
    // present in the test context — proving the guardrail did not short-circuit.
    await expect(
      execute(
        { url: "https://api.github.com/repos/owner/repo/issues" },
        { experimental_context: { githubToolAvailable: false } },
      ),
    ).rejects.toThrow(/Sandbox not initialized/);
  });

  test("does not block non-GitHub hosts even when GitHub tools are available", async () => {
    await expect(
      execute(
        { url: "https://example.com/data" },
        { experimental_context: { githubToolAvailable: true } },
      ),
    ).rejects.toThrow(/Sandbox not initialized/);
  });
});
