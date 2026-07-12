import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const flow = readFileSync(
  join(import.meta.dir, "get-started-flow.tsx"),
  "utf8",
);
const sessions = readFileSync(
  join(import.meta.dir, "../sessions/sessions-index-shell.tsx"),
  "utf8",
);
const runs = readFileSync(
  join(import.meta.dir, "../runs/runs-list.tsx"),
  "utf8",
);

describe("first-run continuation contracts (#967)", () => {
  test("Vercel is a non-numbered prerequisite and GitHub is the current product step", () => {
    expect(flow).toContain("Authentication prerequisite");
    expect(flow).toContain("Connect GitHub");
    expect(flow).not.toContain('title: "Vercel Account"');
    expect(flow).toContain("Start a Session");
  });

  test("Sessions uses the shared safe GitHub return URL", () => {
    expect(sessions).toContain('buildGitHubConnectUrl("/sessions")');
  });

  test("unfiltered Runs empty state is truthful and filtered empty still clears filters", () => {
    expect(runs).toContain("No runs yet");
    expect(runs).toContain('"/automations"');
    expect(runs).toContain("Clear filters");
  });
});
