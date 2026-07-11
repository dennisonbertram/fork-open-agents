import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RunDetailShell } from "./run-detail-shell";

describe("RunDetailShell", () => {
  test("renders normalized status, proof, timestamps, repository, Automation, and trigger framing", () => {
    const html = renderToStaticMarkup(
      <RunDetailShell
        summary={{
          source: "background_agent",
          runId: "run-1",
          automation: {
            name: "Review pull requests",
            href: "/repos/acme/shop/agents/agent-1",
          },
          repository: {
            owner: "acme",
            name: "shop",
            href: "/repos/acme/shop",
          },
          trigger: { source: "github", kind: "github.pull_request" },
          nativeStatus: "failed",
          state: "finished",
          outcome: "failed",
          health: "needs_attention",
          attentionReasons: ["failed"],
          timestamps: {
            createdAt: "2026-07-11T10:00:00.000Z",
            startedAt: "2026-07-11T10:01:00.000Z",
            finishedAt: "2026-07-11T10:02:00.000Z",
          },
          evidence: {
            source: "Background agent events and outputs",
            requestId: "request-1",
            workflowRunId: "workflow-1",
            sandboxName: "sandbox-1",
          },
        }}
      >
        <section aria-label="Source-native evidence">Native body</section>
      </RunDetailShell>,
    );

    expect(html).toContain("Single-step Automation run");
    expect(html).toContain("Review pull requests");
    expect(html).toContain("acme/shop");
    expect(html).toContain("github.pull_request");
    expect(html).toContain("Native status");
    expect(html).toContain("needs attention");
    expect(html).toContain("Background agent events and outputs");
    expect(html).toContain("workflow-1");
    expect(html).toContain("request-1");
    expect(html).toContain("sandbox-1");
    expect(html).toContain("Created");
    expect(html).toContain("Started");
    expect(html).toContain("Finished");
    expect(html).toContain("Native body");
    expect(html).toContain('aria-label="Run evidence summary"');
  });
});
