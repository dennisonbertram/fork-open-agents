import { describe, expect, test } from "bun:test";
import type { ToolSet } from "ai";
import { hasGithubTool, mergeExtraTools } from "./merge-extra-tools";

// Minimal stub tool that satisfies ToolSet value shape
function stubTool(name: string) {
  return {
    description: `stub tool ${name}`,
    inputSchema: {},
    execute: async () => ({ ok: true }),
  };
}

describe("mergeExtraTools — no-clobber merge for Composio + GitHub tools", () => {
  test("both undefined → returns undefined", () => {
    expect(mergeExtraTools(undefined, undefined)).toBeUndefined();
  });

  test("only composio tools present → returns composio tools only", () => {
    const composio: ToolSet = { composio_x: stubTool("composio_x") as never };
    const result = mergeExtraTools(composio, undefined);
    expect(result).toBeDefined();
    expect(Object.keys(result!)).toEqual(["composio_x"]);
  });

  test("only github tools present → returns github tools only", () => {
    const github: ToolSet = {
      github_list_issues: stubTool("github_list_issues") as never,
    };
    const result = mergeExtraTools(undefined, github);
    expect(result).toBeDefined();
    expect(Object.keys(result!)).toEqual(["github_list_issues"]);
  });

  test("both present → merged result contains BOTH composio_x and github_list_issues (no clobber)", () => {
    const composio: ToolSet = { composio_x: stubTool("composio_x") as never };
    const github: ToolSet = {
      github_list_issues: stubTool("github_list_issues") as never,
    };

    const result = mergeExtraTools(composio, github);

    expect(result).toBeDefined();
    expect(Object.keys(result!)).toContain("composio_x");
    expect(Object.keys(result!)).toContain("github_list_issues");
    expect(Object.keys(result!)).toHaveLength(2);
  });

  test("key collision: github wins over composio (later merge wins)", () => {
    const shared = stubTool("shared");
    const overriding = stubTool("overriding");
    const composio: ToolSet = { shared_tool: shared as never };
    const github: ToolSet = { shared_tool: overriding as never };

    const result = mergeExtraTools(composio, github);

    expect(result!["shared_tool"] as unknown).toBe(overriding as unknown);
  });
});

describe("hasGithubTool — detects GitHub tools across naming variants", () => {
  test("undefined toolset → false", () => {
    expect(hasGithubTool(undefined)).toBe(false);
  });

  test("native github_* tools → true", () => {
    const tools: ToolSet = {
      github_list_issues: stubTool("github_list_issues") as never,
    };
    expect(hasGithubTool(tools)).toBe(true);
  });

  test("Composio GITHUB_* and COMPOSIO_GITHUB_* tools → true", () => {
    expect(
      hasGithubTool({
        GITHUB_GET_AN_ISSUE: stubTool("GITHUB_GET_AN_ISSUE") as never,
      }),
    ).toBe(true);
    expect(
      hasGithubTool({
        COMPOSIO_GITHUB_CREATE_ISSUE: stubTool(
          "COMPOSIO_GITHUB_CREATE_ISSUE",
        ) as never,
      }),
    ).toBe(true);
  });

  test("non-GitHub tools and lookalikes → false", () => {
    expect(
      hasGithubTool({
        web_fetch: stubTool("web_fetch") as never,
        mygithubthing: stubTool("mygithubthing") as never,
      }),
    ).toBe(false);
  });
});
