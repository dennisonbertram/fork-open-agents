/**
 * Tests for the headless browser toolset (issue #95).
 *
 * Follows the same mock pattern as tools.test.ts — mocks `ai` and
 * `@open-agents/sandbox` at module-top so real Playwright/Chromium is never
 * required. A FAKE browser page is injected via `getBrowserSession`.
 */

import { describe, expect, mock, test } from "bun:test";

// ---------------------------------------------------------------------------
// Module-level mocks (must appear before any await-imports)
// ---------------------------------------------------------------------------

mock.module("ai", () => ({
  tool: <T extends Record<string, unknown>>(definition: T) => definition,
}));

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: async () => ({}),
  tryConnectVercelSandboxDirect: async () => null,
}));

// ---------------------------------------------------------------------------
// Fake browser page factory
// ---------------------------------------------------------------------------

type FakePage = {
  goto: (url: string, opts?: unknown) => Promise<{ status: () => number }>;
  url: () => string;
  title: () => Promise<string>;
  click: (selector: string, opts?: unknown) => Promise<void>;
  fill: (selector: string, text: string) => Promise<void>;
  press: (selector: string, key: string) => Promise<void>;
  inputValue: (selector: string) => Promise<string>;
  locator: (selector: string) => {
    first: () => {
      textContent: () => Promise<string | null>;
      screenshot: () => Promise<Buffer>;
    };
  };
  getAttribute: (selector: string, attr: string) => Promise<string | null>;
  screenshot: (opts?: { fullPage?: boolean }) => Promise<Buffer>;
};

function makeFakePage(overrides: Partial<FakePage> = {}): FakePage {
  return {
    goto: async (_url: string) => ({ status: () => 200 }),
    url: () => "https://example.com/",
    title: async () => "Example Domain",
    click: async () => {},
    fill: async () => {},
    press: async () => {},
    inputValue: async () => "typed-value",
    locator: (_selector: string) => ({
      first: () => ({
        textContent: async () => "  extracted text  ",
        screenshot: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]), // minimal PNG header
      }),
    }),
    getAttribute: async () => "https://linked.com",
    screenshot: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Inject a fake page resolver so tests don't need Chromium
// ---------------------------------------------------------------------------

let currentFakePage: FakePage = makeFakePage();

mock.module("./browser-session", () => ({
  getBrowserSession: async (_context: unknown) => ({ page: currentFakePage }),
  closeBrowserSession: async (_context: unknown) => {},
}));

// ---------------------------------------------------------------------------
// Late imports (after mocks are wired)
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

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function executionOptions(experimental_context?: unknown) {
  return {
    toolCallId: "tool-call-1",
    messages: [],
    experimental_context,
  };
}

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    sandbox: {
      state: { type: "vercel" as const, sandboxId: "sandbox-1" },
      workingDirectory: "/repo",
    },
    model: "test-model",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// BT-001: browser_navigate happy path
