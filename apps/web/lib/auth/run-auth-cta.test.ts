/**
 * Tests for the shared auth CTA pending/error/retry contract (#786).
 *
 * BT-786-001: A rejected action resets pending to false and sets the error
 *             message.
 * BT-786-002: A resolved action leaves pending `true` (caller navigates
 *             away) and never sets an error.
 * BT-786-003: `retryAuthCta` re-invokes the action and clears a prior error
 *             on success.
 * BT-786-004: A rejection logs `auth_cta_failed` with the cta name and a
 *             classified errorKind.
 * BT-786-005: `retryAuthCta` logs `auth_cta_retry` with the cta name before
 *             invoking the action.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { retryAuthCta, runAuthCta } from "./run-auth-cta";

describe("runAuthCta / retryAuthCta (#786)", () => {
  let pendingValues: boolean[] = [];
  let errorValues: (string | null)[] = [];
  let warnSpy: ReturnType<typeof mock>;
  let infoSpy: ReturnType<typeof mock>;
  let originalWarn: typeof console.warn;
  let originalInfo: typeof console.info;

  beforeEach(() => {
    pendingValues = [];
    errorValues = [];
    originalWarn = console.warn;
    originalInfo = console.info;
    warnSpy = mock(() => undefined);
    infoSpy = mock(() => undefined);
    console.warn = warnSpy as unknown as typeof console.warn;
    console.info = infoSpy as unknown as typeof console.info;
  });

  function setters() {
    return {
      setPending: (value: boolean) => pendingValues.push(value),
      setError: (value: string | null) => errorValues.push(value),
    };
  }

  test("BT-786-001: rejection resets pending to false and sets the error message", async () => {
    await runAuthCta({
      cta: "vercel_signin",
      errorMessage: "Sign-in didn't start. Try again.",
      action: () => Promise.reject(new Error("network down")),
      ...setters(),
    });

    console.warn = originalWarn;
    console.info = originalInfo;

    expect(pendingValues).toEqual([true, false]);
    expect(errorValues).toEqual([null, "Sign-in didn't start. Try again."]);
  });

  test("BT-786-002: a resolved action leaves pending true and never sets an error", async () => {
    await runAuthCta({
      cta: "vercel_signin",
      errorMessage: "Sign-in didn't start. Try again.",
      action: () => Promise.resolve(),
      ...setters(),
    });

    console.warn = originalWarn;
    console.info = originalInfo;

    expect(pendingValues).toEqual([true]);
    expect(errorValues).toEqual([null]);
  });

  test("BT-786-003: retryAuthCta re-invokes the action and clears a prior error on success", async () => {
    let calls = 0;
    await retryAuthCta({
      cta: "github_link_settings",
      errorMessage: "Couldn't connect GitHub. Try again.",
      action: () => {
        calls += 1;
        return Promise.resolve();
      },
      ...setters(),
    });

    console.warn = originalWarn;
    console.info = originalInfo;

    expect(calls).toBe(1);
    expect(errorValues).toEqual([null]);
  });

  test("BT-786-004: a rejection logs auth_cta_failed with the cta name and a classified errorKind", async () => {
    await runAuthCta({
      cta: "github_link_get_started",
      errorMessage: "Couldn't connect GitHub. Try again.",
      action: () => Promise.reject(new TypeError("Failed to fetch")),
      ...setters(),
    });

    console.warn = originalWarn;
    console.info = originalInfo;

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [eventName, fields] = warnSpy.mock.calls[0] as [string, unknown];
    expect(eventName).toBe("auth_cta_failed");
    expect(fields).toMatchObject({
      cta: "github_link_get_started",
      errorKind: "network_error",
    });
  });

  test("BT-786-005: retryAuthCta logs auth_cta_retry with the cta name before invoking the action", async () => {
    await retryAuthCta({
      cta: "vercel_signin",
      errorMessage: "Sign-in didn't start. Try again.",
      action: () => Promise.resolve(),
      ...setters(),
    });

    console.warn = originalWarn;
    console.info = originalInfo;

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const [eventName, fields] = infoSpy.mock.calls[0] as [string, unknown];
    expect(eventName).toBe("auth_cta_retry");
    expect(fields).toMatchObject({ cta: "vercel_signin" });
  });
});

// Codex P1 (PR #837, comment 3516586660): better-auth's client resolves API
// errors as { data, error } instead of rejecting. A resolved error must take
// the same failure path as a rejection — never leave the CTA pending forever.
describe("resolved better-auth { error } responses (#786)", () => {
  let pendingValues: boolean[] = [];
  let errorValues: (string | null)[] = [];
  let originalWarn: typeof console.warn;
  let warnSpy: ReturnType<typeof mock>;

  beforeEach(() => {
    pendingValues = [];
    errorValues = [];
    originalWarn = console.warn;
    warnSpy = mock(() => undefined);
    console.warn = warnSpy as unknown as typeof console.warn;
  });

  function setters() {
    return {
      setPending: (value: boolean) => pendingValues.push(value),
      setError: (value: string | null) => errorValues.push(value),
    };
  }

  test("BT-786-006: a resolved { error } resets pending and sets the error message", async () => {
    await runAuthCta({
      cta: "vercel_signin",
      errorMessage: "Sign-in didn't start. Try again.",
      action: () =>
        Promise.resolve({
          data: null,
          error: { status: 400, message: "invalid provider" },
        }),
      ...setters(),
    });

    console.warn = originalWarn;

    expect(pendingValues).toEqual([true, false]);
    expect(errorValues).toEqual([null, "Sign-in didn't start. Try again."]);
  });

  test("BT-786-007: a resolved { error } logs auth_cta_failed", async () => {
    await runAuthCta({
      cta: "github_link_settings",
      errorMessage: "Connect didn't start. Try again.",
      action: () =>
        Promise.resolve({ data: null, error: { message: "denied" } }),
      ...setters(),
    });

    console.warn = originalWarn;

    const logged = warnSpy.mock.calls
      .map((call) => String(call[0]))
      .some((line) => line.includes("auth_cta_failed"));
    expect(logged).toBe(true);
  });

  test("BT-786-008: a resolved { data, error: null } success still leaves pending true", async () => {
    await runAuthCta({
      cta: "vercel_signin",
      errorMessage: "Sign-in didn't start. Try again.",
      action: () => Promise.resolve({ data: { url: "x" }, error: null }),
      ...setters(),
    });

    console.warn = originalWarn;

    expect(pendingValues).toEqual([true]);
    expect(errorValues).toEqual([null]);
  });
});
