import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ── Auth mock ─────────────────────────────────────────────────────────────────

type AuthResult =
  | {
      ok: true;
      userId: string;
    }
  | {
      ok: false;
      response: Response;
    };

let authResult: AuthResult = { ok: true, userId: "user-1" };

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

// ── Catalog mock ──────────────────────────────────────────────────────────────
// We intercept only buildRegistry so we can simulate a catalog failure in BT-004.
// All other catalog exports fall through to a thin in-module re-implementation
// so that the route receives realistic data for the happy-path tests.
// This avoids a top-level require() of the real module which hangs in bun:test.

// The stub entry mirrors DEFAULT_CATALOG from catalog.ts (enabled: false).
const STUB_ENTRY = Object.freeze({
  id: "stub-workflow",
  version: "0.1.0",
  name: "Stub Workflow",
  description:
    "Placeholder workflow definition. Real catalog entries will be added in issue #33.",
  capabilities: Object.freeze([]) as string[],
  proofLevel: "level-1" as const,
  enabled: false,
});

// Small stub WorkflowCatalogError that the mock can throw.
class StubWorkflowCatalogError extends Error {
  readonly kind = "definition_invalid";
  constructor(message: string) {
    super(message);
    this.name = "WorkflowCatalogError";
  }
}

// Controls whether buildRegistry throws in BT-004.
let catalogShouldThrow = false;

/**
 * A minimal stand-in registry that behaves like the real one for list/lookup.
 * Returned by the mocked buildRegistry when catalogShouldThrow === false.
 */
function makeStubRegistry() {
  const map = new Map([["stub-workflow", STUB_ENTRY]]);
  return { definitions: map };
}

mock.module("@/lib/workflows/catalog", () => ({
  buildRegistry: (_defs: unknown) => {
    if (catalogShouldThrow) {
      throw new StubWorkflowCatalogError("simulated catalog failure");
    }
    return makeStubRegistry();
  },
  listWorkflows: (registry: { definitions: Map<string, unknown> }) => {
    return Array.from(registry.definitions.values());
  },
  lookupWorkflow: (
    registry: { definitions: Map<string, unknown> },
    id: string,
  ) => {
    return registry.definitions.get(id);
  },
  DEFAULT_CATALOG: [STUB_ENTRY],
  // WorkflowCatalogError is exported so the route can instanceof-check it.
  WorkflowCatalogError: StubWorkflowCatalogError,
  SUPPORTED_PROOF_LEVELS: ["level-1", "level-2", "level-3"],
}));

// ── Lazy import of the route under test ──────────────────────────────────────
// Must come AFTER all mock.module() calls so the mocks are in effect.

const routeModulePromise = import("./route");

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("/api/workflows/catalog GET", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    catalogShouldThrow = false;
  });

  // BT-001: unauthenticated request returns 401
  test("BT-001: returns 401 when user is not authenticated", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(401);
  });

  // BT-002: authenticated success — 200 with workflows array having correct shape
  test("BT-002: returns 200 with workflows array containing correct fields for authenticated user", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      workflows: Array<{
        id: string;
        name: string;
        version: string;
        description: string;
        capabilities: string[];
        proofLevel: string;
        available: boolean;
        disabledReason: string | null;
      }>;
    };
    expect(Array.isArray(body.workflows)).toBe(true);
    const entry = body.workflows[0];
    expect(entry).toBeDefined();
    expect(typeof entry!.id).toBe("string");
    expect(typeof entry!.name).toBe("string");
    expect(typeof entry!.version).toBe("string");
    expect(typeof entry!.description).toBe("string");
    expect(Array.isArray(entry!.capabilities)).toBe(true);
    expect(typeof entry!.proofLevel).toBe("string");
    expect(typeof entry!.available).toBe("boolean");
    expect(
      entry!.disabledReason === null ||
        typeof entry!.disabledReason === "string",
    ).toBe(true);
  });

  // BT-003: disabled workflow — available=false with non-null disabledReason
  test("BT-003: disabled workflow entry has available=false and non-null disabledReason", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      workflows: Array<{
        id: string;
        available: boolean;
        disabledReason: string | null;
      }>;
    };
    // The stub entry has enabled: false — mirrors DEFAULT_CATALOG
    const stubEntry = body.workflows.find((w) => w.id === "stub-workflow");
    expect(stubEntry).toBeDefined();
    expect(stubEntry!.available).toBe(false);
    expect(stubEntry!.disabledReason).not.toBeNull();
    expect(typeof stubEntry!.disabledReason).toBe("string");
    expect(stubEntry!.disabledReason!.length).toBeGreaterThan(0);
  });

  // BT-004: catalog throws WorkflowCatalogError -> 503 with catalog_unavailable errorKind
  test("BT-004: returns typed 503 with catalog_unavailable errorKind when catalog build throws", async () => {
    catalogShouldThrow = true;
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(503);
    const body = (await response.json()) as { errorKind: string };
    expect(body.errorKind).toBe("catalog_unavailable");
  });

  // BT-005: response contains ONLY documented projected fields (no internal leakage)
  test("BT-005: response workflow entries contain only the projected stable fields", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      workflows: Array<Record<string, unknown>>;
    };
    expect(body.workflows.length).toBeGreaterThan(0);
    const entry = body.workflows[0]!;
    const allowedKeys = new Set([
      "id",
      "name",
      "version",
      "description",
      "capabilities",
      "proofLevel",
      "available",
      "disabledReason",
    ]);
    const actualKeys = Object.keys(entry);
    for (const key of actualKeys) {
      expect(allowedKeys.has(key)).toBe(true);
    }
    // The internal `enabled` and `inputSchemaRef` fields must NOT be present
    expect(actualKeys).not.toContain("enabled");
    expect(actualKeys).not.toContain("inputSchemaRef");
  });
});
