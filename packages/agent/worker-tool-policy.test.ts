/**
 * #1401 — Delegated worker tool policy must consume runtimeMode and the
 * managed-runtime profile tool lists instead of voiding them.
 */

import { describe, expect, test } from "bun:test";
import { getDelegatedWorkerToolPolicy } from "./worker-tool-policy";

describe("delegated worker tool policy: runtimeMode consumption (#1401)", () => {
  test("classic workers keep the full role toolset", () => {
    expect(
      Object.keys(getDelegatedWorkerToolPolicy("executor", "classic")).sort(),
    ).toEqual(["bash", "edit", "glob", "grep", "read", "write"]);
    expect(
      Object.keys(getDelegatedWorkerToolPolicy("explorer", "classic")).sort(),
    ).toEqual(["bash", "glob", "grep", "read"]);
  });

  test("managed_runtime worker intersects role tools with profile-declared agent tools", () => {
    const worker = Object.keys(
      getDelegatedWorkerToolPolicy("executor", "managed_runtime", {
        expectedTools: ["read", "grep"],
        optionalTools: ["glob"],
      }),
    );
    expect(worker.sort()).toEqual(["glob", "grep", "read"]);
    expect(worker).not.toContain("bash");
    expect(worker).not.toContain("write");
    expect(worker).not.toContain("edit");
  });

  test("managed_runtime worker never gains coordinator-only tools via profile lists", () => {
    const worker = Object.keys(
      getDelegatedWorkerToolPolicy("executor", "managed_runtime", {
        expectedTools: ["task", "setup_managed_runtime_profile", "read"],
      }),
    );
    expect(worker).toEqual(["read"]);
  });

  test("toolchain labels (bun, agent-browser) do not wipe the worker toolset", () => {
    const worker = Object.keys(
      getDelegatedWorkerToolPolicy("executor", "managed_runtime", {
        expectedTools: ["bun", "agent-browser"],
      }),
    );
    expect(worker.sort()).toEqual([
      "bash",
      "edit",
      "glob",
      "grep",
      "read",
      "write",
    ]);
  });

  test("managed_runtime without profile tool lists keeps role defaults (documented deviation)", () => {
    expect(
      Object.keys(
        getDelegatedWorkerToolPolicy("executor", "managed_runtime"),
      ).sort(),
    ).toEqual(["bash", "edit", "glob", "grep", "read", "write"]);
  });

  test("allowedBuiltinToolNames still intersects in managed_runtime", () => {
    const worker = Object.keys(
      getDelegatedWorkerToolPolicy("executor", "managed_runtime", {
        allowedBuiltinToolNames: ["read", "bash", "grep"],
      }),
    );
    expect(worker.sort()).toEqual(["bash", "grep", "read"]);
  });
});
