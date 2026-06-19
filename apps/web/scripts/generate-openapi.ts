#!/usr/bin/env bun
/**
 * Writes apps/web/openapi.json from the Zod-derived spec
 * (lib/api/openapi-spec.ts). Run after changing the spec, then regenerate the
 * types:
 *   bun run --cwd apps/web openapi:generate
 *   bun run --cwd apps/web openapi:types
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildOpenApiDocument } from "../lib/api/openapi-spec";

const outPath = join(import.meta.dir, "..", "openapi.json");
const json = `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;
writeFileSync(outPath, json);
console.log(`Wrote ${outPath}`);
