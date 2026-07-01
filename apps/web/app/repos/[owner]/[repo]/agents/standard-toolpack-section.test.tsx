/**
 * Behavior tests for StandardToolpackSection and its pure toggle helper.
 * Uses renderToStaticMarkup (react-dom/server) — no JSDOM needed, matching
 * the established pattern in this directory (see agent-spec-editor.test.tsx,
 * and the deleted github-tool-card.test.tsx).
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  StandardToolpackSection,
  toggleBuiltinToolName,
} from "./standard-toolpack-section";
import {
  DEFAULT_ON_TOOL_NAMES,
  STANDARD_TOOLPACK_ITEMS,
} from "@/lib/background-agents/builtin-toolpack";

describe("toggleBuiltinToolName (pure helper)", () => {
  test("removes a name that is present", () => {
    expect(toggleBuiltinToolName(["bash", "read"], "bash")).toEqual(["read"]);
  });

  test("adds a name that is absent", () => {
    expect(toggleBuiltinToolName(["read"], "bash")).toEqual(["read", "bash"]);
  });

  test("does not mutate the input array", () => {
    const input = ["bash", "read"];
    toggleBuiltinToolName(input, "bash");
    expect(input).toEqual(["bash", "read"]);
  });
});

describe("StandardToolpackSection", () => {
  const noop = () => {};

  test("renders a non-removable 'GitHub (scoped to this repo)' row", () => {
    const html = renderToStaticMarkup(
      <StandardToolpackSection
        enabledToolNames={[...DEFAULT_ON_TOOL_NAMES]}
        onChange={noop}
        outputMode="none"
      />,
    );
    expect(html).toContain("GitHub (scoped to this repo)");
  });

  test("the GitHub row has no toggle/checkbox — total switches equal STANDARD_TOOLPACK_ITEMS count only", () => {
    const html = renderToStaticMarkup(
      <StandardToolpackSection
        enabledToolNames={[...DEFAULT_ON_TOOL_NAMES]}
        onChange={noop}
        outputMode="none"
      />,
    );
    const switchMatches = html.match(/role="switch"/g) ?? [];
    // One switch per STANDARD_TOOLPACK_ITEMS entry (11 built-ins), none for
    // the fixed GitHub row.
    expect(switchMatches.length).toBe(11);
  });

  test("renders a toggle for each STANDARD_TOOLPACK_ITEMS name", () => {
    const html = renderToStaticMarkup(
      <StandardToolpackSection
        enabledToolNames={[...DEFAULT_ON_TOOL_NAMES]}
        onChange={noop}
        outputMode="none"
      />,
    );
    for (const label of [
      "Todo tracking",
      "Read files",
      "Write files",
      "Edit files",
      "Search file contents (grep)",
      "Find files (glob)",
      "Run shell commands",
      "Delegate to subagents",
      "Ask a clarifying question",
      "Load skills",
      "Fetch external URLs",
    ]) {
      expect(html).toContain(label);
    }
  });

  test("write/edit/bash captions clarify sandbox-only scope, distinct from real repo writes", () => {
    // Naive-user finding: "Report only... doesn't change the repo" reads as
    // if write/edit/bash are disabled too, when they're actually on by
    // default and just never get committed anywhere for that output mode.
    // These captions must make that relationship explicit on every render,
    // not just for ready_pr, so a Report-only agent's Tools panel doesn't
    // look like it contradicts the Result section above it.
    const html = renderToStaticMarkup(
      <StandardToolpackSection
        enabledToolNames={[...DEFAULT_ON_TOOL_NAMES]}
        onChange={noop}
        outputMode="none"
      />,
    );
    expect(html).toContain("Only affects this run&#x27;s temporary sandbox");
    const writeIdx = html.indexOf("Write files");
    const editIdx = html.indexOf("Edit files");
    const bashIdx = html.indexOf("Run shell commands");
    const captionCount =
      html.split("Only affects this run&#x27;s temporary sandbox").length - 1;
    expect(captionCount).toBe(3);
    expect(writeIdx).toBeGreaterThan(-1);
    expect(editIdx).toBeGreaterThan(-1);
    expect(bashIdx).toBeGreaterThan(-1);
  });

  test("web_fetch toggle is unchecked when enabledToolNames omits it", () => {
    const html = renderToStaticMarkup(
      <StandardToolpackSection
        enabledToolNames={[...DEFAULT_ON_TOOL_NAMES]}
        onChange={noop}
        outputMode="none"
      />,
    );
    const idx = html.indexOf("Fetch external URLs");
    const switchOpenIdx = html.indexOf('role="switch"', idx);
    const snippet = html.slice(idx, switchOpenIdx + 100);
    expect(snippet).toContain('data-state="unchecked"');
  });

  test("bash toggle is checked when enabledToolNames includes it", () => {
    const html = renderToStaticMarkup(
      <StandardToolpackSection
        enabledToolNames={[...DEFAULT_ON_TOOL_NAMES]}
        onChange={noop}
        outputMode="none"
      />,
    );
    const idx = html.indexOf("Run shell commands");
    const switchOpenIdx = html.indexOf('role="switch"', idx);
    const snippet = html.slice(idx, switchOpenIdx + 100);
    expect(snippet).toContain('data-state="checked"');
  });

  test("GitHub row caption reflects read-only for outputMode 'none'", () => {
    const html = renderToStaticMarkup(
      <StandardToolpackSection
        enabledToolNames={[...DEFAULT_ON_TOOL_NAMES]}
        onChange={noop}
        outputMode="none"
      />,
    );
    const idx = html.indexOf("GitHub (scoped to this repo)");
    const snippet = html.slice(idx, idx + 400);
    expect(snippet.toLowerCase()).toContain("read-only");
  });

  test("GitHub row caption reflects PR-opening capability for outputMode 'ready_pr'", () => {
    const html = renderToStaticMarkup(
      <StandardToolpackSection
        enabledToolNames={[...DEFAULT_ON_TOOL_NAMES]}
        onChange={noop}
        outputMode="ready_pr"
      />,
    );
    const idx = html.indexOf("GitHub (scoped to this repo)");
    const snippet = html.slice(idx, idx + 400);
    expect(snippet.toLowerCase()).toContain("pull request");
  });

  test("disabled prop renders switch buttons with the disabled attribute", () => {
    const html = renderToStaticMarkup(
      <StandardToolpackSection
        enabledToolNames={[...DEFAULT_ON_TOOL_NAMES]}
        onChange={noop}
        outputMode="none"
        disabled
      />,
    );
    // Extract just the opening <button role="switch" ...> tag for the bash
    // row and confirm it carries the disabled attribute.
    const idx = html.indexOf("Run shell commands");
    const buttonOpenIdx = html.indexOf("<button", idx);
    const buttonCloseIdx = html.indexOf(">", buttonOpenIdx);
    const tag = html.slice(buttonOpenIdx, buttonCloseIdx);
    expect(tag).toContain('role="switch"');
    expect(tag).toContain('disabled=""');
  });

  test("without the disabled prop, switch buttons are not disabled", () => {
    const html = renderToStaticMarkup(
      <StandardToolpackSection
        enabledToolNames={[...DEFAULT_ON_TOOL_NAMES]}
        onChange={noop}
        outputMode="none"
      />,
    );
    const idx = html.indexOf("Run shell commands");
    const buttonOpenIdx = html.indexOf("<button", idx);
    const buttonCloseIdx = html.indexOf(">", buttonOpenIdx);
    const tag = html.slice(buttonOpenIdx, buttonCloseIdx);
    expect(tag).toContain('role="switch"');
    expect(tag).not.toContain('disabled=""');
  });

  // --- Regression coverage -------------------------------------------------

  test("REG: built-in switch states are independent of outputMode — only the GitHub row caption changes", () => {
    const enabledToolNames = ["bash"];
    const noneHtml = renderToStaticMarkup(
      <StandardToolpackSection
        enabledToolNames={enabledToolNames}
        onChange={noop}
        outputMode="none"
      />,
    );
    const readyPrHtml = renderToStaticMarkup(
      <StandardToolpackSection
        enabledToolNames={enabledToolNames}
        onChange={noop}
        outputMode="ready_pr"
      />,
    );

    // This would fail if a future change accidentally re-coupled outputMode
    // to the built-in toggle states (the exact two-control coupling bug this
    // issue's step-2 already fixed for GitHub write permission — a regression
    // here would silently reintroduce a similar coupling for the toolpack).
    for (const label of [
      "Run shell commands",
      "Read files",
      "Fetch external URLs",
    ]) {
      const noneIdx = noneHtml.indexOf(label);
      const noneButtonIdx = noneHtml.indexOf("<button", noneIdx);
      const noneTag = noneHtml.slice(
        noneButtonIdx,
        noneHtml.indexOf(">", noneButtonIdx),
      );

      const prIdx = readyPrHtml.indexOf(label);
      const prButtonIdx = readyPrHtml.indexOf("<button", prIdx);
      const prTag = readyPrHtml.slice(
        prButtonIdx,
        readyPrHtml.indexOf(">", prButtonIdx),
      );

      const noneChecked = noneTag.includes('data-state="checked"');
      const prChecked = prTag.includes('data-state="checked"');
      expect(prChecked).toBe(noneChecked);
    }

    // Sanity: the caption DID change (proves the two renders aren't identical
    // for an unrelated reason, e.g. a broken outputMode prop wire-up).
    const noneGhIdx = noneHtml.indexOf("GitHub (scoped to this repo)");
    const prGhIdx = readyPrHtml.indexOf("GitHub (scoped to this repo)");
    expect(noneHtml.slice(noneGhIdx, noneGhIdx + 400).toLowerCase()).toContain(
      "read-only",
    );
    expect(readyPrHtml.slice(prGhIdx, prGhIdx + 400).toLowerCase()).toContain(
      "pull request",
    );
  });

  test("REG: the fixed GitHub row can never become a toggleable entry — STANDARD_TOOLPACK_ITEMS has no github-like name and total switches always equals its length", () => {
    // Guards against a future edit that accidentally adds a "github" (or
    // similarly named) entry to STANDARD_TOOLPACK_ITEMS, which would let it
    // render as a Switch and get serialized into builtinToolNames — breaking
    // the "always present, cannot be removed" contract from issue #721.
    for (const item of STANDARD_TOOLPACK_ITEMS) {
      expect(item.name.toLowerCase()).not.toContain("github");
    }

    const html = renderToStaticMarkup(
      <StandardToolpackSection
        enabledToolNames={[...DEFAULT_ON_TOOL_NAMES]}
        onChange={noop}
        outputMode="none"
      />,
    );
    const switchMatches = html.match(/role="switch"/g) ?? [];
    expect(switchMatches.length).toBe(STANDARD_TOOLPACK_ITEMS.length);
  });
});
