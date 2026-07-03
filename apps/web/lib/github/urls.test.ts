import { describe, expect, test } from "bun:test";
import { buildGitHubReconnectUrl } from "./urls";

// Issue #781: `step=github` alone must not imply reconnect intent (it also
// means "auto-open the GitHub step" for status-carrying redirects). Reconnect
// surfaces must set an explicit `reconnect=1` param instead.

describe("buildGitHubReconnectUrl", () => {
  test("e) includes reconnect=1 alongside step=github and next", () => {
    const url = buildGitHubReconnectUrl("/sessions");
    const parsed = new URL(url, "http://localhost");

    expect(parsed.pathname).toBe("/get-started");
    expect(parsed.searchParams.get("reconnect")).toBe("1");
    expect(parsed.searchParams.get("step")).toBe("github");
    expect(parsed.searchParams.get("next")).toBe("/sessions");
  });
});
