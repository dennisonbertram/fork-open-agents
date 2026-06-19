import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createOpenAgentsApiClient } from "./client";
import { buildOpenApiDocument } from "./openapi-spec";

const HTTP_METHODS = ["get", "post", "patch", "put", "delete"] as const;

describe("openapi spec", () => {
  const doc = buildOpenApiDocument();

  test("is a non-empty OpenAPI 3.x document", () => {
    expect(doc.openapi).toMatch(/^3\./);
    expect(doc.info.title).toBe("Open Agents API");
    expect(Object.keys(doc.paths).length).toBeGreaterThan(0);
  });

  test("every operation has an operationId and at least one response", () => {
    const seen = new Set<string>();
    for (const pathItem of Object.values(doc.paths)) {
      for (const method of HTTP_METHODS) {
        const op = (pathItem as Record<string, unknown>)[method] as
          | { operationId?: string; responses?: Record<string, unknown> }
          | undefined;
        if (!op) {
          continue;
        }
        expect(typeof op.operationId).toBe("string");
        // operationIds must be unique (clients key methods off them)
        expect(seen.has(op.operationId as string)).toBe(false);
        seen.add(op.operationId as string);
        expect(Object.keys(op.responses ?? {}).length).toBeGreaterThan(0);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
  });

  test("every operation documents a 401 (all endpoints require auth)", () => {
    for (const pathItem of Object.values(doc.paths)) {
      for (const method of HTTP_METHODS) {
        const op = (pathItem as Record<string, unknown>)[method] as
          | { responses?: Record<string, unknown> }
          | undefined;
        if (!op) {
          continue;
        }
        expect(op.responses?.["401"]).toBeDefined();
      }
    }
  });

  test("committed openapi.json is in sync with the spec (no drift)", () => {
    const committed = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "..", "openapi.json"), "utf8"),
    );
    // toEqual is a deep structural comparison and ignores undefined props,
    // matching JSON.stringify's output the artifact is generated from.
    expect(committed).toEqual(doc);
  });
});

describe("typed api client", () => {
  test("issues a typed GET to the documented path", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const api = createOpenAgentsApiClient({
      baseUrl: "https://contract.test",
      fetch: (request: Request) => {
        calls.push({ url: request.url, method: request.method });
        return Promise.resolve(
          new Response(JSON.stringify({ skills: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      },
    });

    const { data } = await api.GET("/api/settings/skills");

    expect(data?.skills).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe("https://contract.test/api/settings/skills");
  });
});
