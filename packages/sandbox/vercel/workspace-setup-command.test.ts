import { describe, expect, test } from "bun:test";
import {
  buildWorkspaceSetupCommand,
  SHALLOW_CLONE_DEPTH,
} from "./workspace-setup-command";

describe("buildWorkspaceSetupCommand", () => {
  test("returns undefined when there is nothing to set up", () => {
    expect(buildWorkspaceSetupCommand({})).toBeUndefined();
  });

  test("shallow-clones a branch into the workspace by default", () => {
    expect(
      buildWorkspaceSetupCommand({
        clone: {
          url: "https://github.com/open-agents/example",
          branch: "main",
        },
      }),
    ).toBe(
      "git clone --depth=1 --single-branch --branch 'main' 'https://github.com/open-agents/example' .",
    );
  });

  test("shallow-clones the default branch when no branch is given", () => {
    expect(
      buildWorkspaceSetupCommand({
        clone: { url: "https://github.com/open-agents/example" },
      }),
    ).toBe(
      "git clone --depth=1 --single-branch 'https://github.com/open-agents/example' .",
    );
  });

  test("uses the configured shallow depth constant", () => {
    expect(SHALLOW_CLONE_DEPTH).toBe(1);
    expect(
      buildWorkspaceSetupCommand({
        clone: {
          url: "https://github.com/open-agents/example",
          depth: SHALLOW_CLONE_DEPTH,
        },
      }),
    ).toContain(`--depth=${SHALLOW_CLONE_DEPTH}`);
  });

  test("falls back to a full clone when depth is 0", () => {
    expect(
      buildWorkspaceSetupCommand({
        clone: {
          url: "https://github.com/open-agents/example",
          branch: "main",
          depth: 0,
        },
      }),
    ).toBe(
      "git clone --branch 'main' 'https://github.com/open-agents/example' .",
    );
  });

  test("combines clone, git config, and new-branch checkout into one command", () => {
    expect(
      buildWorkspaceSetupCommand({
        clone: {
          url: "https://github.com/open-agents/example",
          branch: "main",
        },
        gitUser: { name: "AI Agent", email: "agent@example.com" },
        newBranch: "agent/work",
      }),
    ).toBe(
      "git clone --depth=1 --single-branch --branch 'main' 'https://github.com/open-agents/example' . && " +
        "git config user.name 'AI Agent' && " +
        "git config user.email 'agent@example.com' && " +
        "git checkout -b 'agent/work'",
    );
  });

  test("configures git user and checks out a branch without cloning (native source path)", () => {
    expect(
      buildWorkspaceSetupCommand({
        gitUser: { name: "AI Agent", email: "agent@example.com" },
        newBranch: "agent/work",
      }),
    ).toBe(
      "git config user.name 'AI Agent' && " +
        "git config user.email 'agent@example.com' && " +
        "git checkout -b 'agent/work'",
    );
  });

  test("bootstraps an empty repo with an initial commit", () => {
    expect(
      buildWorkspaceSetupCommand({
        initEmptyRepo: true,
        gitUser: { name: "AI Agent", email: "agent@example.com" },
        initialEmptyCommit: true,
      }),
    ).toBe(
      "git init && " +
        "git config user.name 'AI Agent' && " +
        "git config user.email 'agent@example.com' && " +
        "git commit --allow-empty -m 'Initial commit'",
    );
  });

  test("bootstraps an empty repo with just git init when no user is provided", () => {
    expect(buildWorkspaceSetupCommand({ initEmptyRepo: true })).toBe(
      "git init",
    );
  });

  test("escapes single quotes in git user values to prevent command injection", () => {
    expect(
      buildWorkspaceSetupCommand({
        gitUser: { name: "O'Brien; rm -rf /", email: "a@b.co" },
      }),
    ).toBe(
      "git config user.name 'O'\\''Brien; rm -rf /' && " +
        "git config user.email 'a@b.co'",
    );
  });

  test("escapes single quotes in the clone url and branch", () => {
    expect(
      buildWorkspaceSetupCommand({
        clone: { url: "https://x/'; touch pwned;'", branch: "b'1" },
      }),
    ).toBe(
      "git clone --depth=1 --single-branch --branch 'b'\\''1' 'https://x/'\\''; touch pwned;'\\''' .",
    );
  });
});
