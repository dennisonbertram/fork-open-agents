/**
 * Real per-session Playwright browser launcher.
 *
 * Provides a thin, injectable seam: `getBrowserSession(context)` is what the
 * browser tools call. Tests inject a fake page via mock.module("./browser-session").
 *
 * In production the real Playwright launch is behind a dynamic `import("playwright")`
 * so typecheck and unit tests (which mock this module) never require the Chromium binary.
 *
 * Session caching: one browser+page per sessionId (or a shared "_default" key when
 * no session id is provided), so navigate/click/type/extract/screenshot all share
 * one live page coherently within the same chat turn.
 *
 * Sandbox isolation:
 * - By default, Chromium runs with the sandbox ENABLED (no --no-sandbox).
 *   Sandbox-disabled mode is opt-in via the OPEN_AGENTS_BROWSER_NO_SANDBOX=1 env var,
 *   or the injectable `launch.args` override for tests and constrained environments.
 * - Do NOT hardcode --no-sandbox as a default — it disables the OS-level sandbox
 *   that prevents compromised renderer processes from escaping to the host, which
 *   matters especially when browsing arbitrary model-directed URLs.
 */

import {
  browserSessionCache,
  closeBrowserSession,
  type BrowserContext,
  type BrowserSession,
  type BrowserSessionCacheEntry,
} from "./browser-session-cache";

export { closeBrowserSession };
export type { BrowserContext, BrowserSession };

/**
 * Get or create a browser session for the given context.
 *
 * The real Playwright is imported dynamically so this module can be imported
 * without Chromium available (tests mock this module entirely).
 *
 * On launch failure, the cache entry is evicted so the next call re-attempts
 * rather than returning a sticky rejected promise.
 */
export async function getBrowserSession(
  context: BrowserContext = {},
): Promise<BrowserSession> {
  const cacheKey = context.sessionId ?? "_default";

  const existing = browserSessionCache.get(cacheKey);
  if (existing) {
    return existing.promise;
  }

  // Declare the entry separately so the async IIFE can close over it and
  // store the browser handle (needed by closeBrowserSession to actually close).
  // TypeScript requires the definite assignment assertion (!) because the async
  // IIFE closes over `entry` before the outer assignment completes.
  let entry!: BrowserSessionCacheEntry;

  const launchPromise = (async () => {
    // Dynamic import keeps real Playwright out of the module graph until needed.
    const playwright = await import("playwright");

    // Sandbox policy:
    //   Default: sandbox ENABLED — omit --no-sandbox.
    //   Opt-out: set OPEN_AGENTS_BROWSER_NO_SANDBOX=1 for environments that
    //   require it (e.g. rootless containers without user namespaces).
    //   Injectable override: context.launch?.args fully replaces the default.
    const defaultArgs: string[] =
      process.env["OPEN_AGENTS_BROWSER_NO_SANDBOX"] === "1"
        ? ["--no-sandbox"]
        : [];

    const browser = await playwright.chromium.launch({
      headless: context.launch?.headless ?? true,
      args: context.launch?.args ?? defaultArgs,
    });

    // Store the browser handle for closeBrowserSession to use.
    // entry is guaranteed to be assigned by the time this line runs because
    // the async IIFE cannot reach this point until after the outer
    // `entry = { promise: launchPromise, ... }` assignment below completes
    // (awaiting playwright.chromium.launch is an async boundary that yields
    // control back to the caller, who assigns entry before resuming).
    entry.browser = browser;

    const browserCtx = await browser.newContext();
    const page = await browserCtx.newPage();
    return { page } as BrowserSession;
  })().catch((err: unknown) => {
    // SHOULD-6: Compare-and-delete guard — only evict THIS entry, not a newer
    // one that may have been created under the same key after this launch failed.
    if (browserSessionCache.get(cacheKey) === entry) {
      browserSessionCache.delete(cacheKey);
    }
    // Best-effort close of browser handle if it was partially allocated before
    // newContext/newPage failed (prevents Chromium zombie processes).
    if (entry.browser) {
      entry.browser.close().catch(() => undefined);
    }
    throw err;
  });

  entry = { promise: launchPromise };
  browserSessionCache.set(cacheKey, entry);
  return entry.promise;
}
