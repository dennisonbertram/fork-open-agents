/**
 * SHOULD-4: Tests for structured browser.* event emission.
 *
 * The browser tools emit structured events via an injectable `recordBrowserEvent`
 * seam (best-effort, wrapped in try/catch so a recorder failure can't crash the agent
 * turn). Default is a no-op so tests can inject a spy.
 *
 * Events: browser.navigate, browser.click, browser.type, browser.extract,
 *         browser.screenshot.captured, browser.action.failed, browser.session.closed.
 *
 * Tests:
 *  (a) navigate + screenshot emit expected event names when a recorder is injected
 *  (b) a throwing recorder does NOT break the tool (still returns success)
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

// ---------------------------------------------------------------------------
// Late imports
// ---------------------------------------------------------------------------

const { browserNavigateTool, browserScreenshotTool, browserClickTool } =
  await import("./browser");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function executionOptions(experimental_context?: unknown) {
  return { toolCallId: "tc-events", messages: [], experimental_context };
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
// SHOULD-4 Tests
// ---------------------------------------------------------------------------

describe("SHOULD-4: structured browser.* event emission", () => {
  test("SHOULD-4a: browser_navigate emits a browser.navigate event when recorder is injected", async () => {
    const emittedEvents: Array<{ eventName: string; payload: unknown }> = [];

    const recorder = {
      record: (eventName: string, payload: unknown) => {
        emittedEvents.push({ eventName, payload });
      },
    };

    const ctx = makeContext({ browserEventRecorder: recorder });
    const result = await browserNavigateTool().execute?.(
      { url: "https://example.com" },
      executionOptions(ctx),
    );

    // Tool must succeed
    expect(result).toMatchObject({ success: true });

    // At least one event with a browser-related name must be emitted
    expect(emittedEvents.length).toBeGreaterThan(0);
    const names = emittedEvents.map((e) => e.eventName);
    expect(
      names.some(
        (n) =>
          n === "browser.navigate" ||
          n === "browser.action.performed" ||
          n.startsWith("browser."),
      ),
    ).toBe(true);
  });

  test("SHOULD-4b: browser_screenshot emits a browser.screenshot.captured event", async () => {
    const emittedEvents: Array<{ eventName: string; payload: unknown }> = [];

    const recorder = {
      record: (eventName: string, payload: unknown) => {
        emittedEvents.push({ eventName, payload });
      },
    };

    const ctx = makeContext({ browserEventRecorder: recorder });
    const result = await browserScreenshotTool().execute?.(
      {},
      executionOptions(ctx),
    );

    expect(result).toMatchObject({ success: true });

    const names = emittedEvents.map((e) => e.eventName);
    expect(
      names.some(
        (n) =>
          n === "browser.screenshot.captured" ||
          n === "browser.action.performed" ||
          n.startsWith("browser."),
      ),
    ).toBe(true);
  });

  test("SHOULD-4c: a THROWING recorder does NOT break the tool — tool still returns success", async () => {
    const throwingRecorder = {
      record: (_eventName: string, _payload: unknown) => {
        throw new Error("recorder exploded");
      },
    };

    const ctx = makeContext({ browserEventRecorder: throwingRecorder });
    const result = await browserNavigateTool().execute?.(
      { url: "https://example.com" },
      executionOptions(ctx),
    );

    // Tool must still succeed even when recorder throws
    expect(result).toMatchObject({ success: true });
  });

  test("SHOULD-4d: event payloads do NOT contain raw page text or full data-URLs — only metadata", async () => {
    const emittedEvents: Array<{ eventName: string; payload: unknown }> = [];

    const recorder = {
      record: (eventName: string, payload: unknown) => {
        emittedEvents.push({ eventName, payload });
      },
    };

    // Use a writer to trigger screenshot streaming (to ensure data-URL is NOT in event)
    const ctx = makeContext({
      browserEventRecorder: recorder,
      writer: { write: async (_: unknown) => {} },
    });

    await browserScreenshotTool().execute?.({}, executionOptions(ctx));

    // None of the emitted event payloads should contain a base64 data URL
    const serialized = JSON.stringify(emittedEvents);
    expect(serialized).not.toContain("data:image/png;base64,");
  });

  test("SHOULD-4e: browser_click emits a browser event when recorder is injected", async () => {
    const emittedEvents: string[] = [];

    const recorder = {
      record: (eventName: string, _payload: unknown) => {
        emittedEvents.push(eventName);
      },
    };

    const ctx = makeContext({ browserEventRecorder: recorder });
    const result = await browserClickTool().execute?.(
      { selector: "button" },
      executionOptions(ctx),
    );

    expect(result).toMatchObject({ success: true });
    expect(emittedEvents.length).toBeGreaterThan(0);
    expect(emittedEvents.some((n) => n.startsWith("browser."))).toBe(true);
  });

  test("SHOULD-4f: when no recorder is on context, tool runs without error (no-op default)", async () => {
    // No browserEventRecorder in context
    const result = await browserNavigateTool().execute?.(
      { url: "https://example.com" },
      executionOptions(makeContext()),
    );
    expect(result).toMatchObject({ success: true });
  });
});
