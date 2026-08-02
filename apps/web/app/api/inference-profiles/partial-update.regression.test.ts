import { describe, expect, mock, test } from "bun:test";
import type { UpdateInferenceProfileInput } from "@/lib/inference/types";

mock.module("server-only", () => ({}));

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => ({ ok: true, userId: "user-1" }),
}));

const updateCalls: UpdateInferenceProfileInput[] = [];

function lastUpdateCall(): UpdateInferenceProfileInput | undefined {
  return updateCalls.at(-1);
}

mock.module("@/lib/db/inference-profiles", () => ({
  createInferenceProfile: async () => {
    throw new Error("unexpected create call");
  },
  updateInferenceProfile: async (
    _userId: string,
    input: UpdateInferenceProfileInput,
  ) => {
    updateCalls.push(input);
    // Mirrors the persisted-record invariant: an openai-compatible profile
    // cannot end up without a base URL.
    if (input.baseUrl === null) {
      throw new Error("OpenAI-compatible profiles require a base URL");
    }
    return { id: "profile-1", name: input.name ?? "Partial Probe" };
  },
  deleteInferenceProfile: async () => true,
  listInferenceProfiles: async () => [],
  setInferenceProfileModels: async () => null,
}));

mock.module("@/lib/inference/fetch-profile-models", () => ({
  fetchInferenceProfileModels: async () => [],
}));

const routeModulePromise = import("./route");

async function patch(body: Record<string, unknown>) {
  const { PATCH } = await routeModulePromise;
  return await PATCH(
    new Request("http://localhost/api/inference-profiles", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  );
}

describe("PATCH /api/inference-profiles partial update (issue #1062)", () => {
  test("rename-only patch succeeds and does not touch baseUrl", async () => {
    const response = await patch({ profileId: "profile-1", name: "Renamed" });

    expect(response.status).toBe(200);
    expect(lastUpdateCall()?.baseUrl).toBeUndefined();
    expect(lastUpdateCall()?.name).toBe("Renamed");
  });

  test("enabled-only patch succeeds", async () => {
    const response = await patch({ profileId: "profile-1", enabled: false });

    expect(response.status).toBe(200);
    expect(lastUpdateCall()?.baseUrl).toBeUndefined();
    expect(lastUpdateCall()?.enabled).toBe(false);
  });

  test("explicitly clearing baseUrl still fails validation downstream", async () => {
    const response = await patch({ profileId: "profile-1", baseUrl: "" });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("OpenAI-compatible profiles require a base URL.");
  });

  test("a patch with no updatable field is rejected", async () => {
    const response = await patch({ profileId: "profile-1" });

    expect(response.status).toBe(400);
  });
});
