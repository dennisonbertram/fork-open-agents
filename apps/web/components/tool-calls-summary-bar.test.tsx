import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ToolCallsSummaryBar } from "./tool-calls-summary-bar";

describe("ToolCallsSummaryBar", () => {
  test("renders the collapsed toggle row with marker slots and live shimmer", () => {
    const html = renderToStaticMarkup(
      <ToolCallsSummaryBar
        isExpanded={false}
        onToggle={() => {}}
        isStreaming={true}
        toolCallCount={2}
        changedFiles={["apps/web/app/page.tsx"]}
        activityLabel="Editing files"
        durationMs={null}
        startedAt={new Date().toISOString()}
        statusWordSeed="chat-1"
        responseStats={{
          tokensPerSecond: 12.5,
          costUsd: 0.02,
          costSource: "estimate",
        }}
      />,
    );

    expect(html).toContain('data-slot="marker"');
    expect(html).toContain('data-slot="marker-icon"');
    expect(html).toContain('data-slot="marker-content"');
    expect(html).toContain("status-text-shimmer");
    expect(html).toContain("tool calls");
    expect(html).toContain("Editing files");
    expect(html).toContain("aria-label=");
  });

  test("does not shimmer completed summary text", () => {
    const html = renderToStaticMarkup(
      <ToolCallsSummaryBar
        isExpanded={true}
        onToggle={() => {}}
        isStreaming={false}
        toolCallCount={1}
        changedFiles={[]}
        activityLabel={null}
        durationMs={2000}
        startedAt={null}
        statusWordSeed="chat-1"
      />,
    );

    expect(html).toContain('data-slot="marker"');
    expect(html).not.toContain("status-text-shimmer");
    expect(html).toContain("tool call");
  });
});
