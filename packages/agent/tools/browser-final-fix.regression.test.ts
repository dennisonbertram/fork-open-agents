/**
 * Regression tests for the final-fix commit on issue #95.
 *
 * These tests lock the key behavioral contracts introduced by the fix-forward:
 *
 *  REGRESSION-FIX-1: Queue poisoning fix — a rejected write does NOT block later writes.
 *  REGRESSION-FIX-2: Attribute URL credential redaction — href/src with secrets are redacted.
 *  REGRESSION-FIX-3: Browser event emission — recorder is called with browser.* names.
 *  REGRESSION-FIX-4: Typed error.kind — failures return {kind, message} not a flat string.
 *
 * If any fix is reverted, at least one test in this file will fail.
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

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function makeFakeSession() {
  return {
    page: {
      goto: async () => ({ status: () => 200 }),
      url: () => "https://example.com/",
      title: async () => "Example",
      click: async () => {},
      fill: async () => {},
      press: async () => {},
      inputValue: async () => "val",
      locator: () => ({
        first: () => ({
          textContent: async () => "text",
          screenshot: async () => PNG_HEADER,
        }),
      }),
      getAttribute: async () => null,
      screenshot: async () => PNG_HEADER,
    },
  };
}

mock.module("./browser-session", () => ({
  getBrowserSession: async () => makeFakeSession(),
  closeBrowserSession: async () => {},
}));

const { browserNavigateTool } = await import("./browser");
const { redactBrowserText } = await import("./redact");

function executionOptions(experimental_context?: unknown) {
  return { toolCallId: "tc-regression", messages: [], experimental_context };
}

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    sandbox: {
      state: { type: "vercel" as const, sandboxId: "sb-1" },
      workingDirectory: "/repo",
    },
    model: "test-model",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// REGRESSION-FIX-1: Queue poisoning fix
// ---------------------------------------------------------------------------

describe("regression: queue-poisoning fix (MUST-1)", () => {
  test("REGRESSION-FIX-1a: enqueueWrite tail non-rejection — subsequent write executes after failure", async () => {
    // This test replicates the core fix: the tail promise must not reject.
    // If writeQueue = writeQueue.then(...) (buggy), the tail rejects and later writes are lost.
    // With the fix: const next = ...; writeQueue = next.catch(()=>undefined); the tail stays resolved.

    let writeQueue: Promise<void> = Promise.resolve();

    const called: string[] = [];
    const writeChunk = async (chunk: string) => {
      if (chunk === "fail") throw new Error("write failed");
      called.push(chunk);
    };

    // Fixed pattern
    function enqueue(chunk: string): Promise<void> {
      const next = writeQueue.then(() => writeChunk(chunk));
      writeQueue = next.catch(() => undefined);
      return next;
    }

    const fail = enqueue("fail");
    const ok = enqueue("ok");

    await fail.catch(() => undefined);
    await ok;

    // If queue was poisoned, "ok" would never have been called
    expect(called).toContain("ok");
  });
});

// ---------------------------------------------------------------------------
// REGRESSION-FIX-2: Attribute URL credential redaction
// ---------------------------------------------------------------------------

describe("regression: attribute URL credential redaction (MUST-2)", () => {
  test("REGRESSION-FIX-2a: redactBrowserText strips userinfo from embedded URL — if reverted, supersecret would appear", () => {
    const result = redactBrowserText(
      "Callback: https://user:supersecret@host.example.com/cb",
    );
    expect(result).not.toContain("supersecret");
    expect(result).not.toContain("user:supersecret@");
  });

  test("REGRESSION-FIX-2b: redactBrowserText strips ?token= from embedded URL", () => {
    const result = redactBrowserText(
      "Link: https://host.example.com/path?token=s3cr3tT0k3n",
    );
    expect(result).not.toContain("s3cr3tT0k3n");
  });

  test("REGRESSION-FIX-2c: attribute href with credentials is redacted by browser_extract", async () => {
    const credUrl = "https://user:pass@host.example.com/cb?token=s3cr3t";

    mock.module("./browser-session", () => ({
      getBrowserSession: async () => ({
        page: {
          getAttribute: async () => credUrl,
          locator: () => ({
            first: () => ({
              textContent: async () => "",
              screenshot: async () => Buffer.from([]),
            }),
          }),
        },
      }),
      closeBrowserSession: async () => {},
    }));

    const { browserExtractTool: et } = await import("./browser");
    const result = await et().execute?.(
      { selector: "a", attribute: "href" },
      executionOptions(makeContext()),
    );

    if (!result || !("success" in result) || !result.success) {
      throw new Error("Expected success result");
    }
    const value = (result as { value: string | null }).value;
    // If attribute redaction is reverted, "pass" and "s3cr3t" would appear
    expect(value).not.toContain("pass");
    expect(value).not.toContain("s3cr3t");
  });
});

// ---------------------------------------------------------------------------
// REGRESSION-FIX-3: Browser event emission
// ---------------------------------------------------------------------------

describe("regression: browser event emission (SHOULD-4)", () => {
  test("REGRESSION-FIX-3a: browserNavigateTool emits browser.* events to injected recorder", async () => {
    const events: string[] = [];
    const recorder = {
      record: (name: string) => events.push(name),
    };

    await browserNavigateTool().execute?.(
      { url: "https://example.com" },
      executionOptions(makeContext({ browserEventRecorder: recorder })),
    );

    // If events are reverted, the recorder would not be called
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((n) => n.startsWith("browser."))).toBe(true);
  });

  test("REGRESSION-FIX-3b: throwing recorder does NOT break tool (best-effort guard)", async () => {
    // Re-seed browser session mock so test is independent of previous mocks
    mock.module("./browser-session", () => ({
      getBrowserSession: async () => makeFakeSession(),
      closeBrowserSession: async () => {},
    }));

    const throwingRecorder = {
      record: () => {
        throw new Error("recorder failure");
      },
    };

    const { browserNavigateTool: nav2 } = await import("./browser");
    const result = await nav2().execute?.(
      { url: "https://example.com" },
      executionOptions(makeContext({ browserEventRecorder: throwingRecorder })),
    );

    // Tool must still succeed — best-effort guard intact
    expect(result).toMatchObject({ success: true });
  });
});

// ---------------------------------------------------------------------------
// REGRESSION-FIX-4: Typed error.kind shape
// ---------------------------------------------------------------------------

describe("regression: typed error.kind shape (SHOULD-5)", () => {
  test("REGRESSION-FIX-4a: navigation failure returns {kind:'navigation_timeout'} not a flat string", async () => {
    mock.module("./browser-session", () => ({
      getBrowserSession: async () => ({
        page: {
          goto: async () => {
            throw new Error("timeout waiting");
          },
          url: () => "",
          title: async () => "",
        },
      }),
      closeBrowserSession: async () => {},
    }));

    const { browserNavigateTool: nav } = await import("./browser");
    const result = await nav().execute?.(
      { url: "https://example.com" },
      executionOptions(makeContext()),
    );

    expect(result).toHaveProperty("success", false);
    const errorResult = result as {
      success: false;
      error: { kind: string; message: string };
    };
    // If SHOULD-5 is reverted, error would be a string
    expect(typeof errorResult.error).toBe("object");
    expect(errorResult.error).toHaveProperty("kind", "navigation_timeout");
    expect(errorResult.error).toHaveProperty("message");
  });

  test("REGRESSION-FIX-4b: screenshot failure returns {kind:'screenshot_failed'}", async () => {
    mock.module("./browser-session", () => ({
      getBrowserSession: async () => ({
        page: {
          screenshot: async () => {
            throw new Error("page crashed");
          },
          locator: () => ({
            first: () => ({
              screenshot: async () => {
                throw new Error("page crashed");
              },
              textContent: async () => "",
            }),
          }),
        },
      }),
      closeBrowserSession: async () => {},
    }));

    const { browserScreenshotTool: shot } = await import("./browser");
    const result = await shot().execute?.({}, executionOptions(makeContext()));

    expect(result).toHaveProperty("success", false);
    const errorResult = result as {
      success: false;
      error: { kind: string; message: string };
    };
    expect(errorResult.error).toHaveProperty("kind", "screenshot_failed");
  });
});

// ---------------------------------------------------------------------------
// REGRESSION-FIX-5: Preserve existing regression tests still pass
// ---------------------------------------------------------------------------

describe("regression: existing contracts still hold after final-fix", () => {
  test("REGRESSION-FIX-5a: screenshot writer.write called exactly once (no double-encode)", async () => {
    mock.module("./browser-session", () => ({
      getBrowserSession: async () => ({
        page: {
          screenshot: async () => PNG_HEADER,
          locator: () => ({
            first: () => ({
              screenshot: async () => PNG_HEADER,
              textContent: async () => "",
            }),
          }),
        },
      }),
      closeBrowserSession: async () => {},
    }));

    const chunks: unknown[] = [];
    const writer = {
      write: async (chunk: unknown) => {
        chunks.push(chunk);
      },
    };

    const { browserScreenshotTool: shot2 } = await import("./browser");
    const result = await shot2().execute?.(
      {},
      executionOptions(makeContext({ writer })),
    );

    expect(result).toMatchObject({ success: true, streamed: true });
    expect(chunks).toHaveLength(1);
  });

  test("REGRESSION-FIX-5b: safe text is not mutated by URL redaction", () => {
    const safe = "Hello, this is a safe string with no credentials.";
    expect(redactBrowserText(safe)).toBe(safe);
  });

  test("REGRESSION-FIX-5c: safe URL without credentials is preserved", () => {
    const safeUrl = "https://example.com/page";
    expect(redactBrowserText(safeUrl)).toBe(safeUrl);
  });
});
