/**
 * Static census of every error response body shape returned by the API.
 *
 * The frontend has to branch on these bodies, so every distinct shape is a
 * separate thing a client must know about. This counts them so divergence is
 * visible instead of being discovered one 500 at a time.
 */
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { buildRouteInventory } from "./route-inventory";

const API_ROOT = new URL("../../apps/web/app/api", import.meta.url).pathname;
const REPO_ROOT = new URL("../..", import.meta.url).pathname;

export type ErrorResponse = {
  file: string;
  keys: string[];
  status: string;
};

/**
 * Matches `Response.json({ ...literal... }, { status: NNN ... })` including
 * multi-line bodies. Only object literals are captured; a spread or variable
 * body is reported as `<dynamic>` rather than silently skipped.
 */
const RESPONSE_JSON =
  /Response\.json\(\s*(\{[\s\S]*?\})\s*,\s*\{[^}]*status:\s*(\d{3}|[A-Za-z_][\w.]*)/g;

function extractTopLevelKeys(literal: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let current = "";
  // Walk the literal so keys of nested objects are not mistaken for top-level.
  for (const char of literal) {
    if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") depth--;
    if (depth === 1) current += char;
  }
  for (const match of current.matchAll(
    /(?:^|[,{])\s*(?:\.\.\.)?([A-Za-z_][\w]*)\s*:/g,
  )) {
    keys.push(match[1] as string);
  }
  if (/\.\.\./.test(current) && keys.length === 0) {
    return ["<dynamic>"];
  }
  return [...new Set(keys)].sort();
}

export function censusErrorShapes(): ErrorResponse[] {
  const found: ErrorResponse[] = [];
  for (const route of buildRouteInventory(API_ROOT)) {
    const source = readFileSync(route.file, "utf8");
    for (const match of source.matchAll(RESPONSE_JSON)) {
      const status = match[2] as string;
      const numeric = Number.parseInt(status, 10);
      if (Number.isFinite(numeric) && numeric < 400) continue;
      found.push({
        file: relative(REPO_ROOT, route.file),
        keys: extractTopLevelKeys(match[1] as string),
        status,
      });
    }
  }
  return found;
}

if (import.meta.main) {
  const responses = censusErrorShapes();
  const byShape = new Map<string, ErrorResponse[]>();
  for (const response of responses) {
    const shape = response.keys.join(",") || "<empty>";
    byShape.set(shape, [...(byShape.get(shape) ?? []), response]);
  }

  console.log(
    `${responses.length} error responses across the API, in ${byShape.size} distinct body shapes\n`,
  );
  for (const [shape, entries] of [...byShape].sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    console.log(`{ ${shape} }  ×${entries.length}`);
    if (entries.length <= 8) {
      for (const entry of entries) {
        console.log(`    ${entry.status}  ${entry.file}`);
      }
    }
  }

  const statuses = new Map<string, number>();
  for (const response of responses) {
    statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
  }
  console.log("\nStatus codes used:");
  for (const [status, count] of [...statuses].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status}: ${count}`);
  }
}
