import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const sidebarSource = readFileSync(
  join(import.meta.dir, "inbox-sidebar.tsx"),
  "utf8",
);

describe("InboxSidebar navigation reduction (#961)", () => {
  test("renders the shared workspace navigation contract", () => {
    expect(sidebarSource).toContain("WorkspaceNavigation");
    expect(sidebarSource).not.toContain('href="/runs"');
  });

  test("does not discover agents or loops during normal sidebar rendering", () => {
    expect(sidebarSource).not.toContain("useAllAgents");
    expect(sidebarSource).not.toContain("useAllLoops");
    expect(sidebarSource).not.toContain("RepoSubGroups");
    expect(sidebarSource).not.toContain("getRepoSubGroupRailActions");
  });

  test("keeps repository groups tied to session context instead of automation anchors", () => {
    expect(sidebarSource).toContain("buildRepoGroups(displayedSessions)");
    expect(sidebarSource).not.toContain("anchorRepos");
  });
});
