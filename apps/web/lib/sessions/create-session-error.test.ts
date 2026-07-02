/**
 * Tests for the shared create-session error-surfacing helper (#784).
 *
 * BT-784-001: mapCreateSessionErrorResponse maps a 403 body (with or without
 *             an explicit `kind`) to vercel_reauth_required + /settings action.
 * BT-784-002: mapCreateSessionErrorResponse maps a 429 to rate_limited with no
 *             action link.
 * BT-784-003: mapCreateSessionErrorResponse maps a generic 500 to unknown with
 *             fallback copy when no `error` message is present.
 * BT-784-004: CreateSessionError round-trips kind/actionUrl/actionLabel via
 *             toCreateSessionErrorInfo.
 * BT-784-005: toCreateSessionErrorInfo maps a non-CreateSessionError (network
 *             error) to generic fallback copy + "unknown" kind.
 */

import { describe, expect, test } from "bun:test";
import {
  CreateSessionError,
  mapCreateSessionErrorResponse,
  toCreateSessionErrorInfo,
} from "./create-session-error";

describe("mapCreateSessionErrorResponse", () => {
  test("BT-784-001: 403 body maps to vercel_reauth_required with a /settings action", () => {
    const info = mapCreateSessionErrorResponse(
      { error: "Reconnect Vercel to select a Vercel project" },
      403,
    );

    expect(info.message).toBe("Reconnect Vercel to select a Vercel project");
    expect(info.kind).toBe("vercel_reauth_required");
    expect(info.actionUrl).toBe("/settings");
    expect(info.actionLabel).toBeTruthy();
  });

  test("BT-784-002: 429 body maps to rate_limited with no action link", () => {
    const info = mapCreateSessionErrorResponse(
      { error: "Too many requests" },
      429,
    );

    expect(info.message).toBe("Too many requests");
    expect(info.kind).toBe("rate_limited");
    expect(info.actionUrl).toBeUndefined();
  });

  test("BT-784-003: 500 body with no error message falls back to generic copy", () => {
    const info = mapCreateSessionErrorResponse({}, 500);

    expect(info.kind).toBe("unknown");
    expect(info.message).toBe("Couldn't create the session — try again");
    expect(info.actionUrl).toBeUndefined();
  });

  test("BT-784-003b: explicit body.kind wins over status-based inference", () => {
    const info = mapCreateSessionErrorResponse(
      { error: "Slow down", kind: "rate_limited" },
      500,
    );

    expect(info.kind).toBe("rate_limited");
  });
});

describe("CreateSessionError + toCreateSessionErrorInfo", () => {
  test("BT-784-004: round-trips kind/actionUrl/actionLabel", () => {
    const error = new CreateSessionError({
      message: "Reconnect Vercel to select a Vercel project",
      kind: "vercel_reauth_required",
      actionUrl: "/settings",
      actionLabel: "Go to Settings",
    });

    const info = toCreateSessionErrorInfo(error);

    expect(info.message).toBe("Reconnect Vercel to select a Vercel project");
    expect(info.kind).toBe("vercel_reauth_required");
    expect(info.actionUrl).toBe("/settings");
    expect(info.actionLabel).toBe("Go to Settings");
  });

  test("BT-784-005: non-CreateSessionError input maps to generic unknown copy", () => {
    const info = toCreateSessionErrorInfo(new TypeError("Failed to fetch"));

    expect(info.kind).toBe("unknown");
    expect(info.message).toBe("Couldn't create the session — try again");
    expect(info.actionUrl).toBeUndefined();
  });
});
