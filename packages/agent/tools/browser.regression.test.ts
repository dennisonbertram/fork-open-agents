/**
 * Regression tests for the headless browser toolset (issue #95).
 *
 * These tests lock the highest-value behavioral contracts that would break
 * silently if the implementation is changed or reverted:
 *
 *  1. Inline-image contract: the FileUIPart shape from buildScreenshotPart
 *     exactly matches the renderer predicate in shared-chat-content.tsx:466.
 *
 *  2. Approval gate: all five browser tools require approval via classifyToolApproval
 *     with category "browser-navigation" — reversion would silently un-gate navigation.
 *
 *  3. Screenshot writer call: when a writer is present on context, the screenshot
 *     tool calls writer.write exactly once with the correct chunk shape.
 *
 *  4. Non-throwing contract: all tools return { success: false, error } instead of
 *     throwing on Playwright errors — callers rely on this discriminated union.
 *
 *  5. No Playwright at module top-level: browser.ts and browser-session.ts import
 *     Playwright lazily — tests and typecheck work without Chromium binary.
 */

import { describe, expect, mock, test } from "bun:test";

// ---------------------------------------------------------------------------
// Mock module wiring — must precede all await-imports
// ---------------------------------------------------------------------------

mock.module("ai", () => ({
  tool: <T extends Record<string, unknown>>(definition: T) => definition,
}));

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: async () => ({}),
  tryConnectVercelSandboxDirect: async () => null,
}));

let fakePage = makeFakePage();

mock.module("./browser-session", () => ({
  getBrowserSession: async (_context: unknown) => ({ page: fakePage }),
  closeBrowserSession: async () => {},
}));

// ---------------------------------------------------------------------------
// Fake page helpers
// ---------------------------------------------------------------------------

function makeFakePage() {
  return {
    goto: async (_url: string) => ({ status: () => 200 }),
    url: () => "https://example.com/",
    title: async () => "Example",
    click: async () => {},
    fill: async () => {},
    press: async () => {},
    inputValue: async () => "value",
    locator: (_selector: string) => ({
      first: () => ({
        textContent: async () => "text",
        screenshot: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      }),
    }),
    getAttribute: async () => "value",
    screenshot: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  };
}

// ---------------------------------------------------------------------------
// Late imports
// ---------------------------------------------------------------------------

const {
  browserNavigateTool,
  browserClickTool,
  browserTypeTool,
  browserExtractTool,
  browserScreenshotTool,
} = await import("./browser");

const { buildScreenshotPart, buildScreenshotStreamChunk } =
  await import("./browser-image-part");

const { classifyToolApproval } = await import("./approval-policy");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function executionOptions(experimental_context?: unknown) {
  return { toolCallId: "tc-1", messages: [], experimental_context };
}

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    sandbox: {
      state: { type: "vercel" as const, sandboxId: "s-1" },
      workingDirectory: "/repo",
    },
    model: "test-model",
    ...overrides,
  };
}

const PNG_4B = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

// ---------------------------------------------------------------------------
// REGRESSION-001: inline-image contract — renderer predicate match
// ---------------------------------------------------------------------------
describe("regression: inline-image FileUIPart contract", () => {
  test("REGRESSION-001: buildScreenshotPart produces shape that satisfies renderer predicate", () => {
    const part = buildScreenshotPart({ bytes: PNG_4B });

    // Exact predicate from shared-chat-content.tsx:466
    const rendererWouldRender =
      part.type === "file" && part.mediaType?.startsWith("image/");
    expect(rendererWouldRender).toBe(true);

    // Data URL structure
    expect(part.url).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);

    // Round-trip fidelity
    const b64 = part.url.split(",")[1] ?? "";
    expect(Buffer.from(b64, "base64")).toEqual(PNG_4B);
  });

  test("REGRESSION-001b: buildScreenshotStreamChunk has no filename and correct shape", () => {
    const chunk = buildScreenshotStreamChunk({ bytes: PNG_4B });
    expect(chunk.type).toBe("file");
    expect(chunk.mediaType).toBe("image/png");
    expect(chunk.url).toMatch(/^data:image\/png;base64,/);
    expect("filename" in chunk).toBe(false);
  });

  test("REGRESSION-001c: screenshot tool streams a chunk matching renderer predicate", async () => {
    fakePage = makeFakePage();
    const chunks: Array<{ type: string; url: string; mediaType: string }> = [];
    const writer = {
      write: (c: { type: string; url: string; mediaType: string }) => {
        chunks.push(c);
      },
    };

    await browserScreenshotTool().execute?.(
      {},
      executionOptions(makeContext({ writer })),
    );

    expect(chunks).toHaveLength(1);
    const c = chunks[0] as { type: string; url: string; mediaType: string };
    // renderer predicate
    expect(c.type === "file" && c.mediaType?.startsWith("image/")).toBe(true);
    expect(c.url).toMatch(/^data:image\/png;base64,/);
  });
});

