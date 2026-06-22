import { describe, expect, test } from "bun:test";
import { shouldAutoStartProvisioningSandbox } from "./auto-start-sandbox";

const repoSession = {
  cloneUrl: "https://github.com/dennisonbertram/synthetix",
  repoOwner: "dennisonbertram",
  repoName: "synthetix",
  sandboxState: { type: "vercel" },
} as const;

describe("shouldAutoStartProvisioningSandbox", () => {
  test("starts repo-backed provisioning sessions after reconnect settles", () => {
    expect(
      shouldAutoStartProvisioningSandbox({
        session: repoSession,
        sandboxInfo: null,
        isArchived: false,
        isCreatingSandbox: false,
        isRestoringSnapshot: false,
        reconnectionStatus: "no_sandbox",
        lifecycleState: "provisioning",
      }),
    ).toBe(true);
  });

  test("waits for the initial reconnect probe before starting", () => {
    expect(
      shouldAutoStartProvisioningSandbox({
        session: repoSession,
        sandboxInfo: null,
        isArchived: false,
        isCreatingSandbox: false,
        isRestoringSnapshot: false,
        reconnectionStatus: "checking",
        lifecycleState: "provisioning",
      }),
    ).toBe(false);
  });

  test("does not start sandbox-free new chats", () => {
    expect(
      shouldAutoStartProvisioningSandbox({
        session: {
          cloneUrl: null,
          repoOwner: null,
          repoName: null,
          sandboxState: null,
        },
        sandboxInfo: null,
        isArchived: false,
        isCreatingSandbox: false,
        isRestoringSnapshot: false,
        reconnectionStatus: "no_sandbox",
        lifecycleState: null,
      }),
    ).toBe(false);
  });

  test("does not double start when local sandbox info exists", () => {
    expect(
      shouldAutoStartProvisioningSandbox({
        session: repoSession,
        sandboxInfo: { createdAt: Date.now(), timeout: 300_000 },
        isArchived: false,
        isCreatingSandbox: false,
        isRestoringSnapshot: false,
        reconnectionStatus: "connected",
        lifecycleState: "provisioning",
      }),
    ).toBe(false);
  });
});
