import { describe, expect, test } from "bun:test";
import { getGitHubPermissionsCopy } from "./agent-config-fields";

describe("AgentConfigFields presentation noun (#964)", () => {
  test("defaults to technical agent copy for existing callers", () => {
    expect(getGitHubPermissionsCopy()).toEqual({
      github:
        "Let this agent read and act on GitHub issues, branches, and PRs for repos you have access to.",
      authoring:
        "Let this agent propose new Composio tools. Proposals are recorded for review and do not auto-enable tools.",
    });
  });

  test("Settings can opt into interactive role copy", () => {
    expect(getGitHubPermissionsCopy("role")).toEqual({
      github:
        "Let this role read and act on GitHub issues, branches, and PRs for repos you have access to.",
      authoring:
        "Let this role propose new Composio tools. Proposals are recorded for review and do not auto-enable tools.",
    });
  });
});
