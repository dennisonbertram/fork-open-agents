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
    goto: (
      url: string,
      opts?: { waitUntil?: string },
    ) => Promise<{ status: () => number } | null>;
    url: () => string;
    title: () => Promise<string>;
    click: (selector: string, opts?: { timeout?: number }) => Promise<void>;
    fill: (selector: string, text: string) => Promise<void>;
    press: (selector: string, key: string) => Promise<void>;
    inputValue: (selector: string) => Promise<string | null>;
    locator: (selector: string) => {
      first: () => {
        textContent: () => Promise<string | null>;
        screenshot: () => Promise<Buffer>;
      };
    };
    getAttribute: (
      selector: string,
      attribute: string,
    ) => Promise<string | null>;
    screenshot: (opts?: { fullPage?: boolean }) => Promise<Buffer>;
  };
};

// Internal cache entry holds both the promise and the live handles so
// closeBrowserSession can actually close the Chromium process and context.
export type BrowserSessionCacheEntry = {
  promise: Promise<BrowserSession>;
  // Resolved handles — populated once the launch promise resolves.
  browser?: { close: () => Promise<void> };
};

// Process-level cache keyed by session id (or a shared "_default" key).
export const browserSessionCache = new Map<string, BrowserSessionCacheEntry>();

/**
 * Close the browser for the given session and remove it from the cache.
 *
 * Calling this after a workflow finishes prevents Chromium processes from
 * leaking across runs. Swallows close errors (best-effort cleanup).
 */
export async function closeBrowserSession(
  context: BrowserContext = {},
): Promise<void> {
  const cacheKey = context.sessionId ?? "_default";
  const entry = browserSessionCache.get(cacheKey);
  if (!entry) return;

  // SHOULD-6: Compare-and-delete guard — only evict THIS entry from the cache.
  // A concurrent getBrowserSession call may have already replaced this entry
  // with a new one under the same key; deleting unconditionally would evict
  // the new entry, causing the next call to re-launch unnecessarily.
  if (browserSessionCache.get(cacheKey) === entry) {
    browserSessionCache.delete(cacheKey);
  }

  try {
    // Wait for the session to be ready (or already rejected) before closing.
    await entry.promise;
    if (entry.browser) {
      await entry.browser.close();
    }
  } catch {
    // Swallow — either the session never launched (failed entry) or close errored.
  }
}
