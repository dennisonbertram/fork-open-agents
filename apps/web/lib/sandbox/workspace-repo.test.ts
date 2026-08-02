import { describe, expect, test } from "bun:test";
import { readWorkspaceRepoState } from "./workspace-repo";

function makeSandbox(responses: Record<string, { ok: boolean; out: string }>) {
  return {
    workingDirectory: "/vercel/sandbox",
    exec: async (command: string) => {
      const hit = responses[command] ?? { ok: false, out: "" };
      return {
        success: hit.ok,
        exitCode: hit.ok ? 0 : 1,
        stdout: hit.out,
        stderr: "",
        truncated: false,
      };
    },
  };
}

describe("readWorkspaceRepoState", () => {
  test("reports not cloned when there is no origin remote", async () => {
    const state = await readWorkspaceRepoState(makeSandbox({}));
    expect(state).toEqual({ cloned: false });
  });

  test("reports the branch actually checked out", async () => {
    const state = await readWorkspaceRepoState(
      makeSandbox({
        "git remote get-url origin": {
          ok: true,
          out: "https://github.com/acme/private-repo\n",
        },
        "git rev-parse --abbrev-ref HEAD": { ok: true, out: "master\n" },
      }),
    );
    expect(state).toEqual({ cloned: true, branch: "master" });
  });

  test("omits the branch when HEAD cannot be read", async () => {
    const state = await readWorkspaceRepoState(
      makeSandbox({
        "git remote get-url origin": {
          ok: true,
          out: "https://github.com/acme/private-repo\n",
        },
      }),
    );
    expect(state).toEqual({ cloned: true });
  });
});
