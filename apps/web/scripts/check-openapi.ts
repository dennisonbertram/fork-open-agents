#!/usr/bin/env bun
/**
 * Drift guard: fails if apps/web/openapi.json is out of sync with the
 * Zod-derived spec (lib/api/openapi-spec.ts). Mirrors db:check.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildOpenApiDocument } from "../lib/api/openapi-spec";

const outPath = join(import.meta.dir, "..", "openapi.json");
const expected = `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;

let actual = "";
try {
  actual = readFileSync(outPath, "utf8");
} catch {
  console.error(
    "openapi.json is missing. Run: bun run --cwd apps/web openapi:generate",
  );
  process.exit(1);
}

if (actual !== expected) {
  console.error(
    "openapi.json is out of date with lib/api/openapi-spec.ts.\nRun: bun run --cwd apps/web openapi:generate && bun run --cwd apps/web openapi:types",
  );
  process.exit(1);
}

console.log("✓ openapi.json is in sync with openapi-spec.ts");
