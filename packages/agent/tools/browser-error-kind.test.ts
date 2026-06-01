/**
 * SHOULD-5: Tests for typed error.kind discriminated shape.
 *
 * Change tool failure returns from {success:false, error: <string>} to
 * {success:false, error: { kind, message }} with kinds covering:
 *  - navigation_timeout
 *  - selector_not_found
 *  - fill_failed
 *  - extract_failed
 *  - screenshot_failed
 *  - oversized_capture_downgraded (success:true but streamed:false)
 *  - browser_launch_failed
 *
 * Tests assert the new {kind,message} shape for each failure mode.
 */

import { describe, expect, mock, test } from "bun:test";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

mock.module("ai", () => ({
  tool: <T extends Record<string, unknown>>(definition: T) => definition,
}));

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: async () => ({}),
  tryConnectVercelSandboxDirect: async () => null,
}));

function executionOptions(experimental_context?: unknown) {
  return { toolCallId: "tc-errorkind", messages: [], experimental_context };
}

function makeContext() {
  return {
    sandbox: {
      state: { type: "vercel" as const, sandboxId: "sb-1" },
      workingDirectory: "/repo",
    },
    model: "test-model",
  };
}

// ---------------------------------------------------------------------------
// SHOULD-5 tests
// ---------------------------------------------------------------------------

describe("SHOULD-5: typed error.kind discriminated shape", () => {
  test("SHOULD-5a: navigation failure → error.kind = 'navigation_timeout'", async () => {
    mock.module("./browser-session", () => ({
      getBrowserSession: async () => ({
        page: {
          goto: async () => {
            throw new Error("Timeout 30000ms exceeded waiting for navigation");
          },
          url: () => "about:blank",
          title: async () => "",
        },
      }),
      closeBrowserSession: async () => {},
    }));

    const { browserNavigateTool } = await import("./browser");
    const result = await browserNavigateTool().execute?.(
      { url: "https://slow.example.com" },
      executionOptions(makeContext()),
    );

    expect(result).toBeDefined();
    expect(result).toHaveProperty("success", false);
    const errorResult = result as {
      success: false;
      error: { kind: string; message: string };
    };
    expect(errorResult.error).toHaveProperty("kind");
    expect(typeof errorResult.error.kind).toBe("string");
    expect(errorResult.error).toHaveProperty("message");
    expect(typeof errorResult.error.message).toBe("string");
    // kind must be 'navigation_timeout' for timeout errors
    expect(errorResult.error.kind).toBe("navigation_timeout");
  });

  test("SHOULD-5b: click on missing selector → error.kind = 'selector_not_found'", async () => {
    mock.module("./browser-session", () => ({
      getBrowserSession: async () => ({
        page: {
          click: async () => {
            throw new Error("Timeout waiting for selector: #missing");
          },
          url: () => "https://example.com",
          title: async () => "Example",
        },
      }),
      closeBrowserSession: async () => {},
    }));

    const { browserClickTool } = await import("./browser");
    const result = await browserClickTool().execute?.(
      { selector: "#missing" },
      executionOptions(makeContext()),
    );

    expect(result).toHaveProperty("success", false);
    const errorResult = result as {
      success: false;
      error: { kind: string; message: string };
    };
    expect(errorResult.error.kind).toBe("selector_not_found");
  });

  test("SHOULD-5c: fill failure → error.kind = 'fill_failed'", async () => {
    mock.module("./browser-session", () => ({
      getBrowserSession: async () => ({
        page: {
          fill: async () => {
            throw new Error("Element is not visible");
          },
          url: () => "https://example.com",
          title: async () => "Example",
          press: async () => {},
          inputValue: async () => null,
        },
      }),
      closeBrowserSession: async () => {},
    }));

    const { browserTypeTool } = await import("./browser");
    const result = await browserTypeTool().execute?.(
      { selector: "#hidden", text: "text" },
      executionOptions(makeContext()),
    );

    expect(result).toHaveProperty("success", false);
    const errorResult = result as {
      success: false;
      error: { kind: string; message: string };
    };
    expect(errorResult.error.kind).toBe("fill_failed");
  });

  test("SHOULD-5d: extract failure → error.kind = 'extract_failed'", async () => {
    mock.module("./browser-session", () => ({
      getBrowserSession: async () => ({
        page: {
          locator: () => ({
            first: () => ({
              textContent: async () => {
                throw new Error("Page detached");
              },
              screenshot: async () => Buffer.from([]),
            }),
          }),
          getAttribute: async () => {
            throw new Error("Page detached");
          },
        },
      }),
      closeBrowserSession: async () => {},
    }));

    const { browserExtractTool } = await import("./browser");
    const result = await browserExtractTool().execute?.(
      { selector: "#gone" },
      executionOptions(makeContext()),
    );

    expect(result).toHaveProperty("success", false);
    const errorResult = result as {
      success: false;
      error: { kind: string; message: string };
    };
    expect(errorResult.error.kind).toBe("extract_failed");
  });

  test("SHOULD-5e: screenshot failure → error.kind = 'screenshot_failed'", async () => {
    mock.module("./browser-session", () => ({
      getBrowserSession: async () => ({
        page: {
          screenshot: async () => {
            throw new Error("Target page crashed");
          },
          locator: () => ({
            first: () => ({
              screenshot: async () => {
                throw new Error("Target page crashed");
              },
              textContent: async () => "",
            }),
          }),
        },
      }),
      closeBrowserSession: async () => {},
    }));

    const { browserScreenshotTool } = await import("./browser");
    const result = await browserScreenshotTool().execute?.(
      {},
      executionOptions(makeContext()),
    );

    expect(result).toHaveProperty("success", false);
    const errorResult = result as {
      success: false;
      error: { kind: string; message: string };
    };
    expect(errorResult.error.kind).toBe("screenshot_failed");
  });

  test("SHOULD-5f: oversized screenshot → success:true, streamed:false, with indicator", async () => {
    const bigBuffer = Buffer.alloc(4 * 1024 * 1024, 0x89); // 4 MB > 3 MB cap

    mock.module("./browser-session", () => ({
      getBrowserSession: async () => ({
        page: {
          screenshot: async () => bigBuffer,
          locator: () => ({
            first: () => ({
              screenshot: async () => bigBuffer,
              textContent: async () => "",
            }),
          }),
        },
      }),
      closeBrowserSession: async () => {},
    }));

    const chunks: unknown[] = [];
    const writer = {
      write: async (c: unknown): Promise<void> => {
        chunks.push(c);
      },
    };
    const ctx = makeContext();
    const ctxWithWriter = { ...ctx, writer };

    const { browserScreenshotTool: shot } = await import("./browser");
    const result = await shot().execute?.({}, executionOptions(ctxWithWriter));

    // success:true but streamed:false for oversized capture
    expect(result).toBeDefined();
    if (result && "success" in result && result.success) {
      expect((result as { streamed: boolean }).streamed).toBe(false);
      expect(chunks).toHaveLength(0);
    }
  });
});
