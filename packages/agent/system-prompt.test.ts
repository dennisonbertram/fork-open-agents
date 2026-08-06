import { describe, expect, test } from "bun:test";
import { MANAGED_RUNTIME_COORDINATOR_TOOL_NAMES } from "./open-agent";
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
