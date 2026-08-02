import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => ({ ok: true, userId: "user-1" }),
}));

let createError: unknown = null;
let updateError: unknown = null;

mock.module("@/lib/db/inference-profiles", () => ({
  createInferenceProfile: async () => {
    if (createError) {
      throw createError;
    }
    throw new Error("unexpected create call");
  },
  updateInferenceProfile: async () => {
    if (updateError) {
      throw updateError;
    }
    throw new Error("unexpected update call");
  },
  deleteInferenceProfile: async () => true,
  listInferenceProfiles: async () => [],
  setInferenceProfileModels: async () => null,
}));

mock.module("@/lib/inference/fetch-profile-models", () => ({
  fetchInferenceProfileModels: async () => [],
}));

/**
 * drizzle-orm wraps driver errors in DrizzleQueryError, whose own message is
 * "Failed query: ...\nparams: ..." — the postgres unique-violation text only
 * exists on `cause`.
 */
function drizzleUniqueViolation(): Error {
  const pgError = Object.assign(
    new Error(
      'duplicate key value violates unique constraint "inference_profiles_user_name_idx"',
    ),
    { code: "23505" },
  );
  const wrapped = new Error(
    'Failed query: insert into "inference_profiles" ...\nparams: Probe A1,openai-compatible',
  );
  Object.assign(wrapped, { query: "insert into ...", cause: pgError });
  return wrapped;
}

const routeModulePromise = import("./route");

const createBody = {
  name: "Probe A1",
  provider: "openai-compatible",
  baseUrl: "https://api.example.com/v1",
  apiKey: "sk-probe",
};

describe("/api/inference-profiles duplicate name", () => {
  beforeEach(() => {
    createError = null;
    updateError = null;
  });

  test("POST returns 409 with a name-conflict message", async () => {
    createError = drizzleUniqueViolation();
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/inference-profiles", {
        method: "POST",
        body: JSON.stringify(createBody),
      }),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(body.error).toBe(
      "An inference profile with that name already exists.",
    );
  });

  test("PATCH rename conflict returns 409", async () => {
    updateError = drizzleUniqueViolation();
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      new Request("http://localhost/api/inference-profiles", {
        method: "PATCH",
        body: JSON.stringify({ profileId: "p1", name: "Probe A1" }),
      }),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(body.error).toBe(
      "An inference profile with that name already exists.",
    );
  });

  test("other save failures stay 400", async () => {
    createError = new Error("connection terminated unexpectedly");
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/inference-profiles", {
        method: "POST",
        body: JSON.stringify(createBody),
      }),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Failed to save inference profile.");
  });
});
