import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  captureSharedWorkspaceBaseline,
  checkSharedWorkspaceDrift,
} from "./shared-workspace-drift";

async function git(cwd: string, args: string[]) {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(await new Response(proc.stderr).text());
  }
}

describe("shared workspace drift detection", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(path.join(tmpdir(), "shared-workspace-drift-"));
    await git(repoDir, ["init"]);
    await git(repoDir, ["config", "user.email", "agent@example.com"]);
    await git(repoDir, ["config", "user.name", "Agent"]);
    await writeFile(path.join(repoDir, "tracked.txt"), "baseline\n");
    await writeFile(path.join(repoDir, "notes.md"), "baseline\n");
    await git(repoDir, ["add", "."]);
    await git(repoDir, ["commit", "-m", "baseline"]);
  });

  test("unchanged baseline returns clean", async () => {
    const baseline = await captureSharedWorkspaceBaseline({
      workerId: "worker-1",
      workspaceId: "workspace-1",
      workspacePath: repoDir,
    });

    const result = await checkSharedWorkspaceDrift({
      baseline,
      workspacePath: repoDir,
    });

    expect(result.status).toBe("clean");
    expect(result.events).toEqual([
      expect.objectContaining({
        type: "workspace_drift_checked",
        reasonCode: "no_drift",
      }),
    ]);
  });

  test("scoped drift blocks completion without file contents", async () => {
    const baseline = await captureSharedWorkspaceBaseline({
      workerId: "worker-1",
      workspaceId: "workspace-1",
      workspacePath: repoDir,
      protectedPaths: ["tracked.txt"],
    });
    await writeFile(path.join(repoDir, "tracked.txt"), "changed secret\n");

    const result = await checkSharedWorkspaceDrift({
      baseline,
      workspacePath: repoDir,
    });

    expect(result.status).toBe("blocked");
    expect(result.reasonCode).toBe("protected_workspace_drift");
    expect(result.changedPaths).toEqual(["tracked.txt"]);
    expect(JSON.stringify(result)).not.toContain("changed secret");
  });

  test("out-of-scope drift is recorded but does not block", async () => {
    const baseline = await captureSharedWorkspaceBaseline({
      workerId: "worker-1",
      workspaceId: "workspace-1",
      workspacePath: repoDir,
      protectedPaths: ["tracked.txt"],
    });
    await writeFile(path.join(repoDir, "notes.md"), "changed\n");

    const result = await checkSharedWorkspaceDrift({
      baseline,
      workspacePath: repoDir,
    });

    expect(result).toMatchObject({
      status: "ignored",
      reasonCode: "out_of_scope_drift",
      changedPaths: ["notes.md"],
      protectedPaths: ["tracked.txt"],
    });
  });

  test("non-git workspaces fail closed with unsupported baseline", async () => {
    const workspacePath = await mkdtemp(
      path.join(tmpdir(), "unsupported-workspace-"),
    );

    const baseline = await captureSharedWorkspaceBaseline({
      workerId: "worker-1",
      workspaceId: "workspace-1",
      workspacePath,
    });

    expect(baseline).toMatchObject({
      status: "unsupported",
      reasonCode: "git_unavailable",
    });

    const result = await checkSharedWorkspaceDrift({
      baseline,
      workspacePath,
    });

    expect(result).toMatchObject({
      status: "unsupported",
      reasonCode: "unsupported_baseline",
    });
  });
});
