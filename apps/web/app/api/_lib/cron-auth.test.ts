import { describe, expect, test } from "bun:test";
import { isAuthorizedCronRequest } from "./cron-auth";

const SECRET = "cron-secret-abc123";

function requestWith(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/cron", { headers });
}

describe("isAuthorizedCronRequest", () => {
  test("returns false for a wrong Bearer token", () => {
    expect(
      isAuthorizedCronRequest(
        requestWith({ authorization: "Bearer wrong-secret" }),
        SECRET,
      ),
    ).toBe(false);
  });

  test("returns false for a wrong header secret", () => {
    expect(
      isAuthorizedCronRequest(
        requestWith({ "x-background-agents-cron-secret": "wrong-secret" }),
        SECRET,
      ),
    ).toBe(false);
  });

  test("returns true for the correct Bearer token", () => {
    expect(
      isAuthorizedCronRequest(
        requestWith({ authorization: `Bearer ${SECRET}` }),
        SECRET,
      ),
    ).toBe(true);
  });

  test("returns true for the correct x-background-agents-cron-secret header", () => {
    expect(
      isAuthorizedCronRequest(
        requestWith({ "x-background-agents-cron-secret": SECRET }),
        SECRET,
      ),
    ).toBe(true);
  });

  test("returns false when neither header is present", () => {
    expect(isAuthorizedCronRequest(requestWith({}), SECRET)).toBe(false);
  });

  test("returns false for a Bearer token shorter than the secret", () => {
    expect(
      isAuthorizedCronRequest(
        requestWith({ authorization: "Bearer short" }),
        SECRET,
      ),
    ).toBe(false);
  });

  test("returns false for a Bearer token longer than the secret", () => {
    expect(
      isAuthorizedCronRequest(
        requestWith({ authorization: `Bearer ${SECRET}-extra-long-suffix` }),
        SECRET,
      ),
    ).toBe(false);
  });

  test("returns false for an authorization header without the Bearer prefix", () => {
    expect(
      isAuthorizedCronRequest(requestWith({ authorization: SECRET }), SECRET),
    ).toBe(false);
  });

  test("is case-sensitive on the secret value", () => {
    expect(
      isAuthorizedCronRequest(
        requestWith({ authorization: `Bearer ${SECRET.toUpperCase()}` }),
        SECRET,
      ),
    ).toBe(false);
  });
});
