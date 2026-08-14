import { describe, expect, test } from "bun:test";
import {
  MANAGED_RUNTIME_COORDINATOR_TOOL_NAMES,
  OPEN_AGENT_TOOL_NAMES,
} from "./open-agent";
import { buildSystemPrompt } from "./system-prompt";

// DEFECT B: the managed-runtime coordinator's system prompt used to document
// glob/grep/read/edit/bash as its own tools (CORE_SYSTEM_PROMPT's "Fast
// Context Understanding", "File Operations", and "Shell" sections), while
// getRuntimeModeToolPolicy actually strips those tools out for
// runtimeMode: "managed_runtime". The model read a manual for tools it did
// not hold, tried to call them, failed, and thrashed. These tests pin the
// managed_runtime prompt to the coordinator's real tool set and keep the
// classic-mode prompt untouched.

describe("managed_runtime prompt does not document coding tools it lacks", () => {
  test("does not instruct the coordinator to use glob, grep, read, edit, write, or bash", () => {
    const prompt = buildSystemPrompt({ runtimeMode: "managed_runtime" });

    // The sections that taught the model to call these tools directly must
    // be gone -- not merely contradicted by a later instruction.
    expect(prompt).not.toContain("# Fast Context Understanding");
    expect(prompt).not.toContain("## File Operations");
    expect(prompt).not.toContain("## Shell");
    expect(prompt).not.toContain(
      "Start with `glob`/`grep` for targeted discovery",
    );
    expect(prompt).not.toContain("- `glob` - Find files by pattern.");
    expect(prompt).not.toContain("- `grep` - Search file contents");
    expect(prompt).not.toContain(
      "- `read` - Read file contents. ALWAYS read before editing.",
    );
    expect(prompt).not.toContain(
      "- `edit` - Make precise string replacements in files.",
    );
    expect(prompt).not.toContain("- `bash` - Run shell commands");
    expect(prompt).not.toContain(
      "- `write` - Create or overwrite files. Prefer edit for existing files.",
    );
  });

  test("describes delegation via the task tool as the way to get coding work done", () => {
    const prompt = buildSystemPrompt({ runtimeMode: "managed_runtime" });

    expect(prompt).toContain("`task`");
    expect(prompt).toContain(
      "Spawn a subagent to do ALL file reading, editing, repository search, shell commands",
    );
    expect(prompt).toContain("delegate");
  });

  test("every tool named as available in the coordinator tool set is a real managed_runtime tool (imports the constant so the two cannot drift)", () => {
    const prompt = buildSystemPrompt({ runtimeMode: "managed_runtime" });

    const sectionStart = prompt.indexOf("## Coordinator Tool Set");
    expect(sectionStart).toBeGreaterThan(-1);
    const nextHeadingIndex = prompt.indexOf("## Planning", sectionStart);
    expect(nextHeadingIndex).toBeGreaterThan(sectionStart);
    const coordinatorToolSetSection = prompt.slice(
      sectionStart,
      nextHeadingIndex,
    );

    const availableToolNames = [
      ...coordinatorToolSetSection.matchAll(/^- `([a-z_]+)` - /gm),
    ]
      .map((match) => match[1])
      .filter((name): name is string => typeof name === "string");

    // Sanity check: the section actually names tools (regex isn't vacuous).
    expect(availableToolNames.length).toBeGreaterThan(0);

    for (const name of availableToolNames) {
      expect(
        MANAGED_RUNTIME_COORDINATOR_TOOL_NAMES as readonly string[],
      ).toContain(name);
    }

    // The coding tools the coordinator does not hold must never be members
    // of the real tool-policy constant either -- guards against the policy
    // and the prompt drifting back into agreement on the wrong tool set.
    for (const forbidden of ["glob", "grep", "read", "edit", "bash", "write"]) {
      expect(
        MANAGED_RUNTIME_COORDINATOR_TOOL_NAMES as readonly string[],
      ).not.toContain(forbidden);
    }
  });
});

