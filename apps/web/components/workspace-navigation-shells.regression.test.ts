import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const workspaceRoot = join(import.meta.dir, "..");
const settingsLayoutSource = readFileSync(
  join(workspaceRoot, "app/settings/layout.tsx"),
  "utf8",
);
const settingsItemsSource = readFileSync(
  join(workspaceRoot, "app/settings/nav-items.ts"),
  "utf8",
);
const sessionsShellSource = readFileSync(
  join(workspaceRoot, "app/sessions/sessions-route-shell.tsx"),
  "utf8",
);

describe("workspace navigation shell integration (#961)", () => {
  test("Settings reuses the shared contract on desktop and mobile", () => {
    expect(settingsLayoutSource).toContain('mode="expanded"');
    expect(settingsLayoutSource).toContain('mode="mobile"');
    expect(settingsLayoutSource).toContain("WorkspaceNavigation");
    expect(settingsLayoutSource).not.toContain("ArrowLeft");
  });

  test("Settings subnavigation does not duplicate the top-level Automations destination", () => {
    expect(settingsItemsSource).not.toContain('href: "/automations"');
    expect(settingsItemsSource).not.toContain('id: "automations"');
  });

  test("the shared Sessions shell exposes a mobile navigation trigger outside session pages", () => {
    expect(sessionsShellSource).toContain("WorkspaceMobileNavigationTrigger");
    expect(sessionsShellSource).toContain("SidebarTrigger");
  });
});
