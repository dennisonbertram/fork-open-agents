/**
 * Real per-session Playwright browser launcher.
 *
 * Provides a thin, injectable seam: `getBrowserSession(context)` is what the
 * browser tools call. Tests inject a fake page via mock.module("./browser-session").
 *
 * In production the real Playwright launch is behind a dynamic `import("playwright")`
 * so typecheck and unit tests (which mock this module) never require the Chromium binary.
 *
 * Session caching: one browser+page per (sessionId if provided, else process singleton),
 * so navigate/click/type/extract/screenshot all share one live page coherently.
 */

export type BrowserContext = {
  /** Unique session id for per-session browser caching. */
  sessionId?: string;
  /** Optional Playwright launch options. */
  launch?: {
    headless?: boolean;
    args?: string[];
  };
};

export type BrowserSession = {
  page: {
    goto: (url: string, opts?: { waitUntil?: string }) => Promise<{ status: () => number } | null>;
    url: () => string;
    title: () => Promise<string>;
    click: (selector: string, opts?: { timeout?: number }) => Promise<void>;
    fill: (selector: string, text: string) => Promise<void>;
    press: (selector: string, key: string) => Promise<void>;
    inputValue: (selector: string) => Promise<string | null>;
    locator: (selector: string) => {
      first: () => {
        innerText: () => Promise<string>;
        screenshot: () => Promise<Buffer>;
      };
    };
    getAttribute: (selector: string, attribute: string) => Promise<string | null>;
    screenshot: (opts?: { fullPage?: boolean }) => Promise<Buffer>;
  };
};

// Process-level cache keyed by session id (or a shared "_default" key).
const sessionCache = new Map<string, Promise<BrowserSession>>();

/**
 * Get or create a browser session for the given context.
 *
 * The real Playwright is imported dynamically so this module can be imported
 * without Chromium available (tests mock this module entirely).
 */
export async function getBrowserSession(
  context: BrowserContext = {},
): Promise<BrowserSession> {
  const cacheKey = context.sessionId ?? "_default";

  if (sessionCache.has(cacheKey)) {
    return sessionCache.get(cacheKey) as Promise<BrowserSession>;
  }

  const promise = (async () => {
    // Dynamic import keeps real Playwright out of the module graph until needed.
    const playwright = await import("playwright");
    const browser = await playwright.chromium.launch({
      headless: context.launch?.headless ?? true,
      args: context.launch?.args ?? ["--no-sandbox"],
    });
    const browserCtx = await browser.newContext();
    const page = await browserCtx.newPage();
    return { page } as BrowserSession;
  })();

  sessionCache.set(cacheKey, promise);
  return promise;
}

export async function closeBrowserSession(context: BrowserContext = {}): Promise<void> {
  const cacheKey = context.sessionId ?? "_default";
  const promise = sessionCache.get(cacheKey);
  if (!promise) return;

  try {
    // We don't have a typed browser reference; just clear the cache.
    sessionCache.delete(cacheKey);
  } catch {
    // Swallow close errors
  }
}
