/**
 * Builds the HTTP route inventory by reading the App Router file tree.
 *
 * Derived from the filesystem rather than a hand-maintained list so the
 * exercise harness cannot silently drift behind new routes.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export type RouteMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

export type RouteEntry = {
  /** URL path with [param] segments left intact. */
  path: string;
  methods: RouteMethod[];
  /** Dynamic segment names, in order of appearance. */
  params: string[];
  file: string;
};

const METHODS: RouteMethod[] = ["GET", "POST", "PATCH", "PUT", "DELETE"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (entry === "route.ts" || entry === "route.tsx") {
      out.push(full);
    }
  }
  return out;
}

function toUrlPath(file: string, apiRoot: string): string {
  const rel = relative(apiRoot, file).replace(/\/route\.tsx?$/, "");
  const segments = rel
    .split("/")
    // Route groups like (dashboard) do not appear in the URL.
    .filter((segment) => segment.length > 0 && !segment.startsWith("("));
  return `/api${segments.length ? `/${segments.join("/")}` : ""}`;
}

export function buildRouteInventory(apiRoot: string): RouteEntry[] {
  return walk(apiRoot)
    .map((file) => {
      const source = readFileSync(file, "utf8");
      // Handlers are also exported by destructuring — the Better Auth
      // catch-all uses `export const { GET, POST } = toNextJsHandler(auth)`.
      // Missing that form silently drops whole routes from the inventory.
      const destructured = new Set<string>();
      for (const match of source.matchAll(
        /export\s+const\s*\{([^}]*)\}\s*=/g,
      )) {
        for (const name of (match[1] as string).split(",")) {
          destructured.add(name.split(":")[0]?.trim() ?? "");
        }
      }

      const methods = METHODS.filter(
        (method) =>
          new RegExp(
            `export\\s+(?:async\\s+)?(?:function\\s+${method}\\b|const\\s+${method}\\b)`,
          ).test(source) || destructured.has(method),
      );
      const path = toUrlPath(file, apiRoot);
      const params = [...path.matchAll(/\[(\.\.\.)?([^\]]+)\]/g)].map(
        (match) => match[2] as string,
      );
      return { path, methods, params, file };
    })
    .filter((route) => route.methods.length > 0)
    .sort((a, b) => a.path.localeCompare(b.path));
}
