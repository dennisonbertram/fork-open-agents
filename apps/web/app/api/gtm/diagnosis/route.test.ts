import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { GtmDiagnosisResponse } from "@/lib/gtm-coordinator/types";

mock.module("server-only", () => ({}));

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

const diagnosisFixture: GtmDiagnosisResponse = {
  generatedAt: "2026-06-30T12:00:00.000Z",
  source: "account_work",
  id: "signal-1",
  item: {
    id: "signal-1",
    source: "account_work",
    title: "pain: Need approval-safe agents",
    status: "draft",
    needsAttention: true,
    attentionReasons: ["draft_signal"],
    priority: "medium",
    updatedAt: "2026-06-30T11:00:00.000Z",
    summary: "Need approval-safe agents",
    diagnosisHref: "/api/gtm/diagnosis?source=account_work&id=signal-1",
  },
  sourceStatus: [{ source: "account_work", status: "healthy", itemCount: 1 }],
  evidence: [],
};

const buildDbBackedGtmDiagnosis = mock(
  async (): Promise<GtmDiagnosisResponse | null> => diagnosisFixture,
);

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/gtm-coordinator/diagnosis-store", () => ({
  buildDbBackedGtmDiagnosis,
}));

const routeModulePromise = import("./route");

describe("GET /api/gtm/diagnosis", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    buildDbBackedGtmDiagnosis.mockClear();
    buildDbBackedGtmDiagnosis.mockResolvedValue(diagnosisFixture);
  });

  test("requires authentication", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/gtm/diagnosis?source=account_work&id=signal-1",
      ),
    );

    expect(response.status).toBe(401);
    expect(buildDbBackedGtmDiagnosis).not.toHaveBeenCalled();
  });

  test("rejects unsupported sources before loading data", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/gtm/diagnosis?source=crm&id=crm-1"),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.supportedSources).toContain("account_work");
    expect(buildDbBackedGtmDiagnosis).not.toHaveBeenCalled();
  });

  test("returns 404 when the user-scoped GTM diagnosis target is not found", async () => {
    buildDbBackedGtmDiagnosis.mockResolvedValue(null);
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/gtm/diagnosis?source=account_work&id=foreign",
      ),
    );

    expect(response.status).toBe(404);
  });

  test("returns diagnosis for the authenticated user", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/gtm/diagnosis?source=account_work&id=signal-1&limit=10",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.source).toBe("account_work");
    expect(buildDbBackedGtmDiagnosis).toHaveBeenCalledWith({
      userId: "user-1",
      source: "account_work",
      id: "signal-1",
      limit: 10,
    });
  });
});
