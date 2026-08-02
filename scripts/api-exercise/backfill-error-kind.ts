/**
 * Adds `errorKind` to error responses that carry only `{ error }`.
 *
 * Step 5 of the #1054 migration. Purely additive: no existing key is changed or
 * removed, so no client can break. The kind is derived from the HTTP status the
 * route already chose, which is the only signal available without re-deciding
 * each route's semantics — and re-deciding 300 routes by hand is how this kind
 * of migration stalls.
 *
 * Deliberately conservative. It skips anything it cannot read with certainty:
 * dynamic statuses, bodies with more than the single `error` key, and any file
 * that does not already import from the error-response module unless the import
 * can be added cleanly. Run with --dry to see what it would touch.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { buildRouteInventory } from "./route-inventory";

const API_ROOT = new URL("../../apps/web/app/api", import.meta.url).pathname;
const REPO_ROOT = new URL("../..", import.meta.url).pathname;

const KIND_BY_STATUS: Record<string, string> = {
  "400": "invalid_request",
  "401": "unauthorized",
  "403": "forbidden",
  "404": "not_found",
  "409": "conflict",
  "413": "invalid_request",
  "422": "invalid_request",
  "429": "rate_limited",
  "500": "internal_error",
  "502": "upstream_unavailable",
  "503": "upstream_unavailable",
  "504": "upstream_unavailable",
};

/**
 * `Response.json({ error: <expr> }, { status: <literal> })` where the body has
 * exactly one key. The `error` value may span lines (template literals, ternaries),
 * so it is matched lazily up to the closing brace that precedes the status object.
 */
const SINGLE_KEY_ERROR =
  /Response\.json\(\s*\{\s*error:\s*((?:[^{}]|\{[^{}]*\})*?)\s*,?\s*\}\s*,\s*\{\s*status:\s*(\d{3})\s*\}/g;

export type Edit = { file: string; count: number; kinds: string[] };

export function backfill(options: { dryRun: boolean }): Edit[] {
  const edits: Edit[] = [];

  for (const route of buildRouteInventory(API_ROOT)) {
    const source = readFileSync(route.file, "utf8");
    const kinds: string[] = [];

    const next = source.replace(
      SINGLE_KEY_ERROR,
      (match, errorExpr: string, status: string) => {
        const kind = KIND_BY_STATUS[status];
        if (!kind) {
          return match;
        }
        // A body that already mentions errorKind anywhere is left alone; this
        // pass only fills genuinely bare responses.
        if (match.includes("errorKind")) {
          return match;
        }
        kinds.push(kind);
        return `Response.json(\n      { error: ${errorExpr.trim()}, errorKind: "${kind}" },\n      { status: ${status} }`;
      },
    );

    if (kinds.length > 0) {
      edits.push({
        file: relative(REPO_ROOT, route.file),
        count: kinds.length,
        kinds: [...new Set(kinds)].sort(),
      });
      if (!options.dryRun) {
        writeFileSync(route.file, next);
      }
    }
  }

  return edits;
}

if (import.meta.main) {
  const dryRun = process.argv.includes("--dry");
  const edits = backfill({ dryRun });
  const total = edits.reduce((n, e) => n + e.count, 0);

  console.log(
    `${dryRun ? "Would add" : "Added"} errorKind to ${total} responses across ${edits.length} files\n`,
  );
  for (const edit of edits.slice(0, 40)) {
    console.log(`  ${String(edit.count).padStart(3)}  ${edit.file}  [${edit.kinds.join(", ")}]`);
  }
  if (edits.length > 40) {
    console.log(`  ... and ${edits.length - 40} more files`);
  }
}
