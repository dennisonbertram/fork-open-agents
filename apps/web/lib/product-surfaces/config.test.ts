import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const configModulePromise = import("./config");

describe("product surface exposure policy", () => {
  test("defaults every experimental product surface off", async () => {
    const { getProductSurfaceExposurePolicy } = await configModulePromise;

    expect(getProductSurfaceExposurePolicy({})).toEqual({
      gtm: false,
      verifiedBuild: false,
      workflowCatalog: false,
    });
  });

  test("enables only explicit true values", async () => {
    const { getProductSurfaceExposurePolicy } = await configModulePromise;

    expect(
      getProductSurfaceExposurePolicy({
        OPEN_AGENTS_EXPOSE_GTM: "true",
        OPEN_AGENTS_EXPOSE_VERIFIED_BUILD: "1",
        OPEN_AGENTS_EXPOSE_WORKFLOW_CATALOG: "TRUE",
      }),
    ).toEqual({
      gtm: true,
      verifiedBuild: false,
      workflowCatalog: false,
    });
  });

  test("keeps runtime capability independent from product exposure", async () => {
    const { isProductSurfaceExposed } = await configModulePromise;

    const env = {
      HARNESS_ENABLED: "true",
      OPEN_AGENTS_EXPOSE_VERIFIED_BUILD: "false",
    };

    expect(isProductSurfaceExposed("verifiedBuild", env)).toBe(false);
  });
});
