/**
 * Tests for browser-session.ts real implementation.
 *
 * These tests mock the "playwright" module directly and import the real
 * browser-session.ts to verify:
 *  - FIX 4: default launch args omit --no-sandbox; env flag adds it
 *  - FIX 5: closeBrowserSession closes browser handles; cache self-heals on failure
 *
 * NOTE: This file must NOT mock "./browser-session" — it imports the real module.
 */

import { describe, expect, mock, test } from "bun:test";

// ---------------------------------------------------------------------------
// Helpers for building fake playwright browser/context/page
// ---------------------------------------------------------------------------

function makeFakePlaywright(opts: {
  onLaunch?: (launchOpts: { args?: string[] }) => void;
  failLaunch?: boolean;
  onBrowserClose?: () => void;
}) {
  return {
    chromium: {
      launch: async (launchOpts: { headless?: boolean; args?: string[] }) => {
        opts.onLaunch?.(launchOpts);
        if (opts.failLaunch) {
          throw new Error("Chromium launch failed");
        }
        return {
          newContext: async () => ({
            newPage: async () => ({
              url: () => "about:blank",
              close: async () => {},
            }),
            close: async () => {},
          }),
          close: async () => {
            opts.onBrowserClose?.();
          },
        };
      },
    },
  };
}

// ---------------------------------------------------------------------------
// FIX 4: default launch args
// ---------------------------------------------------------------------------

describe("FIX-4 (browser-session): launch args sandbox policy", () => {
  test("FIX-4a: default launch args omit --no-sandbox when env flag is unset", async () => {
    const capturedArgs: string[][] = [];
    const originalEnv = process.env["OPEN_AGENTS_BROWSER_NO_SANDBOX"];
    delete process.env["OPEN_AGENTS_BROWSER_NO_SANDBOX"];

    mock.module("playwright", () =>
      makeFakePlaywright({
        onLaunch: (opts) => capturedArgs.push(opts.args ?? []),
      }),
    );

    try {
      const { getBrowserSession } = await import("./browser-session");
      const sessionId = "fix4a-real-" + Date.now() + "-" + Math.random();
      await getBrowserSession({ sessionId });
      // Success — launch was called
      expect(capturedArgs.length).toBeGreaterThanOrEqual(1);
      for (const args of capturedArgs) {
        expect(args).not.toContain("--no-sandbox");
      }
    } finally {
      if (originalEnv === undefined) {
        delete process.env["OPEN_AGENTS_BROWSER_NO_SANDBOX"];
      } else {
        process.env["OPEN_AGENTS_BROWSER_NO_SANDBOX"] = originalEnv;
      }
    }
  });

  test("FIX-4b: OPEN_AGENTS_BROWSER_NO_SANDBOX=1 adds --no-sandbox to launch args", async () => {
    const capturedArgs: string[][] = [];
    const originalEnv = process.env["OPEN_AGENTS_BROWSER_NO_SANDBOX"];
    process.env["OPEN_AGENTS_BROWSER_NO_SANDBOX"] = "1";

    mock.module("playwright", () =>
      makeFakePlaywright({
        onLaunch: (opts) => capturedArgs.push(opts.args ?? []),
      }),
    );

    try {
      const { getBrowserSession } = await import("./browser-session");
      const sessionId = "fix4b-real-" + Date.now() + "-" + Math.random();
      await getBrowserSession({ sessionId });
      expect(capturedArgs.length).toBeGreaterThanOrEqual(1);
      for (const args of capturedArgs) {
        expect(args).toContain("--no-sandbox");
      }
    } finally {
      if (originalEnv === undefined) {
        delete process.env["OPEN_AGENTS_BROWSER_NO_SANDBOX"];
      } else {
        process.env["OPEN_AGENTS_BROWSER_NO_SANDBOX"] = originalEnv;
      }
    }
  });

  test("FIX-4c: injectable launch.args override is passed through", async () => {
    const capturedArgs: string[][] = [];

    mock.module("playwright", () =>
      makeFakePlaywright({
        onLaunch: (opts) => capturedArgs.push(opts.args ?? []),
      }),
    );

    const { getBrowserSession } = await import("./browser-session");
    const sessionId = "fix4c-real-" + Date.now() + "-" + Math.random();
    await getBrowserSession({
      sessionId,
      launch: { args: ["--disable-gpu", "--headless=new"] },
    });

    expect(capturedArgs.length).toBeGreaterThanOrEqual(1);
    const lastArgs = capturedArgs[capturedArgs.length - 1] ?? [];
    expect(lastArgs).toContain("--disable-gpu");
    expect(lastArgs).toContain("--headless=new");
  });
});

