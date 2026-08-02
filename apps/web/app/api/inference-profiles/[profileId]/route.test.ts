import { describe, expect, mock, test } from "bun:test";
import type { UpdateInferenceProfileInput } from "@/lib/inference/types";

mock.module("server-only", () => ({}));

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => ({ ok: true, userId: "user-1" }),
}));

const updateCalls: UpdateInferenceProfileInput[] = [];
const deleteCalls: string[] = [];

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
    return { id: input.profileId, name: input.name ?? "Probe" };
  },
  deleteInferenceProfile: async (_userId: string, profileId: string) => {
    deleteCalls.push(profileId);
    return profileId === "profile-1";
  },
  listInferenceProfiles: async () => [
    { id: "profile-1", name: "Probe", provider: "openai-compatible" },
  ],
  setInferenceProfileModels: async () => null,
}));

mock.module("@/lib/inference/fetch-profile-models", () => ({
  fetchInferenceProfileModels: async () => [],
}));

const routeModulePromise = import("./route");

function context(profileId: string) {
  return { params: Promise.resolve({ profileId }) };
}

function request(method: string, body?: unknown) {
  return new Request("http://localhost/api/inference-profiles/profile-1", {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("per-id inference profile route", () => {
  test("GET returns the profile", async () => {
    const { GET } = await routeModulePromise;
    const response = await GET(request("GET"), context("profile-1"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      profile: {
        id: "profile-1",
        name: "Probe",
        provider: "openai-compatible",
      },
    });
  });

  test("GET returns JSON 404 for an unknown profile", async () => {
    const { GET } = await routeModulePromise;
    const response = await GET(request("GET"), context("missing"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Inference profile not found",
    });
  });

  test("rename-only PATCH succeeds and does not clear baseUrl", async () => {
    const { PATCH } = await routeModulePromise;
    const response = await PATCH(
      request("PATCH", { name: "Renamed" }),
      context("profile-1"),
    );
    expect(response.status).toBe(200);
    const call = updateCalls.at(-1);
    expect(call?.profileId).toBe("profile-1");
    expect(call?.name).toBe("Renamed");
    expect(call?.baseUrl).toBeUndefined();
  });

  test("PATCH ignores a conflicting profileId in the body", async () => {
    const { PATCH } = await routeModulePromise;
    const response = await PATCH(
      request("PATCH", { profileId: "other", name: "Renamed" }),
      context("profile-1"),
    );
    expect(response.status).toBe(200);
    expect(updateCalls.at(-1)?.profileId).toBe("profile-1");
  });

  test("PATCH with no updates is rejected", async () => {
    const { PATCH } = await routeModulePromise;
    const response = await PATCH(request("PATCH", {}), context("profile-1"));
    expect(response.status).toBe(400);
  });

  test("DELETE removes the profile without a body", async () => {
    const { DELETE } = await routeModulePromise;
    const response = await DELETE(request("DELETE"), context("profile-1"));
    expect(response.status).toBe(200);
    expect(deleteCalls.at(-1)).toBe("profile-1");
    expect(await response.json()).toEqual({ success: true });
  });

  test("DELETE returns 404 for an unknown profile", async () => {
    const { DELETE } = await routeModulePromise;
    const response = await DELETE(request("DELETE"), context("missing"));
    expect(response.status).toBe(404);
  });
});
