import { describe, expect, test } from "bun:test";
import {
  buildAlertKey,
  renderAlertBody,
  renderAlertTitle,
  upsertAlert,
  type GhRunner,
} from "./ops-alert";

function commandRecorder(
  results: Array<{ status: number; stdout: string; stderr: string }>,
) {
  const commands: string[][] = [];
  const runGh: GhRunner = (args) => {
    commands.push(args);
    const result = results.shift();
    if (!result) throw new Error("Unexpected gh command");
    return result;
  };
  return { commands, runGh };
}

describe("ops alert", () => {
  test("uses a stable dedupe key", () => {
    expect(
      buildAlertKey({ source: "Public-Smoke", environment: "Production" }),
    ).toBe("production-ops:public-smoke:production");
  });

  test("renders a stable incident title independent of lifecycle status", () => {
    expect(
      renderAlertTitle({
        source: "public-smoke",
        environment: "production",
        status: "failing",
        summary: "home failed",
      }),
    ).toBe("[production-ops] public-smoke in production");

    expect(
      renderAlertTitle({
        source: "public-smoke",
        environment: "production",
        status: "recovered",
        summary: "healthy again",
      }),
    ).toBe("[production-ops] public-smoke in production");
  });

  test("redacts secret-like body text", () => {
    const body = renderAlertBody({
      source: "public-smoke",
      environment: "production",
      status: "failing",
      summary: "GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz",
    });
    expect(body).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz");
    expect(body).toContain("[redacted]");
  });

  test("renders only explicitly scoped Vercel diagnostics", () => {
    const body = renderAlertBody({
      source: "public-smoke",
      environment: "production",
      status: "failing",
      summary: "home failed",
    });

    expect(body).not.toContain("vercel logs --project open-agents");
    expect(body).toContain("vercel logs --scope <team-or-org-id>");
    expect(body).toContain("--project <project-id>");
  });

  test("does not create an issue for recovery without an open incident", () => {
    const recorder = commandRecorder([{ status: 0, stdout: "\n", stderr: "" }]);

    const result = upsertAlert(
      {
        source: "public-smoke",
        environment: "production",
        status: "recovered",
        summary: "healthy",
      },
      recorder.runGh,
    );

    expect(result).toEqual({ state: "no_op", output: "no open incident" });
    expect(recorder.commands).toHaveLength(1);
    expect(recorder.commands[0]?.slice(0, 2)).toEqual(["issue", "list"]);
  });

  test("creates a status-neutral incident for a first failure", () => {
    const recorder = commandRecorder([
      { status: 0, stdout: "\n", stderr: "" },
      {
        status: 0,
        stdout: "https://github.com/example/issues/42\n",
        stderr: "",
      },
    ]);

    const result = upsertAlert(
      {
        source: "public-smoke",
        environment: "production",
        status: "failing",
        summary: "unhealthy",
      },
      recorder.runGh,
    );

    expect(result.state).toBe("open");
    expect(recorder.commands[1]?.slice(0, 2)).toEqual(["issue", "create"]);
    const titleIndex = recorder.commands[1]?.indexOf("--title") ?? -1;
    expect(recorder.commands[1]?.[titleIndex + 1]).toBe(
      "[production-ops] public-smoke in production",
    );
  });

  test("comments on the existing incident for a repeated failure", () => {
    const recorder = commandRecorder([
      { status: 0, stdout: "42\n", stderr: "" },
      { status: 0, stdout: "commented\n", stderr: "" },
    ]);

    const result = upsertAlert(
      {
        source: "public-smoke",
        environment: "production",
        status: "failing",
        summary: "still unhealthy",
      },
      recorder.runGh,
    );

    expect(result.state).toBe("repeated");
    expect(recorder.commands[1]?.slice(0, 3)).toEqual([
      "issue",
      "comment",
      "42",
    ]);
    expect(recorder.commands.flat()).not.toContain("--title");
  });

  test("comments on an existing incident when recovery is observed", () => {
    const recorder = commandRecorder([
      { status: 0, stdout: "42\n", stderr: "" },
      { status: 0, stdout: "commented\n", stderr: "" },
    ]);

    const result = upsertAlert(
      {
        source: "public-smoke",
        environment: "production",
        status: "recovered",
        summary: "healthy",
      },
      recorder.runGh,
    );

    expect(result).toEqual({
      state: "recovered",
      issueNumber: "42",
      output: "commented\n",
    });
    expect(recorder.commands[1]?.slice(0, 3)).toEqual([
      "issue",
      "comment",
      "42",
    ]);
  });

  test("propagates issue search failures without creating an issue", () => {
    const recorder = commandRecorder([
      { status: 1, stdout: "", stderr: "search failed" },
    ]);

    expect(() =>
      upsertAlert(
        {
          source: "public-smoke",
          environment: "production",
          status: "failing",
          summary: "unhealthy",
        },
        recorder.runGh,
      ),
    ).toThrow("search failed");
    expect(recorder.commands).toHaveLength(1);
  });
});