// ---------------------------------------------------------------------------
// FIX 5: closeBrowserSession closes handles; cache self-heals on failure
// ---------------------------------------------------------------------------

describe("FIX-5 (browser-session): close handles + cache self-heal", () => {
  test("FIX-5a: closeBrowserSession calls close() on the underlying browser handle", async () => {
    let browserClosed = false;

    mock.module("playwright", () =>
      makeFakePlaywright({
        onBrowserClose: () => {
          browserClosed = true;
        },
      }),
    );

    const { getBrowserSession, closeBrowserSession } =
      await import("./browser-session");
    const sessionId = "fix5a-real-" + Date.now() + "-" + Math.random();

    await getBrowserSession({ sessionId });
    await closeBrowserSession({ sessionId });

    expect(browserClosed).toBe(true);
  });

  test("FIX-5b: after close, a new getBrowserSession call re-launches (cache evicted)", async () => {
    let launchCount = 0;

    mock.module("playwright", () =>
      makeFakePlaywright({
        onLaunch: () => {
          launchCount++;
        },
      }),
    );

    const { getBrowserSession, closeBrowserSession } =
      await import("./browser-session");
    const sessionId = "fix5b-real-" + Date.now() + "-" + Math.random();

    await getBrowserSession({ sessionId });
    expect(launchCount).toBe(1);

    await closeBrowserSession({ sessionId });
    await getBrowserSession({ sessionId });
    expect(launchCount).toBe(2);
  });

  test("FIX-5c: a launch failure evicts the cache entry — next call retries instead of returning sticky rejected promise", async () => {
    let attemptCount = 0;
    let shouldFail = true;

    mock.module("playwright", () => ({
      chromium: {
        launch: async () => {
          attemptCount++;
          if (shouldFail) {
            throw new Error("Chromium launch failed — fix5c");
          }
          return {
            newContext: async () => ({
              newPage: async () => ({ url: () => "about:blank" }),
              close: async () => {},
            }),
            close: async () => {},
          };
        },
      },
    }));

    const { getBrowserSession } = await import("./browser-session");
    const sessionId = "fix5c-real-" + Date.now() + "-" + Math.random();

    // First call — should fail
    let firstError: unknown;
    try {
      await getBrowserSession({ sessionId });
    } catch (error) {
      firstError = error;
    }
    expect(firstError).toBeDefined();
    expect((firstError as Error).message).toContain("Chromium launch failed");
    expect(attemptCount).toBe(1);

    // Allow subsequent launch to succeed
    shouldFail = false;

    // Second call — cache must be evicted (self-healed), so it re-attempts
    let session: unknown;
    let secondError: unknown;
    try {
      session = await getBrowserSession({ sessionId });
    } catch (err) {
      secondError = err;
    }

    // The cache must have been evicted → second attempt must have been made
    expect(attemptCount).toBe(2);
    if (!secondError) {
      expect(session).toBeDefined();
    }
  });

  test("FIX-5d: closeBrowserSession on non-existent key is a no-op (does not throw)", async () => {
    const { closeBrowserSession } = await import("./browser-session");
    // Should not throw
    await closeBrowserSession({ sessionId: "nonexistent-" + Math.random() });
  });
});
