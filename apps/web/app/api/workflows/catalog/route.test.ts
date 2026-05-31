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
  capabilities: [] as string[],
  proofLevel: "level-1" as const,
  enabled: false,
});

// An enabled entry used by regression tests to verify availability flip.
const ENABLED_ENTRY = Object.freeze({
  id: "enabled-workflow",
  version: "1.0.0",
  name: "Enabled Workflow",
  description: "A workflow that is enabled.",
  capabilities: ["run-code"] as string[],
  proofLevel: "level-2" as const,
  enabled: true,
});

// Small stub WorkflowCatalogError that the mock can throw.
class StubWorkflowCatalogError extends Error {
  readonly kind = "definition_invalid";
  constructor(message: string) {
    super(message);
    this.name = "StubWorkflowCatalogError";
  }
}

// Controls whether buildRegistry throws in BT-004.
let catalogShouldThrow = false;
// Controls whether to include the enabled entry (regression tests).
let includeEnabledEntry = false;

/**
 * A minimal stand-in registry that behaves like the real one for list/lookup.
 * Returned by the mocked buildRegistry when catalogShouldThrow === false.
 */
function makeStubRegistry() {
  const entries: Array<[string, typeof STUB_ENTRY | typeof ENABLED_ENTRY]> = [
    ["stub-workflow", STUB_ENTRY],
  ];
  if (includeEnabledEntry) {
    entries.push(["enabled-workflow", ENABLED_ENTRY]);
  }
  return { definitions: new Map(entries) };
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
    includeEnabledEntry = false;
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

  // ── Regression tests ────────────────────────────────────────────────────────
  // These would fail if the implementation in feat(workflows): (#31) were reverted.

  // REG-001: availability flips correctly — enabled workflow has available=true,
  //          disabledReason=null. If computeAvailability ignores the `enabled`
  //          field, this test fails.
  test("REG-001: enabled workflow has available=true and disabledReason=null", async () => {
    includeEnabledEntry = true;
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
    const enabledEntry = body.workflows.find(
      (w) => w.id === "enabled-workflow",
    );
    expect(enabledEntry).toBeDefined();
    expect(enabledEntry!.available).toBe(true);
    expect(enabledEntry!.disabledReason).toBeNull();
  });

  // REG-002: the exact errorKind literal "catalog_unavailable" is returned (not a
  //          generic "error" string or an HTTP status code as text). If the route's
  //          error taxonomy changes the literal, API clients relying on this exact
  //          string break.
  test("REG-002: catalog error response contains errorKind literal exactly equal to catalog_unavailable", async () => {
    catalogShouldThrow = true;
    const { GET } = await routeModulePromise;

    const response = await GET();

    const body = (await response.json()) as Record<string, unknown>;
    // Must be the exact string "catalog_unavailable", not a variant like
    // "CATALOG_UNAVAILABLE", "catalog-unavailable", or a generic "error".
    expect(body["errorKind"]).toBe("catalog_unavailable");
    // Must also carry a human-readable message for client debugging.
    expect(typeof body["message"]).toBe("string");
    expect((body["message"] as string).length).toBeGreaterThan(0);
  });
});
