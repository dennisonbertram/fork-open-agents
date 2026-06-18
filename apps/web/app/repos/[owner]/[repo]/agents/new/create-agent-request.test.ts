import { describe, expect, test } from "bun:test";
import { submitNewAgent } from "./create-agent-request";

function jsonResponse(
  body: unknown,
  ok = true,
  status = ok ? 200 : 400,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("submitNewAgent", () => {
  test("returns the created agent id on success (enables stay-on-page + run test)", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return jsonResponse({ agent: { id: "agent-1" } });
    }) as unknown as typeof fetch;

    const result = await submitNewAgent({ name: "x" }, fetchImpl);

    expect(result).toEqual({ ok: true, agentId: "agent-1" });
    // Posts to the create endpoint and performs no other navigation/request.
    expect(calls).toEqual(["/api/background-agents"]);
  });

  test("surfaces a field-level validation error on failure", async () => {
    const fetchImpl = (async () =>
      jsonResponse(
        { details: { fieldErrors: { name: ["Required"] } } },
        false,
      )) as unknown as typeof fetch;

    const result = await submitNewAgent({}, fetchImpl);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  test("falls back to a generic error when the body has no details", async () => {
    const fetchImpl = (async () =>
      jsonResponse({}, false)) as unknown as typeof fetch;
    const result = await submitNewAgent({}, fetchImpl);
    expect(result).toEqual({
      ok: false,
      error: "Failed to create background agent",
    });
  });
});
