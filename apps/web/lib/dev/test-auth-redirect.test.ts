import { describe, expect, test } from "bun:test";
import { resolveSafeTestAuthNextPath } from "./test-auth-redirect";

const ORIGIN = "http://localhost:3000";

describe("resolveSafeTestAuthNextPath", () => {
  test("allows a same-origin relative path", () => {
    expect(resolveSafeTestAuthNextPath("/sessions", ORIGIN)).toBe("/sessions");
    expect(resolveSafeTestAuthNextPath("/sessions?tab=new", ORIGIN)).toBe(
      "/sessions?tab=new",
    );
  });

  test("rejects absolute, protocol-relative, and backslash open redirects", () => {
    expect(
      resolveSafeTestAuthNextPath("https://evil.example", ORIGIN),
    ).toBeNull();
    expect(resolveSafeTestAuthNextPath("//evil.example", ORIGIN)).toBeNull();
    expect(
      resolveSafeTestAuthNextPath("/%5c%5cevil.example", ORIGIN),
    ).toBeNull();
    expect(
      resolveSafeTestAuthNextPath("/%5C%5Cevil.example", ORIGIN),
    ).toBeNull();
    expect(resolveSafeTestAuthNextPath("/\\evil.example", ORIGIN)).toBeNull();
  });

  test("rejects a path whose resolved origin leaves the request host", () => {
    expect(
      resolveSafeTestAuthNextPath("/sessions", "https://open-agents.example"),
    ).toBe("/sessions");
    expect(
      resolveSafeTestAuthNextPath(
        "https://open-agents.example/sessions",
        ORIGIN,
      ),
    ).toBeNull();
  });
});