describe("classic-mode prompt is unchanged", () => {
  test("still documents glob, grep, read, and edit as directly available tools", () => {
    const classicPrompt = buildSystemPrompt({ runtimeMode: "classic" });
    const defaultPrompt = buildSystemPrompt({});

    // Explicit classic and the default (no runtimeMode) must be byte-identical.
    expect(defaultPrompt).toBe(classicPrompt);

    expect(classicPrompt).toContain("# Fast Context Understanding");
    expect(classicPrompt).toContain("## File Operations");
    expect(classicPrompt).toContain("## Shell");
    expect(classicPrompt).toContain(
      "Start with `glob`/`grep` for targeted discovery",
    );
    expect(classicPrompt).toContain("- `glob` - Find files by pattern.");
    expect(classicPrompt).toContain("- `grep` - Search file contents");
    expect(classicPrompt).toContain(
      "- `read` - Read file contents. ALWAYS read before editing.",
    );
    expect(classicPrompt).toContain(
      "- `edit` - Make precise string replacements in files.",
    );
    expect(classicPrompt).not.toContain("## Coordinator Tool Set");
  });
});

// #1243: the system prompt used to describe the agent's tools as static
// prose, independent of the tool set actually passed to the model. A run
// whose tool set excludes a built-in tool (e.g. an MCP-started/headless run,
// which denies `ask_user_question` because no browser can answer it -- see
// apps/web/lib/mcp-server/headless-run-options.ts HEADLESS_DENIED_TOOL_NAMES)
// still got a prompt advertising the removed tool, and in one section
// instructing the agent to use it. These tests pin the prompt's tool
// descriptions to the effective tool set passed via `toolNames`.
describe("prompt tool descriptions match the effective tool set (#1243)", () => {
  // Mirrors HEADLESS_DENIED_TOOL_NAMES in
  // apps/web/lib/mcp-server/headless-run-options.ts. Kept as an array and
  // iterated below (not a single hardcoded string check) so the guard
  // automatically covers the next tool that gets denied to a restricted run.
  const HEADLESS_DENIED_TOOL_NAMES: readonly string[] = ["ask_user_question"];

  const headlessToolNames = OPEN_AGENT_TOOL_NAMES.filter(
    (name) => !HEADLESS_DENIED_TOOL_NAMES.includes(name),
  );

  test("a tool set lacking ask_user_question produces no mention of it, including the clarify-requirements guidance", () => {
    const prompt = buildSystemPrompt({ toolNames: headlessToolNames });

    for (const deniedName of HEADLESS_DENIED_TOOL_NAMES) {
      expect(prompt).not.toContain(`\`${deniedName}\``);
    }
    expect(prompt).not.toContain("## Gathering User Input");
    expect(prompt).not.toContain(
      "Use `ask_user_question` to clarify requirements or let users choose between approaches",
    );
    expect(prompt).not.toContain(
      "Prefer structured questions over open-ended chat when you need specific decisions.",
    );
  });

  test("a managed_runtime coordinator tool set lacking ask_user_question omits it from the coordinator tool list", () => {
    const prompt = buildSystemPrompt({
      runtimeMode: "managed_runtime",
      toolNames: headlessToolNames.filter((name) =>
        (MANAGED_RUNTIME_COORDINATOR_TOOL_NAMES as readonly string[]).includes(
          name,
        ),
      ),
    });

    for (const deniedName of HEADLESS_DENIED_TOOL_NAMES) {
      expect(prompt).not.toContain(`\`${deniedName}\``);
    }
  });

  test("an unrestricted (full) tool set produces a prompt byte-identical to omitting toolNames", () => {
    const withExplicitFullList = buildSystemPrompt({
      toolNames: OPEN_AGENT_TOOL_NAMES,
    });
    const withOmittedToolNames = buildSystemPrompt({});

    expect(withExplicitFullList).toBe(withOmittedToolNames);
  });

  test("an unrestricted managed_runtime tool set produces a prompt byte-identical to omitting toolNames", () => {
    const withExplicitFullList = buildSystemPrompt({
      runtimeMode: "managed_runtime",
      toolNames: MANAGED_RUNTIME_COORDINATOR_TOOL_NAMES as readonly string[],
    });
    const withOmittedToolNames = buildSystemPrompt({
      runtimeMode: "managed_runtime",
    });

    expect(withExplicitFullList).toBe(withOmittedToolNames);
  });
});
