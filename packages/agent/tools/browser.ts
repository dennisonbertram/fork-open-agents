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
 *  - Returns discriminated { success: true, ... } / { success: false, error } — never throws
 *  - Routes needsApproval through classifyToolApproval (approval-policy.ts) — browser tools are outward-facing → requires approval
 *
 * The writer contract for screenshots:
 *  - If context.writer is present, tool calls writer.write({ type: "file", url: "data:image/png;base64,...", mediaType: "image/png" })
 *  - This renders inline in the chat renderer (shared-chat-content.tsx:466)
 *
 * Playwright is lazily loaded via browser-session.ts (dynamic import) so this
 * module typechecks and unit tests can mock the session without Chromium.
 */

import { tool } from "ai";
import { z } from "zod";
import { classifyToolApproval } from "./approval-policy";
import { buildScreenshotPart, buildScreenshotStreamChunk } from "./browser-image-part";
import { getBrowserSession } from "./browser-session";

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

type BrowserToolContext = {
  writer?: {
    write: (chunk: { type: "file"; url: string; mediaType: string }) => void;
  };
  sessionId?: string;
};

function getBrowserContext(experimental_context: unknown): BrowserToolContext {
  if (experimental_context !== null && typeof experimental_context === "object") {
    return experimental_context as BrowserToolContext;
  }
  return {};
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// browser_navigate
// ---------------------------------------------------------------------------

const navigateInputSchema = z.object({
  url: z.string().describe("Absolute URL to navigate to (e.g., https://example.com)"),
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
      try {
        const ctx = getBrowserContext(experimental_context);
        const { page } = await getBrowserSession({ sessionId: ctx.sessionId });
        const response = await page.goto(url, { waitUntil });
        return {
          success: true,
          url: page.url(),
          status: response?.status() ?? null,
          title: await page.title(),
        };
      } catch (error) {
        return { success: false, error: messageOf(error) };
      }
    },
  });

// ---------------------------------------------------------------------------
// browser_click
// ---------------------------------------------------------------------------

const clickInputSchema = z.object({
  selector: z
    .string()
    .describe("CSS selector or Playwright text selector (e.g., 'button#id', 'text=Sign in')."),
  timeoutMs: z.number().optional().describe("Max wait for the element in ms. Default: 5000"),
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
    execute: async ({ selector, timeoutMs = 5000 }, { experimental_context }) => {
      try {
        const ctx = getBrowserContext(experimental_context);
        const { page } = await getBrowserSession({ sessionId: ctx.sessionId });
        await page.click(selector, { timeout: timeoutMs });
        return {
          success: true,
          selector,
          url: page.url(),
          title: await page.title(),
        };
      } catch (error) {
        return { success: false, selector, error: messageOf(error) };
      }
    },
  });

// ---------------------------------------------------------------------------
// browser_type
// ---------------------------------------------------------------------------

const typeInputSchema = z.object({
  selector: z.string().describe("CSS selector for the input/textarea to type into."),
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
    execute: async ({ selector, text, submit = false }, { experimental_context }) => {
      try {
        const ctx = getBrowserContext(experimental_context);
        const { page } = await getBrowserSession({ sessionId: ctx.sessionId });
        await page.fill(selector, text);
        if (submit) {
          await page.press(selector, "Enter");
        }
        const value = await page.inputValue(selector).catch(() => null);
        return { success: true, selector, value, submitted: submit };
      } catch (error) {
        return { success: false, selector, error: messageOf(error) };
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
    .describe("CSS selector to extract text from. Omit to extract the full body."),
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
      try {
        const ctx = getBrowserContext(experimental_context);
        const { page } = await getBrowserSession({ sessionId: ctx.sessionId });
        const target = selector ?? "body";
        if (attribute) {
          const value = await page.getAttribute(target, attribute);
          return { success: true, selector: target, attribute, value };
        }
        const text = await page.locator(target).first().innerText();
        return { success: true, selector: target, text: text.trim() };
      } catch (error) {
        return { success: false, error: messageOf(error) };
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
  | { success: false; error: string };

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
      try {
        const ctx = getBrowserContext(experimental_context);
        const { page } = await getBrowserSession({ sessionId: ctx.sessionId });
        const mediaType = "image/png";

        const bytes = selector
          ? await page.locator(selector).first().screenshot()
          : await page.screenshot({ fullPage });

        let streamed = false;
        if (ctx.writer) {
          ctx.writer.write(buildScreenshotStreamChunk({ bytes, mediaType }));
          streamed = true;
        }

        // Build the persisted FileUIPart (not returned in the tool result itself,
        // but the stream chunk carries the data URL for inline rendering).
        buildScreenshotPart({ bytes, mediaType, filename: "screenshot.png" });

        return {
          success: true,
          mediaType,
          byteLength: bytes.byteLength,
          streamed,
        };
      } catch (error) {
        return { success: false, error: messageOf(error) };
      }
    },
  });