// ---------------------------------------------------------------------------
describe("browserNavigateTool", () => {
  test("BT-001a: execute returns success with url, status, title on happy path", async () => {
    currentFakePage = makeFakePage({
      goto: async () => ({ status: () => 200 }),
      url: () => "https://example.com/",
      title: async () => "Example Domain",
    });

    const result = await browserNavigateTool().execute?.(
      { url: "https://example.com/" },
      executionOptions(makeContext()),
    );

    expect(result).toMatchObject({
      success: true,
      url: "https://example.com/",
      status: 200,
      title: "Example Domain",
    });
  });

  test("BT-001b: execute returns { success: false, error } on failure — never throws", async () => {
    currentFakePage = makeFakePage({
      goto: async () => {
        throw new Error("net::ERR_CONNECTION_REFUSED");
      },
    });

    const result = await browserNavigateTool().execute?.(
      { url: "https://unreachable.example/" },
      executionOptions(makeContext()),
    );

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("ERR_CONNECTION_REFUSED"),
    });
  });

  test("BT-001c: needsApproval returns true for browser navigation (approval gate)", async () => {
    const tool = browserNavigateTool();
    const needsApproval = tool.needsApproval;
    expect(needsApproval).toBeDefined();

    let result: boolean;
    if (typeof needsApproval === "function") {
      result = await Promise.resolve(
        needsApproval(
          { url: "https://example.com/" },
          executionOptions(makeContext()),
        ),
      );
    } else {
      result = needsApproval ?? false;
    }
    expect(result).toBe(true);
  });

  test("BT-001d: inputSchema validates url as required string", () => {
    const tool = browserNavigateTool();
    expect(tool.inputSchema).toBeDefined();
    // The schema should be a Zod schema that rejects missing url
    const parsed = (
      tool.inputSchema as { safeParse: (v: unknown) => { success: boolean } }
    ).safeParse({});
    expect(parsed.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BT-002: browser_click
// ---------------------------------------------------------------------------
describe("browserClickTool", () => {
  test("BT-002a: execute returns success with selector and current page info", async () => {
    currentFakePage = makeFakePage({
      url: () => "https://example.com/after-click",
      title: async () => "After Click",
    });

    const result = await browserClickTool().execute?.(
      { selector: "button#submit" },
      executionOptions(makeContext()),
    );

    expect(result).toMatchObject({
      success: true,
      selector: "button#submit",
      url: "https://example.com/after-click",
      title: "After Click",
    });
  });

  test("BT-002b: execute returns { success: false } when element not found", async () => {
    currentFakePage = makeFakePage({
      click: async () => {
        throw new Error("Timeout: waiting for selector");
      },
    });

    const result = await browserClickTool().execute?.(
      { selector: "#nonexistent" },
      executionOptions(makeContext()),
    );

    expect(result).toMatchObject({
      success: false,
      error: expect.any(String),
    });
  });

  test("BT-002c: needsApproval returns true for browser click (approval gate)", async () => {
    const tool = browserClickTool();
    const needsApproval = tool.needsApproval;
    let result: boolean;
    if (typeof needsApproval === "function") {
      result = await Promise.resolve(
        needsApproval({ selector: "button" }, executionOptions(makeContext())),
      );
    } else {
      result = needsApproval ?? false;
    }
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BT-003: browser_type
// ---------------------------------------------------------------------------
describe("browserTypeTool", () => {
  test("BT-003a: execute returns success with value confirmation", async () => {
    currentFakePage = makeFakePage({
      inputValue: async () => "hello world",
    });

    const result = await browserTypeTool().execute?.(
      { selector: "input#search", text: "hello world" },
      executionOptions(makeContext()),
    );

    expect(result).toMatchObject({
      success: true,
      selector: "input#search",
      value: "hello world",
      submitted: false,
    });
  });

  test("BT-003b: execute with submit:true marks submitted as true", async () => {
    let pressedKey: string | undefined;
    currentFakePage = makeFakePage({
      press: async (_selector: string, key: string) => {
        pressedKey = key;
      },
      inputValue: async () => "submitted-value",
    });

    const result = await browserTypeTool().execute?.(
      { selector: "input#q", text: "submitted-value", submit: true },
      executionOptions(makeContext()),
    );

    expect(pressedKey).toBe("Enter");
    expect(result).toMatchObject({
      success: true,
      submitted: true,
    });
  });

  test("BT-003c: execute returns { success: false } on fill failure", async () => {
    currentFakePage = makeFakePage({
      fill: async () => {
        throw new Error("Element is not visible");
      },
    });

    const result = await browserTypeTool().execute?.(
      { selector: "#hidden", text: "secret" },
      executionOptions(makeContext()),
    );

    expect(result).toMatchObject({ success: false, error: expect.any(String) });
  });

  test("BT-003d: needsApproval returns true for browser type (approval gate)", async () => {
    const tool = browserTypeTool();
    const needsApproval = tool.needsApproval;
    let result: boolean;
    if (typeof needsApproval === "function") {
      result = await Promise.resolve(
        needsApproval(
          { selector: "input", text: "data" },
          executionOptions(makeContext()),
        ),
      );
    } else {
      result = needsApproval ?? false;
    }
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BT-004: browser_extract
// ---------------------------------------------------------------------------
describe("browserExtractTool", () => {
  test("BT-004a: execute returns trimmed text for selector", async () => {
    currentFakePage = makeFakePage({
      locator: (_selector: string) => ({
        first: () => ({
          textContent: async () => "  Hello World  ",
          screenshot: async () => Buffer.from([]),
        }),
      }),
    });

    const result = await browserExtractTool().execute?.(
      { selector: "h1" },
      executionOptions(makeContext()),
    );

    expect(result).toMatchObject({
      success: true,
      selector: "h1",
      text: "Hello World",
    });
  });

  test("BT-004b: execute with attribute returns attribute value", async () => {
    currentFakePage = makeFakePage({
      getAttribute: async (_selector: string, attr: string) => {
        if (attr === "href") return "https://target.com";
        return null;
      },
    });

    const result = await browserExtractTool().execute?.(
      { selector: "a.link", attribute: "href" },
      executionOptions(makeContext()),
    );

    expect(result).toMatchObject({
      success: true,
      selector: "a.link",
      attribute: "href",
      value: "https://target.com",
    });
  });

  test("BT-004c: execute without selector extracts from body", async () => {
    const result = await browserExtractTool().execute?.(
      {},
      executionOptions(makeContext()),
    );

    expect(result).toMatchObject({
      success: true,
      selector: "body",
    });
  });

  test("BT-004d: execute returns { success: false } on error", async () => {
    currentFakePage = makeFakePage({
      locator: () => ({
        first: () => ({
          textContent: async () => {
            throw new Error("Page detached");
          },
          screenshot: async () => Buffer.from([]),
        }),
      }),
    });

    const result = await browserExtractTool().execute?.(
      { selector: "#gone" },
      executionOptions(makeContext()),
    );

    expect(result).toMatchObject({ success: false, error: expect.any(String) });
  });
});

// ---------------------------------------------------------------------------
// BT-005: browser_screenshot — structured result + inline image streaming
// ---------------------------------------------------------------------------
describe("browserScreenshotTool", () => {
  const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

  test("BT-005a: execute returns success with mediaType and byteLength", async () => {
    currentFakePage = makeFakePage({
      screenshot: async () => PNG_HEADER,
    });

    const result = await browserScreenshotTool().execute?.(
      {},
      executionOptions(makeContext()),
    );

    expect(result).toMatchObject({
      success: true,
      mediaType: "image/png",
      byteLength: PNG_HEADER.byteLength,
    });
  });

  test("BT-005b: execute calls writer.write with FileUIPart chunk when writer is on context", async () => {
    currentFakePage = makeFakePage({
      screenshot: async () => PNG_HEADER,
    });

    const chunks: unknown[] = [];
    const fakeWriter = {
      write: (chunk: unknown) => {
        chunks.push(chunk);
      },
    };

    const ctx = makeContext({ writer: fakeWriter });
    const result = await browserScreenshotTool().execute?.(
      {},
      executionOptions(ctx),
    );

    expect(result).toMatchObject({ success: true, streamed: true });
    expect(chunks).toHaveLength(1);
    const chunk = chunks[0] as { type: string; url: string; mediaType: string };
    expect(chunk.type).toBe("file");
    expect(chunk.mediaType).toBe("image/png");
    expect(chunk.url).toMatch(/^data:image\/png;base64,/);
  });

  test("BT-005c: execute does NOT call writer.write when writer is absent", async () => {
    currentFakePage = makeFakePage({
      screenshot: async () => PNG_HEADER,
    });

    const result = await browserScreenshotTool().execute?.(
      {},
      executionOptions(makeContext()),
    );

    expect(result).toMatchObject({ success: true, streamed: false });
  });

  test("BT-005d: execute returns { success: false } on screenshot error", async () => {
    currentFakePage = makeFakePage({
      screenshot: async () => {
        throw new Error("Target page crashed");
      },
    });

    const result = await browserScreenshotTool().execute?.(
      {},
      executionOptions(makeContext()),
    );

    expect(result).toMatchObject({ success: false, error: expect.any(String) });
  });

  test("BT-005e: needsApproval returns true for browser screenshot (approval gate)", async () => {
    const tool = browserScreenshotTool();
    const needsApproval = tool.needsApproval;
    let result: boolean;
    if (typeof needsApproval === "function") {
      result = await Promise.resolve(
        needsApproval({}, executionOptions(makeContext())),
      );
    } else {
      result = needsApproval ?? false;
    }
    expect(result).toBe(true);
  });

  test("BT-005f: selector screenshot uses locator element screenshot", async () => {
    const elementPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]);
    currentFakePage = makeFakePage({
      locator: (_selector: string) => ({
        first: () => ({
          textContent: async () => "",
          screenshot: async () => elementPng,
        }),
      }),
    });

    const result = await browserScreenshotTool().execute?.(
      { selector: "#chart" },
      executionOptions(makeContext()),
    );

    expect(result).toMatchObject({
      success: true,
      byteLength: elementPng.byteLength,
    });
  });
});

// ---------------------------------------------------------------------------
// BT-006: browser-image-part helpers
// ---------------------------------------------------------------------------
describe("buildScreenshotPart and buildScreenshotStreamChunk", () => {
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

  test("BT-006a: buildScreenshotPart produces FileUIPart with data URL and image/png mediaType", () => {
    const part = buildScreenshotPart({ bytes: pngBytes, filename: "shot.png" });

    expect(part.type).toBe("file");
    expect(part.mediaType).toBe("image/png");
    expect(part.url).toMatch(/^data:image\/png;base64,/);
    expect(part.filename).toBe("shot.png");

    // Verify the base64 payload decodes back to original bytes
    const b64 = part.url.split(",")[1];
    expect(b64).toBeDefined();
    const decoded = Buffer.from(b64 ?? "", "base64");
    expect(decoded).toEqual(pngBytes);
  });

  test("BT-006b: buildScreenshotPart matches renderer predicate (type==='file' && mediaType.startsWith('image/'))", () => {
    const part = buildScreenshotPart({ bytes: pngBytes });

    // This is the exact predicate in shared-chat-content.tsx line 466
    expect(part.type === "file" && part.mediaType?.startsWith("image/")).toBe(
      true,
    );
  });

  test("BT-006c: buildScreenshotStreamChunk produces chunk without filename, with correct shape", () => {
    const chunk = buildScreenshotStreamChunk({ bytes: pngBytes });

    expect(chunk.type).toBe("file");
    expect(chunk.mediaType).toBe("image/png");
    expect(chunk.url).toMatch(/^data:image\/png;base64,/);
    expect("filename" in chunk).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BT-007: approval-policy browser branch
// ---------------------------------------------------------------------------
const { classifyToolApproval } = await import("./approval-policy");

describe("classifyToolApproval — browser tools", () => {
  test("BT-007a: browser_navigate requires approval (conservative outward-facing gate)", () => {
    const decision = classifyToolApproval("browser_navigate", {
      url: "https://example.com",
    });
    expect(decision.requires).toBe(true);
    expect(decision.category).toBe("browser-navigation");
  });

  test("BT-007b: browser_click requires approval", () => {
    const decision = classifyToolApproval("browser_click", {
      selector: "button",
    });
    expect(decision.requires).toBe(true);
    expect(decision.category).toBe("browser-navigation");
  });

  test("BT-007c: browser_screenshot requires approval", () => {
    const decision = classifyToolApproval("browser_screenshot", {});
    expect(decision.requires).toBe(true);
    expect(decision.category).toBe("browser-navigation");
  });
});
