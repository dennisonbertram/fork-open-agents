import { describe, expect, test } from "bun:test";
import { apiJson, authAvailable, contractEnabled } from "./_client";

/**
 * Read endpoints: authenticated GET returns 200 with the documented
 * top-level container shape. Catches contract drift (renamed/removed keys)
 * that mock-based unit tests can't.
 */
describe.skipIf(!(contractEnabled && authAvailable))(
  "contract / read endpoints",
  () => {
    test("GET /api/models -> { models: [] }", async () => {
      const { status, data } = await apiJson<{ models: unknown[] }>(
        "/api/models",
      );
      expect(status).toBe(200);
      expect(Array.isArray(data.models)).toBe(true);
    });

    test("GET /api/settings/preferences -> { preferences: {} }", async () => {
      const { status, data } = await apiJson<{ preferences: unknown }>(
        "/api/settings/preferences",
      );
      expect(status).toBe(200);
      expect(typeof data.preferences).toBe("object");
      expect(data.preferences).not.toBeNull();
    });

    test("GET /api/settings/skills -> { skills: [] }", async () => {
      const { status, data } = await apiJson<{ skills: unknown[] }>(
        "/api/settings/skills",
      );
      expect(status).toBe(200);
      expect(Array.isArray(data.skills)).toBe(true);
    });

    test("GET /api/inference-profiles -> { profiles: [] }", async () => {
      const { status, data } = await apiJson<{ profiles: unknown[] }>(
        "/api/inference-profiles",
      );
      expect(status).toBe(200);
      expect(Array.isArray(data.profiles)).toBe(true);
    });

    test("GET /api/sessions -> { sessions: [] }", async () => {
      const { status, data } = await apiJson<{ sessions: unknown[] }>(
        "/api/sessions",
      );
      expect(status).toBe(200);
      expect(Array.isArray(data.sessions)).toBe(true);
    });

    test("GET /api/workflows/catalog -> { workflows: [] }", async () => {
      const { status, data } = await apiJson<{ workflows: unknown[] }>(
        "/api/workflows/catalog",
      );
      expect(status).toBe(200);
      expect(Array.isArray(data.workflows)).toBe(true);
    });

    test("GET /api/usage -> { usage, insights }", async () => {
      const { status, data } = await apiJson<{
        usage: unknown;
        insights: unknown;
      }>("/api/usage", { retries: 3 });
      expect(status).toBe(200);
      expect(data.usage).toBeDefined();
      expect(data.insights).toBeDefined();
    });
  },
);
