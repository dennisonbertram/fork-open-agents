import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { jsonError } = await import("./git-route");

describe("git-route jsonError envelope (#1054)", () => {
  test("carries both error and errorKind derived from status", async () => {
    const res = jsonError("Not authenticated", 401);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "Not authenticated",
      errorKind: "unauthorized",
    });
  });

  test("an explicit kind overrides the status mapping", async () => {
    const res = jsonError("Session is busy", 400, "conflict");
    expect(await res.json()).toEqual({
      error: "Session is busy",
      errorKind: "conflict",
    });
  });

  test("unmapped statuses fall back to internal_error", async () => {
    const res = jsonError("Boom", 500);
    expect((await res.json()).errorKind).toBe("internal_error");
  });
});
