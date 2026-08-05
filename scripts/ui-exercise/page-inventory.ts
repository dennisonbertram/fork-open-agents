/**
 * Builds the page inventory by reading the App Router file tree.
 *
 * The API harness learned this the hard way: a hand-maintained list drifts, and
 * a regex that misses one export silently drops a whole route. So the surface
 * is derived from disk, and every per-page fact below is read from the file
 * rather than assumed.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const APP_ROOT = new URL("../../apps/web/app", import.meta.url).pathname;

export type PageEntry = {
  /** URL path with [param] segments intact, route groups removed. */
  path: string;
  file: string;
  params: string[];
  isClientComponent: boolean;
  /** Nearest loading.tsx / error.tsx / not-found.tsx walking up to app root. */
  hasLoadingInChain: boolean;
  hasErrorInChain: boolean;
  hasNotFoundInChain: boolean;
  /** Present in this exact segment, not inherited. */
  hasOwnLoading: boolean;
  hasOwnError: boolean;
  /** Components imported from this page, resolved to files that exist. */
  localImports: string[];
};

function walkPages(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // API routes are the other harness's problem.
      if (entry === "api") continue;
      walkPages(full, out);
    } else if (entry === "page.tsx" || entry === "page.ts") {
      out.push(full);
    }
  }
  return out;
}

function toUrlPath(file: string): string {
  const rel = relative(APP_ROOT, dirname(file));
  const segments = rel
    .split("/")
    .filter((s) => s.length > 0 && !(s.startsWith("(") && s.endsWith(")")));
  return `/${segments.join("/")}`;
}

/** Walks from the page's directory up to the app root looking for `name`. */
function foundInChain(pageFile: string, name: string): boolean {
  let dir = dirname(pageFile);
  while (dir.startsWith(APP_ROOT)) {
    if (existsSync(join(dir, name))) return true;
    if (dir === APP_ROOT) break;
    dir = dirname(dir);
  }
  return false;
}

function localImportsOf(source: string): string[] {
  return [...source.matchAll(/from\s+"(@\/[^"]+|\.\.?\/[^"]+)"/g)].map(
    (m) => m[1] as string,
  );
}

export function buildPageInventory(): PageEntry[] {
  return walkPages(APP_ROOT)
    .map((file) => {
      const source = readFileSync(file, "utf8");
      const path = toUrlPath(file);
      const dir = dirname(file);
      return {
        path,
        file: relative(APP_ROOT, file),
        params: [...path.matchAll(/\[(\.\.\.)?([^\]]+)\]/g)].map(
          (m) => m[2] as string,
        ),
        isClientComponent: /^\s*"use client"/m.test(source),
        hasLoadingInChain: foundInChain(file, "loading.tsx"),
        hasErrorInChain: foundInChain(file, "error.tsx"),
        hasNotFoundInChain: foundInChain(file, "not-found.tsx"),
        hasOwnLoading: existsSync(join(dir, "loading.tsx")),
        hasOwnError: existsSync(join(dir, "error.tsx")),
        localImports: localImportsOf(source),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

if (import.meta.main) {
  const pages = buildPageInventory();
  console.log(`${pages.length} pages\n`);

  const noError = pages.filter((p) => !p.hasErrorInChain);
  const noLoading = pages.filter((p) => !p.hasLoadingInChain);

  console.log(
    `Reachable error boundary in the segment chain: ${pages.length - noError.length}/${pages.length}`,
  );
  console.log(
    `Reachable loading state in the segment chain:  ${pages.length - noLoading.length}/${pages.length}`,
  );
  console.log(
    `Client-component pages: ${pages.filter((p) => p.isClientComponent).length}`,
  );
  console.log(
    `Pages with dynamic params: ${pages.filter((p) => p.params.length > 0).length}\n`,
  );

  console.log(
    `Pages with NO error boundary anywhere in the chain (${noError.length}):`,
  );
  for (const page of noError) {
    console.log(`  ${page.path}`);
  }

  console.log(
    `\nPages with NO loading state anywhere in the chain (${noLoading.length}):`,
  );
  for (const page of noLoading.slice(0, 25)) {
    console.log(`  ${page.path}`);
  }
  if (noLoading.length > 25)
    console.log(`  ... and ${noLoading.length - 25} more`);
}
