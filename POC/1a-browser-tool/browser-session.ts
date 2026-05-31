import { type Browser, type Page, chromium } from "playwright";

/**
 * Holds a single shared headless Chromium browser + page for a tool session.
 *
 * In the real codebase this would be keyed off the agent/sandbox session
 * (mirroring how `getSandbox(experimental_context, ...)` resolves a per-session
 * sandbox in `packages/agent/tools/utils.ts`). For the POC we keep a process
 * singleton so the navigate/click/type/screenshot/extract tools all share one
 * live page, which is what makes a multi-step browser run coherent.
 */
export type BrowserSession = {
  browser: Browser;
  page: Page;
  /** Wall-clock ms from launch() call to a usable page. */
  coldStartMs: number;
};

let sessionPromise: Promise<BrowserSession> | null = null;

export type LaunchOptions = {
  headless?: boolean;
  /** Extra args; in a microVM you typically need --no-sandbox. */
  args?: string[];
};

export async function getBrowserSession(
  options: LaunchOptions = {},
): Promise<BrowserSession> {
  if (sessionPromise) {
    return sessionPromise;
  }

  sessionPromise = (async () => {
    const startedAt = performance.now();
    const browser = await chromium.launch({
      headless: options.headless ?? true,
      args: options.args ?? [],
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    const coldStartMs = performance.now() - startedAt;
    return { browser, page, coldStartMs };
  })();

  return sessionPromise;
}

export async function closeBrowserSession(): Promise<void> {
  if (!sessionPromise) {
    return;
  }
  const { browser } = await sessionPromise;
  await browser.close();
  sessionPromise = null;
}
