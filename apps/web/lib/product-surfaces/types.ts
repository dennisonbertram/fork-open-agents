export type ProductSurface = "gtm" | "verifiedBuild" | "workflowCatalog";

export type ProductSurfaceExposurePolicy = Readonly<
  Record<ProductSurface, boolean>
>;

export type ProductSurfaceEnvironment = Readonly<
  Record<string, string | undefined>
>;