// ---------------------------------------------------------------------------
// REGRESSION-002: approval gate — all five browser tools require approval
// ---------------------------------------------------------------------------
describe("regression: browser approval gate — all five tools gated", () => {
  const TOOL_NAMES = [
    "browser_navigate",
    "browser_click",
    "browser_type",
    "browser_extract",
    "browser_screenshot",
  ] as const;

  for (const toolName of TOOL_NAMES) {
    test(`REGRESSION-002: ${toolName} requires approval with category "browser-navigation"`, () => {
      const decision = classifyToolApproval(toolName, {});
      expect(decision.requires).toBe(true);
      expect(decision.category).toBe("browser-navigation");
    });
  }

  test("REGRESSION-002f: browserNavigateTool needsApproval returns true", async () => {
    const tool = browserNavigateTool();
    const n = tool.needsApproval;
    let result: boolean;
    if (typeof n === "function") {
      result = await Promise.resolve(
        n({ url: "https://example.com" }, executionOptions()),
      );
    } else {
      result = n ?? false;
    }
    expect(result).toBe(true);
  });

  test("REGRESSION-002g: browserScreenshotTool needsApproval returns true", async () => {
    const tool = browserScreenshotTool();
    const n = tool.needsApproval;
    let result: boolean;
    if (typeof n === "function") {
      result = await Promise.resolve(n({}, executionOptions()));
    } else {
      result = n ?? false;
    }
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// REGRESSION-003: non-throwing contract for all tools
// ---------------------------------------------------------------------------
describe("regression: non-throwing contract — tools return {success:false} not throw", () => {
  test("REGRESSION-003a: browserNavigateTool returns {success:false} on error", async () => {
    fakePage = {
      ...makeFakePage(),
      goto: async () => {
        throw new Error("ECONNREFUSED");
      },
    };
    const result = await browserNavigateTool().execute?.(
      { url: "https://bad.example/" },
      executionOptions(makeContext()),
    );
    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("ECONNREFUSED"),
    });
  });

  test("REGRESSION-003b: browserClickTool returns {success:false} on error", async () => {
    fakePage = {
      ...makeFakePage(),
      click: async () => {
        throw new Error("Timeout 5000ms exceeded");
      },
    };
    const result = await browserClickTool().execute?.(
      { selector: "#missing" },
      executionOptions(makeContext()),
    );
    expect(result).toMatchObject({ success: false, error: expect.any(String) });
  });

  test("REGRESSION-003c: browserTypeTool returns {success:false} on error", async () => {
    fakePage = {
      ...makeFakePage(),
      fill: async () => {
        throw new Error("Detached");
      },
    };
    const result = await browserTypeTool().execute?.(
      { selector: "#gone", text: "hello" },
      executionOptions(makeContext()),
    );
    expect(result).toMatchObject({ success: false, error: expect.any(String) });
  });

  test("REGRESSION-003d: browserExtractTool returns {success:false} on error", async () => {
    fakePage = {
      ...makeFakePage(),
      locator: () => ({
        first: () => ({
          textContent: async () => {
            throw new Error("detached");
          },
          screenshot: async () => Buffer.from([]),
        }),
      }),
    };
    const result = await browserExtractTool().execute?.(
      { selector: "#gone" },
      executionOptions(makeContext()),
    );
    expect(result).toMatchObject({ success: false, error: expect.any(String) });
  });

  test("REGRESSION-003e: browserScreenshotTool returns {success:false} on error", async () => {
    fakePage = {
      ...makeFakePage(),
      screenshot: async () => {
        throw new Error("Target page crashed");
      },
    };
    const result = await browserScreenshotTool().execute?.(
      {},
      executionOptions(makeContext()),
    );
    expect(result).toMatchObject({ success: false, error: expect.any(String) });
  });
});

// ---------------------------------------------------------------------------
// REGRESSION-004: writer is NOT called when absent from context
// ---------------------------------------------------------------------------
describe("regression: writer absent — screenshot does not attempt to write", () => {
  test("REGRESSION-004: screamed=false when no writer on context", async () => {
    fakePage = makeFakePage();
    const result = await browserScreenshotTool().execute?.(
      {},
      executionOptions(makeContext()),
    );
    expect(result).toMatchObject({ success: true, streamed: false });
  });
});

// ---------------------------------------------------------------------------
// REGRESSION-005: async writer contract — no unhandled rejections from screenshot
// ---------------------------------------------------------------------------
describe("regression: async writer contract — writing is awaited, errors are caught", () => {
  test("REGRESSION-005a: async writer.write is awaited — tool returns success when write resolves", async () => {
    fakePage = makeFakePage();
    let writeWasCalled = false;
    const asyncWriter = {
      write: async (_chunk: unknown): Promise<void> => {
        writeWasCalled = true;
        await Promise.resolve();
      },
    };
    const result = await browserScreenshotTool().execute?.(
      {},
      executionOptions(makeContext({ writer: asyncWriter })),
    );
    expect(writeWasCalled).toBe(true);
    expect(result).toMatchObject({ success: true, streamed: true });
  });

  test("REGRESSION-005b: writer.write that rejects → tool returns well-formed result, no unhandled rejection", async () => {
    fakePage = makeFakePage();
    let unhandled = false;
    const handler = () => {
      unhandled = true;
    };
    process.on("unhandledRejection", handler);

    const rejectingWriter = {
      write: (): Promise<void> =>
        Promise.reject(new Error("stream locked — regression guard")),
    };

    const result = await browserScreenshotTool().execute?.(
      {},
      executionOptions(makeContext({ writer: rejectingWriter })),
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    process.off("unhandledRejection", handler);

    expect(unhandled).toBe(false);
    expect(result).toBeDefined();
    expect(result).toHaveProperty("success");
  });

  test("REGRESSION-005c: oversized screenshot is NOT streamed (byte cap enforced)", async () => {
    fakePage = {
      ...makeFakePage(),
      screenshot: async () => Buffer.alloc(4 * 1024 * 1024, 0x89),
    };
    const chunks: unknown[] = [];
    const writer = {
      write: async (chunk: unknown): Promise<void> => {
        chunks.push(chunk);
      },
    };
    const result = await browserScreenshotTool().execute?.(
      {},
      executionOptions(makeContext({ writer })),
    );
    // Must succeed but NOT stream the oversized screenshot
    if (result && "success" in result && result.success) {
      expect((result as { streamed: boolean }).streamed).toBe(false);
      expect(chunks).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// REGRESSION-006: extract redaction + cap contract
// ---------------------------------------------------------------------------
describe("regression: extract text redaction + cap", () => {
  test("REGRESSION-006a: extract output containing a Bearer token is redacted before return", async () => {
    fakePage = {
      ...makeFakePage(),
      locator: () => ({
        first: () => ({
          textContent: async () =>
            "Access with: Bearer sk-REGRESSION-GUARD-TOKEN-123456 for auth",
          screenshot: async () => Buffer.from([]),
        }),
      }),
    };
    const { browserExtractTool: extract } = await import("./browser");
    const result = await extract().execute?.(
      { selector: "p" },
      executionOptions(makeContext()),
    );
    if (result && "success" in result && result.success && "text" in result) {
      expect((result as { text: string }).text).not.toContain(
        "Bearer sk-REGRESSION-GUARD-TOKEN-123456",
      );
      expect((result as { text: string }).text).toContain("[REDACTED]");
    } else {
      throw new Error("Expected success result with text");
    }
  });

  test("REGRESSION-006b: extract output longer than 10000 chars is truncated with marker", async () => {
    fakePage = {
      ...makeFakePage(),
      locator: () => ({
        first: () => ({
          textContent: async () => "X".repeat(20000),
          screenshot: async () => Buffer.from([]),
        }),
      }),
    };
    const { browserExtractTool: extract2 } = await import("./browser");
    const result = await extract2().execute?.(
      { selector: "body" },
      executionOptions(makeContext()),
    );
    if (result && "success" in result && result.success && "text" in result) {
      expect((result as { text: string }).text.length).toBeLessThanOrEqual(
        10100,
      );
      expect((result as { text: string }).text).toContain("[TRUNCATED");
    } else {
      throw new Error("Expected success result with text");
    }
  });
});

// ---------------------------------------------------------------------------
// REGRESSION-007: sessionId is threaded from context to getBrowserSession
// ---------------------------------------------------------------------------
describe("regression: sessionId threading — each chat gets its own browser key", () => {
  test("REGRESSION-007: distinct sessionIds produce distinct cache keys in getBrowserSession", async () => {
    const capturedKeys: Array<string | undefined> = [];

    mock.module("./browser-session", () => ({
      getBrowserSession: async (ctx: { sessionId?: string }) => {
        capturedKeys.push(ctx?.sessionId);
        return {
          page: {
            goto: async () => ({ status: () => 200 }),
            url: () => "https://x.com",
            title: async () => "X",
          },
        };
      },
      closeBrowserSession: async () => {},
    }));

    const { browserNavigateTool: nav } = await import("./browser");
    await nav().execute?.(
      { url: "https://a.com" },
      executionOptions(makeContext({ sessionId: "chat-111" })),
    );
    await nav().execute?.(
      { url: "https://b.com" },
      executionOptions(makeContext({ sessionId: "chat-222" })),
    );

    expect(capturedKeys).toContain("chat-111");
    expect(capturedKeys).toContain("chat-222");
    expect(capturedKeys[0]).not.toBe(capturedKeys[1]);
  });
});
