import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  McpRunLockNotice,
  resolveActiveRunSource,
  shouldLockComposer,
} from "./session-chat-mcp-run-lock";

describe("shouldLockComposer", () => {
  test("disables the composer for a live mcp-driven run", () => {
    expect(
      shouldLockComposer({ activeRunSource: "mcp", isStreaming: true }),
    ).toBe(true);
  });

  test("re-enables the composer after the human has taken over", () => {
    expect(
      shouldLockComposer({
        activeRunSource: "mcp",
        isStreaming: true,
        takenOver: true,
      }),
    ).toBe(false);
  });

  test("leaves a browser-started live run completely unaffected", () => {
    expect(
      shouldLockComposer({ activeRunSource: "browser", isStreaming: true }),
    ).toBe(false);
  });

  test("leaves the composer unaffected when no run is live", () => {
    expect(
      shouldLockComposer({ activeRunSource: "mcp", isStreaming: false }),
    ).toBe(false);
  });

  test("treats a missing/legacy run source exactly like today", () => {
    expect(
      shouldLockComposer({ activeRunSource: null, isStreaming: true }),
    ).toBe(false);
  });
});

describe("resolveActiveRunSource", () => {
  test("accepts the known mcp and browser values", () => {
    expect(resolveActiveRunSource("mcp")).toBe("mcp");
    expect(resolveActiveRunSource("browser")).toBe("browser");
  });

  test("returns null when the field is absent or unknown", () => {
    expect(resolveActiveRunSource(undefined)).toBe(null);
    expect(resolveActiveRunSource(null)).toBe(null);
    expect(resolveActiveRunSource("hydra")).toBe(null);
  });
});

describe("McpRunLockNotice", () => {
  test("states the mcp-driven state and offers a take-over action when locked", () => {
    const markup = renderToStaticMarkup(
      <McpRunLockNotice
        locked
        confirming={false}
        onTakeOver={mock(() => undefined)}
        onCancel={mock(() => undefined)}
        onRequestTakeOver={mock(() => undefined)}
      />,
    );

    expect(markup).toContain("MCP client");
    expect(markup).toContain("waiting on");
    expect(markup).toContain("Take over");
    // Conveyed to assistive technology, not by colour alone.
    expect(markup).toContain('role="alert"');
  });

  test("makes the consequence explicit before committing to take over", () => {
    const markup = renderToStaticMarkup(
      <McpRunLockNotice
        locked
        confirming
        onTakeOver={mock(() => undefined)}
        onCancel={mock(() => undefined)}
        onRequestTakeOver={mock(() => undefined)}
      />,
    );

    expect(markup).toContain("interrupt the run");
    expect(markup).toContain("waiting on");
    expect(markup).toContain("Take over");
    expect(markup).toContain("Cancel");
  });

  test("renders nothing when the composer is not locked", () => {
    const markup = renderToStaticMarkup(
      <McpRunLockNotice
        locked={false}
        confirming={false}
        onTakeOver={mock(() => undefined)}
        onCancel={mock(() => undefined)}
        onRequestTakeOver={mock(() => undefined)}
      />,
    );

    expect(markup).toBe("");
  });
});
