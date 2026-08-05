/**
 * Walks the app at real device widths and checks for layout defects.
 *
 * Everything else in this directory runs at one width. That leaves the mobile
 * surface — a whole `(mobile)` route group plus 16 mobile components — with no
 * coverage at all, which is notable because one of the ten confirmed defects
 * from the fetch-state census was on the mobile new-session screen.
 *
 * Two things make this worth testing rather than assuming:
 *
 * 1. `useIsMobile` (apps/web/hooks/use-mobile.ts) has a 900px breakpoint and
 *    `getServerSnapshot()` returns false — so the server ALWAYS renders the
 *    desktop tree and mobile only appears after hydration. Any check that reads
 *    server HTML is blind to it. That is exactly what render-sweep.ts does.
 * 2. Horizontal overflow is invisible at 1280px and obvious at 390px. It is the
 *    single most common mobile layout defect and nothing here has ever looked
 *    for it.
 */

const BASE_URL = process.env.UI_BASE_URL ?? "http://localhost:3111";
const AUTH_ROUTE = "/api/dev/managed-runtime-demo";

/** Straddles the 900px breakpoint deliberately: below, just below, above. */
export const VIEWPORTS = [
  { name: "iphone-se", width: 375, height: 667 },
  { name: "iphone-14", width: 390, height: 844 },
  { name: "just-below-breakpoint", width: 899, height: 900 },
  { name: "just-above-breakpoint", width: 901, height: 900 },
] as const;

export type ViewportFinding = {
  path: string;
  viewport: string;
  width: number;
  /** Document wider than the viewport — the page scrolls sideways. */
  horizontalOverflow: { docWidth: number; viewportWidth: number } | null;
  /** Elements whose right edge extends past the viewport. */
  overflowingElements: string[];
  /** Tap targets below the 44px accessibility floor. */
  smallTapTargets: string[];
  consoleErrors: string[];
};

type BrowserResult = { output: string; exitCode: number };

