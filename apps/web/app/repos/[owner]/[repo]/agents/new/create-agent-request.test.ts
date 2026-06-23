import { describe, expect, test } from "bun:test";
import { submitNewAgent, updateCreatedAgent } from "./create-agent-request";

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

describe("updateCreatedAgent", () => {
  test("patches an existing agent after the create page has an id", async () => {
    const calls: { url: string; method?: string }[] = [];
    const fetchImpl = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      calls.push({ url: String(url), method: init?.method });
      return jsonResponse({ agent: { id: "agent-1" } });
    }) as unknown as typeof fetch;

    const result = await updateCreatedAgent(
      "agent-1",
      { name: "updated" },
      fetchImpl,
    );

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([
      { url: "/api/background-agents/agent-1", method: "PATCH" },
    ]);
  });

  test("surfaces a field-level validation error when update fails", async () => {
    const fetchImpl = (async () =>
      jsonResponse(
        { details: { fieldErrors: { instructions: ["Required"] } } },
        false,
      )) as unknown as typeof fetch;

    const result = await updateCreatedAgent("agent-1", {}, fetchImpl);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });
});
