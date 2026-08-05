/**
 * Regression coverage for #1123.
 *
 * The settings default-model write path used to persist the composite
 * "user-profile:<inferenceProfileId>:<modelId>" option id whole into
 * user_preferences.default_model_id, leaving default_inference_profile_id NULL.
 * Every chat created from that preference then handed the internal composite id
 * to the Vercel AI Gateway, which answered "Model not found".
 *
 * updateUserPreferences is the single write funnel for both fields, so it must
 * split the composite exactly the way the chat model-switch handler does.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let existingRows: Array<Record<string, unknown>> = [];
let lastUpdateSet: Record<string, unknown> | null = null;
let lastInsertValues: Record<string, unknown> | null = null;

mock.module("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => existingRows,
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        lastUpdateSet = values;
        return {
          where: () => ({
            returning: async () => [{ ...existingRows[0], ...values }],
          }),
        };
      },
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        lastInsertValues = values;
        return {
          returning: async () => [values],
        };
      },
    }),
  },
}));

mock.module("nanoid", () => ({ nanoid: () => "prefs-id" }));

const { updateUserPreferences } = await import("@/lib/db/user-preferences");

const USER_ID = "user-1";
const COMPOSITE_ID = "user-profile:mw51n3rR9QQZqf6Boe42i:zai-glm-4.7";

beforeEach(() => {
  existingRows = [];
  lastUpdateSet = null;
  lastInsertValues = null;
});

describe("updateUserPreferences default model option id", () => {
  test("splits a user-profile option id into modelId + inferenceProfileId on update", async () => {
    existingRows = [
      {
        id: "prefs-id",
        userId: USER_ID,
        defaultModelId: "openai/gpt-5.4",
        defaultInferenceProfileId: null,
      },
    ];

    const result = await updateUserPreferences(USER_ID, {
      defaultModelId: COMPOSITE_ID,
    });

    expect(lastUpdateSet).toMatchObject({
      defaultModelId: "zai-glm-4.7",
      defaultInferenceProfileId: "mw51n3rR9QQZqf6Boe42i",
    });
    expect(result.defaultModelId).toBe("zai-glm-4.7");
    expect(result.defaultInferenceProfileId).toBe("mw51n3rR9QQZqf6Boe42i");
  });

  test("splits a user-profile option id on the first-write (insert) arm", async () => {
    existingRows = [];

    const result = await updateUserPreferences(USER_ID, {
      defaultModelId: COMPOSITE_ID,
    });

    expect(lastInsertValues).toMatchObject({
      defaultModelId: "zai-glm-4.7",
      defaultInferenceProfileId: "mw51n3rR9QQZqf6Boe42i",
    });
    expect(result.defaultInferenceProfileId).toBe("mw51n3rR9QQZqf6Boe42i");
  });

  test("stores a plain gateway model id unchanged with a null profile id", async () => {
    existingRows = [
      {
        id: "prefs-id",
        userId: USER_ID,
        defaultModelId: "zai-glm-4.7",
        defaultInferenceProfileId: "mw51n3rR9QQZqf6Boe42i",
      },
    ];

    const result = await updateUserPreferences(USER_ID, {
      defaultModelId: "openai/gpt-5.4",
    });

    expect(lastUpdateSet).toMatchObject({
      defaultModelId: "openai/gpt-5.4",
      defaultInferenceProfileId: null,
    });
    expect(result.defaultModelId).toBe("openai/gpt-5.4");
    expect(result.defaultInferenceProfileId).toBeNull();
  });

  test("leaves the stored profile id alone when defaultModelId is not being updated", async () => {
    existingRows = [
      {
        id: "prefs-id",
        userId: USER_ID,
        defaultModelId: "zai-glm-4.7",
        defaultInferenceProfileId: "mw51n3rR9QQZqf6Boe42i",
      },
    ];

    await updateUserPreferences(USER_ID, { alertsEnabled: false });

    expect(lastUpdateSet).not.toHaveProperty("defaultInferenceProfileId");
    expect(lastUpdateSet).not.toHaveProperty("defaultModelId");
  });
});
