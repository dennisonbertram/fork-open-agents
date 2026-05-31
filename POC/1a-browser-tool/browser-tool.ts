import { tool } from "ai";
import { z } from "zod";
import { getBrowserSession, type LaunchOptions } from "./browser-session";
import {
  buildScreenshotPart,
  buildScreenshotStreamChunk,
  type ScreenshotImagePart,
} from "./image-part";

/**
 * POC 1a — a real Playwright/CDP-driven browser toolset that could become
 * `packages/agent/tools/browser.ts`.
 *
 * Conventions mirrored from the real repo tools (`packages/agent/tools/read.ts`,
 * `bash.ts`): each tool is a factory returning `tool({ description,
 * inputSchema (zod), execute })`, `execute` reads runtime state from
 * `experimental_context`, and every result is a discriminated `{ success }`
 * object so the model can reason about failures instead of throwing.
 *
 * The runtime context here carries an optional UI message stream `writer`
 * (the `UIMessageStreamWriter` from `createUIMessageStream`) so the screenshot
 * tool can stream an image part into chat the instant it is captured, in
 * addition to returning a structured result.
 */

export type BrowserToolContext = {
  launch?: LaunchOptions;
  /**
   * Optional AI SDK UI message stream writer. When present, the screenshot
   * tool writes a file chunk so the image renders live. Typed loosely to avoid
   * coupling the POC to a concrete writer instance.
   */
  writer?: { write: (chunk: { type: "file"; url: string; mediaType: string }) => void };
};

function getContext(experimental_context: unknown): BrowserToolContext {
  return (experimental_context as BrowserToolContext) ?? {};
}

// --- browser_navigate -------------------------------------------------------

const navigateInput = z.object({
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
- The browser session persists across tool calls, so subsequent click/type/extract/screenshot operate on this page.`,
    inputSchema: navigateInput,
    execute: async ({ url, waitUntil = "load" }, { experimental_context }) => {
      try {
        const { page } = await getBrowserSession(getContext(experimental_context).launch);
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

// --- browser_click ----------------------------------------------------------

const clickInput = z.object({
  selector: z
    .string()
    .describe(
      "CSS selector or Playwright text selector (e.g., 'a#more', \"text=Sign in\").",
    ),
  timeoutMs: z.number().optional().describe("Max wait for the element. Default: 5000"),
});

export const browserClickTool = () =>
  tool({
    description: `Click an element in the current page by selector.

USAGE:
- Accepts CSS selectors and Playwright text= selectors.
- Auto-waits for the element to be actionable.`,
    inputSchema: clickInput,
    execute: async ({ selector, timeoutMs = 5000 }, { experimental_context }) => {
      try {
        const { page } = await getBrowserSession(getContext(experimental_context).launch);
        await page.click(selector, { timeout: timeoutMs });
        return { success: true, selector, url: page.url(), title: await page.title() };
      } catch (error) {
        return { success: false, selector, error: messageOf(error) };
      }
    },
  });

// --- browser_type -----------------------------------------------------------

const typeInput = z.object({
  selector: z.string().describe("CSS selector for the input/textarea to type into."),
  text: z.string().describe("Text to type into the element."),
  submit: z
    .boolean()
    .optional()
    .describe("Press Enter after typing to submit. Default: false"),
});

export const browserTypeTool = () =>
  tool({
    description: `Type text into an input element.

USAGE:
- Fills the element value, then optionally presses Enter to submit.`,
    inputSchema: typeInput,
    execute: async ({ selector, text, submit = false }, { experimental_context }) => {
      try {
        const { page } = await getBrowserSession(getContext(experimental_context).launch);
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

// --- browser_extract --------------------------------------------------------

const extractInput = z.object({
  selector: z
    .string()
    .optional()
    .describe("CSS selector to extract text from. Omit to extract the whole body."),
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
- Provide selector for a specific element; provide attribute to read e.g. href.`,
    inputSchema: extractInput,
    execute: async ({ selector, attribute }, { experimental_context }) => {
      try {
        const { page } = await getBrowserSession(getContext(experimental_context).launch);
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

// --- browser_screenshot -----------------------------------------------------

const screenshotInput = z.object({
  fullPage: z.boolean().optional().describe("Capture the full scrollable page. Default: false"),
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
      /** The persisted FileUIPart appended to the assistant UIMessage. */
      imagePart: ScreenshotImagePart;
      streamed: boolean;
    }
  | { success: false; error: string };

export const browserScreenshotTool = () =>
  tool({
    description: `Capture a PNG screenshot of the current page and stream it into chat as an image.

USAGE:
- Returns an AI SDK file/image part (Data URL) so the screenshot renders inline.
- Use fullPage for the entire page, or selector for a single element.`,
    inputSchema: screenshotInput,
    execute: async (
      { fullPage = false, selector },
      { experimental_context },
    ): Promise<ScreenshotToolResult> => {
      try {
        const ctx = getContext(experimental_context);
        const { page } = await getBrowserSession(ctx.launch);
        const mediaType = "image/png";
        const bytes = selector
          ? await page.locator(selector).first().screenshot()
          : await page.screenshot({ fullPage });

        // Stream the image part live if a writer is wired in.
        let streamed = false;
        if (ctx.writer) {
          ctx.writer.write(buildScreenshotStreamChunk({ bytes, mediaType }));
          streamed = true;
        }

        const imagePart = buildScreenshotPart({
          bytes,
          mediaType,
          filename: "screenshot.png",
        });

        return {
          success: true,
          mediaType,
          byteLength: bytes.byteLength,
          imagePart,
          streamed,
        };
      } catch (error) {
        return { success: false, error: messageOf(error) };
      }
    },
  });

// --- registration helper (mirrors packages/agent/tools/index.ts) ------------

export const browserTools = () => ({
  browser_navigate: browserNavigateTool(),
  browser_click: browserClickTool(),
  browser_type: browserTypeTool(),
  browser_extract: browserExtractTool(),
  browser_screenshot: browserScreenshotTool(),
});

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
