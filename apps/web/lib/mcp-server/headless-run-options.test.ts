import { describe, expect, test } from "bun:test";

// Contract for the not-yet-written headless-run-options module (#1230): it
// owns the agent-call options every MCP write tool must pass through
// `startChatRun` so the run it launches cannot stall waiting on a human that
// isn't there.
const moduleUnderTestPromise = import("./headless-run-options");

describe("HEADLESS_ALLOWED_BUILTIN_TOOL_NAMES", () => {
  test("excludes ask_user_question — a client-side tool no MCP caller can ever answer", async () => {
    const { HEADLESS_ALLOWED_BUILTIN_TOOL_NAMES } =
      await moduleUnderTestPromise;

    expect(HEADLESS_ALLOWED_BUILTIN_TOOL_NAMES).not.toContain(
      "ask_user_question",
    );
  });

  test("still includes ordinary work tools, so a headless run is not crippled", async () => {
    const { HEADLESS_ALLOWED_BUILTIN_TOOL_NAMES } =
      await moduleUnderTestPromise;

    // If the allowlist accidentally dropped these, a headless run could not
    // write code, run commands, or read files — every real task would fail.
    expect(HEADLESS_ALLOWED_BUILTIN_TOOL_NAMES).toContain("bash");
    expect(HEADLESS_ALLOWED_BUILTIN_TOOL_NAMES).toContain("read");
    expect(HEADLESS_ALLOWED_BUILTIN_TOOL_NAMES).toContain("edit");
  });
});

describe("HEADLESS_CUSTOM_INSTRUCTIONS", () => {
  test("tells the agent no human will answer questions and to write down a blocker", async () => {
    const { HEADLESS_CUSTOM_INSTRUCTIONS } = await moduleUnderTestPromise;

    expect(HEADLESS_CUSTOM_INSTRUCTIONS.toLowerCase()).toContain("no human");
    expect(HEADLESS_CUSTOM_INSTRUCTIONS.toLowerCase()).toContain("blocked");
  });
});

describe("buildHeadlessAgentOptions", () => {
  test("returns unattended:true and the ask_user_question-excluding allowlist", async () => {
    const { buildHeadlessAgentOptions, HEADLESS_ALLOWED_BUILTIN_TOOL_NAMES } =
      await moduleUnderTestPromise;

    const options = buildHeadlessAgentOptions();

    expect(options.unattended).toBe(true);
    expect(options.allowedBuiltinToolNames).toEqual([
      ...HEADLESS_ALLOWED_BUILTIN_TOOL_NAMES,
    ]);
    expect(options.allowedBuiltinToolNames).not.toContain(
      "ask_user_question",
    );
    expect(typeof options.customInstructions).toBe("string");
    expect((options.customInstructions as string).length).toBeGreaterThan(0);
  });
});
