import "server-only";

import type {
  ProductSurface,
  ProductSurfaceEnvironment,
  ProductSurfaceExposurePolicy,
} from "./types";

const EXPOSURE_ENV_BY_SURFACE = {
  gtm: "OPEN_AGENTS_EXPOSE_GTM",
  verifiedBuild: "OPEN_AGENTS_EXPOSE_VERIFIED_BUILD",
  workflowCatalog: "OPEN_AGENTS_EXPOSE_WORKFLOW_CATALOG",
} as const satisfies Record<ProductSurface, string>;

function isExplicitlyEnabled(value: string | undefined): boolean {
  return value === "true";
}

export function getProductSurfaceExposurePolicy(
  env: ProductSurfaceEnvironment = process.env,
): ProductSurfaceExposurePolicy {
  return {
    gtm: isExplicitlyEnabled(env[EXPOSURE_ENV_BY_SURFACE.gtm]),
    verifiedBuild: isExplicitlyEnabled(
      env[EXPOSURE_ENV_BY_SURFACE.verifiedBuild],
    ),
    workflowCatalog: isExplicitlyEnabled(
      env[EXPOSURE_ENV_BY_SURFACE.workflowCatalog],
    ),
  };
}

export function isProductSurfaceExposed(
  surface: ProductSurface,
  env: ProductSurfaceEnvironment = process.env,
): boolean {
  return isExplicitlyEnabled(env[EXPOSURE_ENV_BY_SURFACE[surface]]);
}
