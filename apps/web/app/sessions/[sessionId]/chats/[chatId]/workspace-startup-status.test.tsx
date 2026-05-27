import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceStartupStatus } from "./workspace-startup-status";

describe("WorkspaceStartupStatus", () => {
  test("renders bounded startup logs with the current setup message", () => {
    const html = renderToStaticMarkup(
      <WorkspaceStartupStatus
        status={{
          status: "setting-up",
          message: "Setting up the workspace...",
          title: "Preparing sandbox workspace",
          logLines: [
            "Sandbox name: session_123",
            "$ bun install",
            "Packages: +976",
          ],
        }}
      />,
    );

    expect(html).toContain("Setting up the workspace...");
    expect(html).toContain("Preparing sandbox workspace");
    expect(html).toContain("$ bun install");
    expect(html).toContain("Packages: +976");
  });

  test("falls back to the compact thinking message without logs", () => {
    const html = renderToStaticMarkup(<WorkspaceStartupStatus status={null} />);

    expect(html).toContain("Thinking…");
    expect(html).not.toContain("Startup logs");
  });
});
