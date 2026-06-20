/**
 * Headless browser toolset — five AI-SDK tools for browser automation.
 *
 * Tools:
 *  - browserNavigateTool: navigate to a URL
 *  - browserClickTool: click an element by selector
 *  - browserTypeTool: type text into an input element
 *  - browserExtractTool: extract text or an attribute from the page
 *  - browserScreenshotTool: capture a PNG screenshot, stream inline to chat
 *
 * Each tool:
 *  - Follows the repo convention: factory function returning tool({ description, inputSchema, execute, needsApproval })
 *  - Uses execute(args, { experimental_context }) — reads browser session from an injectable resolver
 *  - Returns discriminated { success: true, ... } / { success: false, error: {kind, message} } — never throws
 *  - Routes needsApproval through classifyToolApproval (approval-policy.ts) — browser tools are outward-facing → requires approval
 *
 * The writer contract for screenshots:
 *  - If context.writer is present, tool calls writer.write({ type: "file", url: "data:image/png;base64,...", mediaType: "image/png" })
 *  - This renders inline in the chat renderer (shared-chat-content.tsx:466)
 *
 * Browser event observability (SHOULD-4):
 *  - If context.browserEventRecorder is present, best-effort events are emitted
 *    for navigate, click, type, extract, screenshot, and failure actions.
 *  - A throwing recorder NEVER crashes the tool — all recorder calls are wrapped
 *    in try/catch that swallows errors silently.
 *  - Default: no-op when browserEventRecorder is absent.
 *
 * Playwright is lazily loaded via browser-session.ts (dynamic import) so this
 * module typechecks and unit tests can mock the session without Chromium.
 */

import { tool } from "ai";
import { z } from "zod";
import { classifyToolApproval } from "./approval-policy";
import { buildScreenshotStreamChunk } from "./browser-image-part";
import { getBrowserSession } from "./browser-session";
import {
  capBrowserText,
  redactBrowserText,
  SCREENSHOT_BYTE_CAP,
} from "./redact";

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

/**
 * Injectable event recorder for structured browser.* events.
 * Must be best-effort: a throwing recorder must NOT crash the tool.
 */
type BrowserEventRecorder = {
  record: (eventName: string, payload: unknown) => void;
};

type BrowserToolContext = {
  writer?: {
    // Returns Promise<void> | void — always awaited inside the tool so a
    // rejection is caught and does NOT escape as an unhandled rejection.
    write: (chunk: {
      type: "file";
      url: string;
      mediaType: string;
    }) => Promise<void> | void;
  };
  sessionId?: string;
  /** Optional injectable event recorder (SHOULD-4). Defaults to no-op. */
  browserEventRecorder?: BrowserEventRecorder;
};

