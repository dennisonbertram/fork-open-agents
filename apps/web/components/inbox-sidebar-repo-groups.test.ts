import { describe, expect, test } from "bun:test";
import { buildRepoGroups, getRepoGroupId } from "./inbox-sidebar-repo-groups";

type S = { id: string; repoOwner?: string | null; repoName?: string | null };

const session = (id: string, repoOwner?: string, repoName?: string): S => ({
  id,
  repoOwner,
  repoName,
});

describe("buildRepoGroups", () => {
  test("groups sessions by repo with canonical owner/name on the group", () => {
    const groups = buildRepoGroups([
      session("s1", "acme", "web"),
      session("s2", "acme", "web"),
      session("s3", "acme", "api"),
    ]);

    const web = groups.find(
      (g) => g.id === getRepoGroupId({ repoOwner: "acme", repoName: "web" }),
    );
    expect(web?.label).toBe("acme/web");
    expect(web?.repoOwner).toBe("acme");
    expect(web?.repoName).toBe("web");
    expect(web?.sessions.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(groups).toHaveLength(2);
  });

  test("pins the unscoped Chats group first", () => {
    const groups = buildRepoGroups([
      session("s1", "acme", "web"),
      session("chat"), // no repo
    ]);
    expect(groups[0].id).toBe("repo:unscoped");
    expect(groups[0].label).toBe("Chats");
  });

  test("keeps a repo visible from anchors (agents/loops) when it has no sessions", () => {
    const groups = buildRepoGroups(
      [session("s1", "acme", "web")],
      [{ repoOwner: "acme", repoName: "tooling" }], // loops/agents only
    );

    const tooling = groups.find((g) => g.label === "acme/tooling");
    expect(tooling).toBeDefined();
    expect(tooling?.sessions).toEqual([]);
    expect(tooling?.repoOwner).toBe("acme");
    expect(tooling?.repoName).toBe("tooling");
  });

  test("does NOT duplicate a repo that already has sessions", () => {
    const groups = buildRepoGroups(
      [session("s1", "acme", "web")],
      [{ repoOwner: "Acme", repoName: "Web" }], // same repo, different case
    );
    // One group for acme/web (case-insensitive id match), still has its session
    const webGroups = groups.filter(
      (g) => g.id === getRepoGroupId({ repoOwner: "acme", repoName: "web" }),
    );
    expect(webGroups).toHaveLength(1);
    expect(webGroups[0].sessions.map((s) => s.id)).toEqual(["s1"]);
  });

  test("dedupes anchor repos among themselves and sorts them after session groups", () => {
    const groups = buildRepoGroups(
      [session("s1", "acme", "web")],
      [
        { repoOwner: "acme", repoName: "zeta" },
        { repoOwner: "acme", repoName: "alpha" },
        { repoOwner: "acme", repoName: "alpha" }, // dup
      ],
    );
    // session group first, then anchor-only repos alphabetically
    expect(groups.map((g) => g.label)).toEqual([
      "acme/web",
      "acme/alpha",
      "acme/zeta",
    ]);
  });

  test("ignores anchor refs without a repo name", () => {
    const groups = buildRepoGroups([], [{ repoOwner: "acme", repoName: "" }]);
    expect(groups).toEqual([]);
  });
});
