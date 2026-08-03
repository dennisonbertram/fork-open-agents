/**
 * Census of loading / error / empty states on client-side data surfaces.
 *
 * The render sweep loads HTML and therefore cannot see any of this: pages are
 * server components that render client components which fetch with SWR, so
 * every interesting failure state happens after hydration.
 *
 * This is a STATIC HEURISTIC and it will be wrong in both directions — a
 * component can render an error state through a child, or name its variables
 * something this does not recognise. Treat the output as a list of candidates
 * to open and read, not as a defect list. The previous tool in this directory
 * reported 22 broken pages that were all fine; the lesson is to say what a
 * measurement cannot see.
 */
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { Glob } from "bun";

const WEB_ROOT = new URL("../../apps/web", import.meta.url).pathname;
const REPO_ROOT = new URL("../..", import.meta.url).pathname;

export type FetchSurface = {
  file: string;
  hookCount: number;
  handlesLoading: boolean;
  handlesError: boolean;
  handlesEmpty: boolean;
  /** Renders a child that likely owns the states (skeleton/empty component). */
  delegatesToChild: boolean;
};

/** Loading: any read of the SWR loading flags in a render decision. */
const LOADING = /\bis(?:Loading|Validating)\b/;

/**
 * Error: the SWR `error` field being read, not merely destructured. Requires it
 * next to a branch or a JSX usage so `const { error } = useSWR(...)` alone does
 * not count as handled.
 */
const ERROR_HANDLED =
  /(?:\berror\s*(?:\?\.|&&|\?|\|\||===|!==)|\{\s*error\s*&&|if\s*\(\s*\w*[eE]rror\b|\bhasError\b|\bloadError\b|\bisError\b)/;

/** Empty: an explicit zero-length check or empty-state copy/component. */
const EMPTY =
  /(\.length\s*===\s*0|\.length\s*>\s*0|\.length\s*\?|!\w+\.length|\bEmptyState\b|\bempty-state\b|No\s+\w+\s+yet|None\s+yet)/;

/** A child component that conventionally owns the states. */
const DELEGATES =
  /\b\w*(?:Skeleton|EmptyState|ErrorState|Fallback|Placeholder)\b/;

/**
 * A hook that spreads its SWR result (`return { ...swr, ... }`) hands `error`
 * to its caller untouched, so it is not swallowing anything. Missing this
 * produced a false positive on use-runs-list.ts.
 */
const SPREADS_SWR = /return\s*\{\s*\.\.\.\s*\w*(?:swr|query|result)\w*/i;

export async function censusFetchSurfaces(): Promise<FetchSurface[]> {
  const surfaces: FetchSurface[] = [];
  const glob = new Glob("**/*.{ts,tsx}");

  for await (const rel of glob.scan({ cwd: WEB_ROOT })) {
    if (
      rel.includes("node_modules") ||
      rel.includes(".next") ||
      rel.includes("/api/") ||
      /\.test\.|\.spec\./.test(rel)
    ) {
      continue;
    }
    const full = `${WEB_ROOT}/${rel}`;
    const source = readFileSync(full, "utf8");
    const hookCount = [...source.matchAll(/\buseSWR\w*\s*[(<]/g)].length;
    if (hookCount === 0) continue;

    surfaces.push({
      file: relative(REPO_ROOT, full),
      hookCount,
      handlesLoading: LOADING.test(source),
      handlesError: ERROR_HANDLED.test(source) || SPREADS_SWR.test(source),
      handlesEmpty: EMPTY.test(source),
      delegatesToChild: DELEGATES.test(source),
    });
  }

  return surfaces.sort((a, b) => a.file.localeCompare(b.file));
}

if (import.meta.main) {
  const surfaces = await censusFetchSurfaces();
  const missingError = surfaces.filter((s) => !s.handlesError);
  const missingLoading = surfaces.filter(
    (s) => !s.handlesLoading && !s.delegatesToChild,
  );
  const missingEmpty = surfaces.filter(
    (s) => !s.handlesEmpty && !s.delegatesToChild,
  );

  console.log(
    `${surfaces.length} files fetch with SWR (${surfaces.reduce((n, s) => n + s.hookCount, 0)} hook calls)\n`,
  );
  console.log(
    `  handles a loading state: ${surfaces.length - missingLoading.length}/${surfaces.length}`,
  );
  console.log(
    `  handles an error state:  ${surfaces.length - missingError.length}/${surfaces.length}`,
  );
  console.log(
    `  handles an empty state:  ${surfaces.length - missingEmpty.length}/${surfaces.length}`,
  );

  console.log(
    `\nNo error handling detected (${missingError.length}) — candidates to read:`,
  );
  for (const s of missingError) {
    console.log(
      `  ${s.file}  (${s.hookCount} hook${s.hookCount === 1 ? "" : "s"})`,
    );
  }

  console.log(`\nNo loading state detected (${missingLoading.length}):`);
  for (const s of missingLoading.slice(0, 15)) {
    console.log(`  ${s.file}`);
  }
  if (missingLoading.length > 15) {
    console.log(`  ... and ${missingLoading.length - 15} more`);
  }

  console.log(
    "\nHeuristic. Confirm each candidate by reading it before treating it as a defect.",
  );
}