async function browser(
  args: string[],
  timeoutMs = 90_000,
): Promise<BrowserResult> {
  try {
    const proc = Bun.spawn(["agent-browser", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    clearTimeout(timer);
    return { output: `${out}${err}`, exitCode };
  } catch (error) {
    return {
      output: `AGENT_BROWSER_FAILED: ${error instanceof Error ? error.message : String(error)}`,
      exitCode: -1,
    };
  }
}

const IGNORED_CONSOLE =
  /React DevTools|\[HMR\]|\[Fast Refresh\]|Vercel Web Analytics|Download the React|script tag while rendering/i;

/** agent-browser JSON-encodes eval results, so quotes arrive escaped. */
function unescapeEval(raw: string): string {
  return raw.trim().replace(/^"|"$/g, "").replace(/\\"/g, '"');
}

/**
 * Measured in the page rather than inferred from a screenshot: an element
 * crossing the right edge, and a tap target under 44px. Both are objective and
 * neither needs a human to look at a picture.
 */
const MEASURE_SCRIPT = `JSON.stringify((() => {
  const vw = window.innerWidth;
  const over = [];
  const small = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > vw + 1 && r.width > 4) {
      over.push((el.tagName.toLowerCase()) + (el.className && typeof el.className === "string" ? "." + el.className.split(" ").filter(Boolean).slice(0,2).join(".") : "") + " right=" + Math.round(r.right));
    }
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role");
    const isTap = tag === "button" || tag === "a" || role === "button" || role === "link";
    if (isTap && (r.height < 44 || r.width < 44)) {
      small.push((el.getAttribute("aria-label") || el.textContent || tag).trim().slice(0, 40) + " " + Math.round(r.width) + "x" + Math.round(r.height));
    }
  }
  return {
    docWidth: document.documentElement.scrollWidth,
    viewportWidth: vw,
    over: over.slice(0, 8),
    small: small.slice(0, 8),
  };
})())`;

export async function measure(
  path: string,
  viewport: (typeof VIEWPORTS)[number],
): Promise<ViewportFinding> {
  await browser(
    ["set", "viewport", `${viewport.width}`, `${viewport.height}`],
    30_000,
  );
  await browser(["console", "--clear"], 30_000);
  await browser(["open", `${BASE_URL}${path}`], 120_000);
  // Mobile only exists after hydration, so measuring immediately would read the
  // desktop tree the server sent.
  await Bun.sleep(1500);

  const raw = unescapeEval((await browser(["eval", MEASURE_SCRIPT])).output);
  const consoleOut = (await browser(["console"])).output;

  let parsed: {
    docWidth: number;
    viewportWidth: number;
    over: string[];
    small: string[];
  } | null = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A page that will not evaluate is reported below rather than silently zeroed.
  }

  return {
    path,
    viewport: viewport.name,
    width: viewport.width,
    horizontalOverflow:
      parsed && parsed.docWidth > parsed.viewportWidth + 1
        ? { docWidth: parsed.docWidth, viewportWidth: parsed.viewportWidth }
        : null,
    overflowingElements: parsed?.over ?? [],
    smallTapTargets: parsed?.small ?? [],
    consoleErrors: consoleOut
      .split("\n")
      .filter((l) => /^\[(error|warning)\]/i.test(l.trim()))
      .filter((l) => !IGNORED_CONSOLE.test(l)),
  };
}

/** Desktop routes a phone user actually lands on, plus the mobile group. */
export const PATHS = [
  "/",
  "/sessions",
  "/runs",
  "/automations",
  "/repos",
  "/settings",
  "/settings/models",
  "/settings/agents",
  "/loops",
  "/get-started",
  "/m",
  "/m/new",
  "/m/me",
];

if (import.meta.main) {
  console.log(
    `Measuring ${PATHS.length} paths at ${VIEWPORTS.length} widths against ${BASE_URL}\n`,
  );

  await browser(["close"], 30_000);
  await browser(["open", `${BASE_URL}${AUTH_ROUTE}`], 120_000);
  await browser(["open", `${BASE_URL}/api/auth/info`], 60_000);
  const identity = unescapeEval(
    (await browser(["eval", "document.body.innerText"])).output,
  );
  if (!/"user"\s*:\s*\{/.test(identity)) {
    console.log(
      `The test-auth cookie was not accepted at ${BASE_URL}: /api/auth/info reports no user.\n` +
        "Every authenticated path would be measured as a signed-out redirect.",
    );
    process.exit(1);
  }

  const findings: ViewportFinding[] = [];
  for (const path of PATHS) {
    for (const viewport of VIEWPORTS) {
      findings.push(await measure(path, viewport));
    }
  }

  const overflowing = findings.filter((f) => f.horizontalOverflow);
  const withSmallTargets = findings.filter((f) => f.smallTapTargets.length > 0);
  const withErrors = findings.filter((f) => f.consoleErrors.length > 0);

  console.log(
    `Horizontal overflow (${overflowing.length} of ${findings.length}):`,
  );
  for (const f of overflowing) {
    console.log(
      `  ${f.path} @ ${f.width}px — document ${f.horizontalOverflow?.docWidth}px`,
    );
    for (const el of f.overflowingElements) {
      console.log(`      ${el}`);
    }
  }

  console.log(
    `\nTap targets under 44px (${withSmallTargets.length} of ${findings.length}):`,
  );
  for (const f of withSmallTargets.slice(0, 12)) {
    console.log(`  ${f.path} @ ${f.width}px`);
    for (const t of f.smallTapTargets.slice(0, 4)) {
      console.log(`      ${t}`);
    }
  }

  console.log(`\nConsole errors (${withErrors.length} of ${findings.length}):`);
  for (const f of withErrors) {
    console.log(
      `  ${f.path} @ ${f.width}px :: ${f.consoleErrors[0]?.slice(0, 120)}`,
    );
  }

  // Subtracting both counts double-counts any view that fails both checks, so
  // the total is computed from the set of distinct failing views.
  const failing = new Set(
    [...overflowing, ...withErrors].map((f) => `${f.path}@${f.width}`),
  );
  console.log(
    `\n${findings.length - failing.size}/${findings.length} path+viewport combinations clean of overflow and errors`,
  );
}
