import { describe, expect, test } from "bun:test";
import { coreJourneys } from "./journeys-core";

const CTX = { profileId: "probe-id" };

function resolveBody(body: unknown): unknown {
  return typeof body === "function"
    ? (body as (c: typeof CTX) => unknown)(CTX)
    : body;
}

function nameOf(body: unknown): string | undefined {
  const resolved = resolveBody(body) as { name?: string } | undefined;
  return resolved?.name;
}

describe("J-INFPROF-01 per-id PATCH probe", () => {
  const journey = coreJourneys.find((j) => j.id === "J-INFPROF-01");

  test("writes a name no earlier step already persisted", () => {
    expect(journey).toBeDefined();
    const steps = journey?.steps ?? [];
    const perIdIndex = steps.findIndex(
      (s) => s.method === "PATCH" && typeof s.path === "function",
    );
    expect(perIdIndex).toBeGreaterThan(-1);

    const perIdName = nameOf(steps[perIdIndex]?.body);
    expect(perIdName).toBeTruthy();

    const earlierNames = steps
      .slice(0, perIdIndex)
      .filter((s) => s.method === "PATCH" || s.method === "POST")
      .map((s) => nameOf(s.body));
    expect(earlierNames).not.toContain(perIdName);
  });

  test("a later step asserts the per-id name actually persisted", () => {
    const steps = journey?.steps ?? [];
    const perIdIndex = steps.findIndex(
      (s) => s.method === "PATCH" && typeof s.path === "function",
    );
    const perIdName = nameOf(steps[perIdIndex]?.body) ?? "";
    const laterReadAsserts = steps
      .slice(perIdIndex + 1)
      .some(
        (s) => s.method === "GET" && s.assert?.toString().includes(perIdName),
      );
    expect(laterReadAsserts).toBe(true);
  });
});
