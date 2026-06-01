/**
 * MUST-2: Tests for browser_extract attribute branch redaction + URL-credential pattern.
 *
 * Bug A: The attribute branch in browser_extract returns raw getAttribute value with
 *        NO redact/cap. href/src/action values carry credentialed URLs + ?token= secrets.
 *
 * Bug B: redactBrowserText is missing whole-URL credential stripping that
 *        apps/web/lib/harness/redaction.ts does. Port it: for URL-shaped substrings,
 *        strip username:password@ userinfo and ?query/#hash (or redact secret-bearing
 *        query params).
 *
 * Fix A: run capBrowserText(redactBrowserText(value)) on string attribute values too.
 * Fix B: add URL-credential stripping to redactBrowserText.
 */

import { describe, expect, mock, test } from "bun:test";

// ---------------------------------------------------------------------------
// Module-level mocks — must precede all await-imports
// ---------------------------------------------------------------------------

mock.module("ai", () => ({
  tool: <T extends Record<string, unknown>>(definition: T) => definition,
}));

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: async () => ({}),
  tryConnectVercelSandboxDirect: async () => null,
}));

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function executionOptions(experimental_context?: unknown) {
  return {
    toolCallId: "tc-must2",
    messages: [],
    experimental_context,
  };
}

function makeContext() {
  return {
    sandbox: {
      state: { type: "vercel" as const, sandboxId: "sb-1" },
      workingDirectory: "/repo",
    },
    model: "test-model",
  };
}

// ---------------------------------------------------------------------------
// Tests for redactBrowserText URL-credential stripping (Bug B)
// ---------------------------------------------------------------------------

const { redactBrowserText } = await import("./redact");

describe("MUST-2 redact: URL credential stripping", () => {
  test("MUST-2a: redactBrowserText strips userinfo (user:pass@) from URL-shaped substrings", () => {
    const input = "Callback: https://user:supersecret@host.example.com/cb";
    const result = redactBrowserText(input);
    expect(result).not.toContain("supersecret");
    expect(result).not.toContain("user:supersecret@");
  });

  test("MUST-2b: redactBrowserText strips ?token= query param from URL-shaped substrings", () => {
    const input = "Link: https://host.example.com/path?token=supersecret12345";
    const result = redactBrowserText(input);
    expect(result).not.toContain("supersecret12345");
  });

  test("MUST-2c: redactBrowserText strips ?api_key= query param from URL-shaped substrings", () => {
    const input = "href=https://api.example.com/data?api_key=mySecretApiKey999";
    const result = redactBrowserText(input);
    expect(result).not.toContain("mySecretApiKey999");
  });

  test("MUST-2d: redactBrowserText handles combined userinfo + query secrets", () => {
    const credUrl =
      "https://user:pass@host.example.com/cb?token=supersecret12345";
    const result = redactBrowserText(credUrl);
    expect(result).not.toContain("pass");
    expect(result).not.toContain("supersecret12345");
  });

  test("MUST-2e: redactBrowserText preserves safe plain URLs (no userinfo/secret query)", () => {
    const safeUrl = "https://example.com/page";
    const result = redactBrowserText(safeUrl);
    // Safe URL should be preserved as-is (no mutation of non-secret content)
    expect(result).toContain("https://example.com/page");
  });

  test("MUST-2f: redactBrowserText leaves non-URL text untouched", () => {
    const safe = "Hello world, no secrets here.";
    expect(redactBrowserText(safe)).toBe(safe);
  });
});

// ---------------------------------------------------------------------------
// Tests for browser_extract attribute branch (Bug A)
// ---------------------------------------------------------------------------

describe("MUST-2 browser_extract attribute redaction", () => {
  test("MUST-2g: attribute href with credentialed URL has userinfo redacted in result", async () => {
    const credUrl =
      "https://user:pass@host.example.com/cb?token=supersecret12345";

    mock.module("./browser-session", () => ({
      getBrowserSession: async () => ({
        page: {
          getAttribute: async (_selector: string, _attr: string) => credUrl,
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

    const { browserExtractTool } = await import("./browser");
    const result = await browserExtractTool().execute?.(
      { selector: "a#link", attribute: "href" },
      executionOptions(makeContext()),
    );

    expect(result).toBeDefined();
    if (!result || !("success" in result) || !result.success) {
      throw new Error("Expected success result, got: " + JSON.stringify(result));
    }
    const value = (result as { value: string | null }).value;
    if (value === null) {
      throw new Error("Expected non-null attribute value");
    }
    // password and token must not appear in the returned value
    expect(value).not.toContain("pass");
    expect(value).not.toContain("supersecret12345");
  });

  test("MUST-2h: attribute src with ?token= secret is redacted in result", async () => {
    const srcUrl = "https://cdn.example.com/image.png?token=s3cr3t_tok3n_xyz";

    mock.module("./browser-session", () => ({
      getBrowserSession: async () => ({
        page: {
          getAttribute: async () => srcUrl,
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

    const { browserExtractTool: et2 } = await import("./browser");
    const result = await et2().execute?.(
      { selector: "img", attribute: "src" },
      executionOptions(makeContext()),
    );

    if (!result || !("success" in result) || !result.success) {
      throw new Error("Expected success result");
    }
    const value = (result as { value: string | null }).value;
    expect(value).not.toContain("s3cr3t_tok3n_xyz");
  });

  test("MUST-2i: null attribute value is returned as-is (no crash on null)", async () => {
    mock.module("./browser-session", () => ({
      getBrowserSession: async () => ({
        page: {
          getAttribute: async () => null,
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

    const { browserExtractTool: et3 } = await import("./browser");
    const result = await et3().execute?.(
      { selector: "a", attribute: "href" },
      executionOptions(makeContext()),
    );

    expect(result).toMatchObject({ success: true, value: null });
  });
});