function getBrowserContext(experimental_context: unknown): BrowserToolContext {
  if (
    experimental_context !== null &&
    typeof experimental_context === "object"
  ) {
    return experimental_context as BrowserToolContext;
  }
  return {};
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Best-effort event emission. Wraps recorder.record() in try/catch so a
 * throwing recorder can NEVER crash the agent turn. Same defensive pattern
 * as the goal-ledger/artifact recorders in managed-runtime.
 */
function emitBrowserEvent(
  recorder: BrowserEventRecorder | undefined,
  eventName: string,
  payload: Record<string, unknown>,
): void {
  if (!recorder) return;
  try {
    recorder.record(eventName, payload);
  } catch {
    // Best-effort: swallow all recorder errors silently.
  }
}

// ---------------------------------------------------------------------------
// Typed error shape (SHOULD-5)
// ---------------------------------------------------------------------------

type BrowserErrorKind =
  | "navigation_timeout"
  | "selector_not_found"
  | "fill_failed"
  | "extract_failed"
  | "screenshot_failed"
  | "browser_launch_failed";

type BrowserError = {
  kind: BrowserErrorKind;
  message: string;
};

function classifyBrowserError(
  toolName:
    | "navigate"
    | "click"
    | "type"
    | "extract"
    | "screenshot"
    | "session",
  error: unknown,
): BrowserError {
  const message = messageOf(error);
  const lowerMsg = message.toLowerCase();

  if (toolName === "navigate") {
    return { kind: "navigation_timeout", message };
  }
  if (toolName === "click") {
    if (
      lowerMsg.includes("timeout") ||
      lowerMsg.includes("selector") ||
      lowerMsg.includes("waiting")
    ) {
      return { kind: "selector_not_found", message };
    }
    return { kind: "selector_not_found", message };
  }
  if (toolName === "type") {
    return { kind: "fill_failed", message };
  }
  if (toolName === "extract") {
    return { kind: "extract_failed", message };
  }
  if (toolName === "screenshot") {
    return { kind: "screenshot_failed", message };
  }
  return { kind: "browser_launch_failed", message };
}

// ---------------------------------------------------------------------------
// browser_navigate
// ---------------------------------------------------------------------------

const navigateInputSchema = z.object({
  url: z
    .string()
    .describe("Absolute URL to navigate to (e.g., https://example.com)"),
  waitUntil: z
    .enum(["load", "domcontentloaded", "networkidle", "commit"])
    .optional()
    .describe("Playwright load state to wait for. Default: load"),
});

export const browserNavigateTool = () =>
  tool({
    description: `Navigate the headless browser to a URL.

USAGE:
- Provide an absolute URL.
- The browser session persists across tool calls so subsequent click/type/extract/screenshot operate on this page.`,
    inputSchema: navigateInputSchema,
    needsApproval: (_args: z.infer<typeof navigateInputSchema>) => {
      return classifyToolApproval("browser_navigate", _args).requires;
    },
    execute: async ({ url, waitUntil = "load" }, { experimental_context }) => {
      const ctx = getBrowserContext(experimental_context);
      const recorder = ctx.browserEventRecorder;
      try {
        const { page } = await getBrowserSession({ sessionId: ctx.sessionId });
        const response = await page.goto(url, { waitUntil });
        const finalUrl = page.url();
        emitBrowserEvent(recorder, "browser.navigate", {
          url: finalUrl,
          status: response?.status() ?? null,
        });
        return {
          success: true,
          url: finalUrl,
          status: response?.status() ?? null,
          title: await page.title(),
        };
      } catch (error) {
        const browserError = classifyBrowserError("navigate", error);
        emitBrowserEvent(recorder, "browser.action.failed", {
          action: "navigate",
          kind: browserError.kind,
        });
        return { success: false, error: browserError };
      }
    },
  });

// ---------------------------------------------------------------------------
// browser_click
// ---------------------------------------------------------------------------

const clickInputSchema = z.object({
  selector: z
    .string()
    .describe(
      "CSS selector or Playwright text selector (e.g., 'button#id', 'text=Sign in').",
    ),
  timeoutMs: z
    .number()
    .optional()
    .describe("Max wait for the element in ms. Default: 5000"),
});

export const browserClickTool = () =>
  tool({
    description: `Click an element in the current page by selector.

USAGE:
- Accepts CSS selectors and Playwright text= selectors.
- Auto-waits for the element to be actionable.`,
    inputSchema: clickInputSchema,
    needsApproval: (_args: z.infer<typeof clickInputSchema>) => {
      return classifyToolApproval("browser_click", _args).requires;
    },
    execute: async (
      { selector, timeoutMs = 5000 },
      { experimental_context },
    ) => {
      const ctx = getBrowserContext(experimental_context);
      const recorder = ctx.browserEventRecorder;
      try {
        const { page } = await getBrowserSession({ sessionId: ctx.sessionId });
        await page.click(selector, { timeout: timeoutMs });
        emitBrowserEvent(recorder, "browser.action.performed", {
          action: "click",
          selector,
        });
        return {
          success: true,
          selector,
          url: page.url(),
          title: await page.title(),
        };
      } catch (error) {
        const browserError = classifyBrowserError("click", error);
        emitBrowserEvent(recorder, "browser.action.failed", {
          action: "click",
          selector,
          kind: browserError.kind,
        });
        return { success: false, selector, error: browserError };
      }
    },
  });

// ---------------------------------------------------------------------------
// browser_type
// ---------------------------------------------------------------------------

const typeInputSchema = z.object({
  selector: z
    .string()
    .describe("CSS selector for the input/textarea to type into."),
  text: z.string().describe("Text to type into the element."),
  submit: z
    .boolean()
    .optional()
    .describe("Press Enter after typing to submit. Default: false"),
});

export const browserTypeTool = () =>
  tool({
    description: `Type text into an input element on the current page.

USAGE:
- Fills the element value, then optionally presses Enter to submit.`,
    inputSchema: typeInputSchema,
    needsApproval: (_args: z.infer<typeof typeInputSchema>) => {
      return classifyToolApproval("browser_type", _args).requires;
    },
    execute: async (
      { selector, text, submit = false },
      { experimental_context },
    ) => {
      const ctx = getBrowserContext(experimental_context);
      const recorder = ctx.browserEventRecorder;
      try {
        const { page } = await getBrowserSession({ sessionId: ctx.sessionId });
        await page.fill(selector, text);
        if (submit) {
          await page.press(selector, "Enter");
        }
        const value = await page.inputValue(selector).catch(() => null);
        emitBrowserEvent(recorder, "browser.action.performed", {
          action: "type",
          selector,
          submitted: submit,
        });
        return { success: true, selector, value, submitted: submit };
      } catch (error) {
        const browserError = classifyBrowserError("type", error);
        emitBrowserEvent(recorder, "browser.action.failed", {
          action: "type",
          selector,
          kind: browserError.kind,
        });
        return { success: false, selector, error: browserError };
      }
    },
  });

// ---------------------------------------------------------------------------
// browser_extract
// ---------------------------------------------------------------------------

const extractInputSchema = z.object({
  selector: z
    .string()
    .optional()
    .describe(
      "CSS selector to extract text from. Omit to extract the full body.",
    ),
  attribute: z
    .string()
    .optional()
    .describe("If set, return this attribute value instead of text content."),
});

export const browserExtractTool = () =>
  tool({
    description: `Extract text (or an attribute) from the current page.

USAGE:
- Omit selector to read the full document body text.
- Provide selector to target a specific element; provide attribute to read e.g. href.`,
    inputSchema: extractInputSchema,
    needsApproval: (_args: z.infer<typeof extractInputSchema>) => {
      return classifyToolApproval("browser_extract", _args).requires;
    },
    execute: async ({ selector, attribute }, { experimental_context }) => {
      const ctx = getBrowserContext(experimental_context);
      const recorder = ctx.browserEventRecorder;
      try {
        const { page } = await getBrowserSession({ sessionId: ctx.sessionId });
        const target = selector ?? "body";
        if (attribute) {
          const rawValue = await page.getAttribute(target, attribute);
          // MUST-2: Apply the same redact+cap pipeline to attribute values.
          // href/src/action attributes can carry credentialed URLs and ?token= secrets.
          const value =
            typeof rawValue === "string"
              ? capBrowserText(redactBrowserText(rawValue))
              : rawValue;
          emitBrowserEvent(recorder, "browser.action.performed", {
            action: "extract",
            selector: target,
            attribute,
          });
          return { success: true, selector: target, attribute, value };
        }
        const rawText = await page.locator(target).first().textContent();
        // Redact credentials and cap length to guard against secret leakage
        // and oversized dumps from full-page body extractions.
        const trimmed = (rawText ?? "").trim();
        const redacted = redactBrowserText(trimmed);
        const capped = capBrowserText(redacted);
        emitBrowserEvent(recorder, "browser.action.performed", {
          action: "extract",
          selector: target,
          byteLength: capped.length,
        });
        return {
          success: true,
          selector: target,
          text: capped,
        };
      } catch (error) {
        const browserError = classifyBrowserError("extract", error);
        emitBrowserEvent(recorder, "browser.action.failed", {
          action: "extract",
          kind: browserError.kind,
        });
        return { success: false, error: browserError };
      }
    },
  });

// ---------------------------------------------------------------------------
// browser_screenshot
// ---------------------------------------------------------------------------

const screenshotInputSchema = z.object({
  fullPage: z
    .boolean()
    .optional()
    .describe("Capture the full scrollable page. Default: false"),
  selector: z
    .string()
    .optional()
    .describe("If set, screenshot only this element instead of the viewport."),
});

export type ScreenshotToolResult =
  | {
      success: true;
      mediaType: string;
      byteLength: number;
      streamed: boolean;
    }
  | { success: false; error: BrowserError };

export const browserScreenshotTool = () =>
  tool({
    description: `Capture a PNG screenshot of the current page and stream it inline to chat.

USAGE:
- Returns an AI SDK file part (Data URL) so the screenshot renders inline.
- Use fullPage for the entire page, or selector for a specific element.`,
    inputSchema: screenshotInputSchema,
    needsApproval: (_args: z.infer<typeof screenshotInputSchema>) => {
      return classifyToolApproval("browser_screenshot", _args).requires;
    },
    execute: async (
      { fullPage = false, selector },
      { experimental_context },
    ): Promise<ScreenshotToolResult> => {
      const ctx = getBrowserContext(experimental_context);
      const recorder = ctx.browserEventRecorder;
      try {
        const { page } = await getBrowserSession({ sessionId: ctx.sessionId });
        const mediaType = "image/png";

        const bytes = selector
          ? await page.locator(selector).first().screenshot()
          : await page.screenshot({ fullPage });

        let streamed = false;
        if (ctx.writer) {
          // Enforce a byte cap — do not stream screenshots that are too large.
          // Oversized screenshots are not written to logs and not streamed inline;
          // the tool still returns success:true with streamed:false and the byteLength
          // so the model knows the capture succeeded but streaming was skipped.
          if (bytes.byteLength <= SCREENSHOT_BYTE_CAP) {
            try {
              // Always await — writer.write may be async (e.g. WHATWG WritableStream
              // injected by chat.ts). Unawaited async writes escape the try/catch
              // and produce floating unhandled rejections.
              await ctx.writer.write(
                buildScreenshotStreamChunk({ bytes, mediaType }),
              );
              streamed = true;
            } catch {
              // Writer failure (e.g. stream already locked) must NOT propagate.
              // streamed stays false; the tool returns success:true, streamed:false.
            }
          }
        }

        emitBrowserEvent(recorder, "browser.screenshot.captured", {
          byteLength: bytes.byteLength,
          streamed,
          withinCap: bytes.byteLength <= SCREENSHOT_BYTE_CAP,
        });

        return {
          success: true,
          mediaType,
          byteLength: bytes.byteLength,
          streamed,
        };
      } catch (error) {
        const browserError = classifyBrowserError("screenshot", error);
        emitBrowserEvent(recorder, "browser.action.failed", {
          action: "screenshot",
          kind: browserError.kind,
        });
        return { success: false, error: browserError };
      }
    },
  });
