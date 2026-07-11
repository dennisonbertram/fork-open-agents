import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const agentsSection = readFileSync(
  join(import.meta.dir, "agents/agents-section.tsx"),
  "utf8",
);
const composioSection = readFileSync(
  join(import.meta.dir, "composio-section.tsx"),
  "utf8",
);
const settingsLayout = readFileSync(join(import.meta.dir, "layout.tsx"), "utf8");

describe("narrow Chat roles copy boundary (#964)", () => {
  test("role cards use the requested visible subtitles and role mutation copy", () => {
    expect(agentsSection).toContain('main: "Session coordinator"');
    expect(agentsSection).toContain('explorer: "Helper role"');
    expect(agentsSection).toContain('executor: "Helper role"');
    expect(agentsSection).toContain('design: "Helper role"');
    expect(agentsSection).toContain("Failed to save role settings.");
    expect(agentsSection).toContain("role updated.");
    expect(agentsSection).toContain("role reset to defaults.");
    expect(agentsSection).toContain('presentationNoun: "role"');
  });

  test("Composio uses Chat role defaults without renaming technical exports", () => {
    expect(composioSection).toContain('title="Chat role defaults"');
    expect(composioSection).toContain("Main role");
    expect(composioSection).toContain("helper roles");
    expect(composioSection).not.toContain('title="Agent defaults"');
  });

  test("mobile Settings navigation scrolls and returns focus to its trigger", () => {
    expect(settingsLayout).toContain("min-h-0 flex-1 overflow-y-auto");
    expect(settingsLayout).toContain("mobileTriggerRef.current?.focus()");
    expect(settingsLayout).toContain('aria-label="Open workspace navigation"');
  });

  test("role editor preserves the legacy endpoint and pending controls", () => {
    expect(agentsSection).toContain('fetch("/api/settings/agents"');
    expect(agentsSection).toContain('method: "PATCH"');
    expect(agentsSection).toContain('method: "DELETE"');
    expect(agentsSection).toContain("body: JSON.stringify({ role: row.key })");
    expect(agentsSection).toContain('{saving ? "Saving…" : "Save"}');
    expect(agentsSection).toContain("disabled={isBusy}");
  });
});
