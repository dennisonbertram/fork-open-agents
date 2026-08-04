/**
 * Geometry audit: overlap, clipping, spacing uniformity, heading hierarchy,
 * and tap-target hit area — measured in the page at real viewport widths.
 *
 * "Looks right" is not machine-checkable, but a surprising amount of what makes
 * a layout look wrong IS: two siblings occupying the same pixels, a child
 * escaping its parent's box, text truncated with no ellipsis, six different
 * gap values in one stack, an h4 with no h3 above it. Those are objective, and
 * this measures them so a human only has to look at the residue.
 *
 * Deliberately paired with screenshots. This catches what geometry can prove;
 * the screenshots catch what it cannot.
 *
 * KNOWN NOISE — read these two sections as leads, not defects:
 *
 * - "Clipped": an app-shell that is `h-screen overflow-hidden` with an inner
 *   scroll area reports its content as cut off by thousands of pixels. That is
 *   the pattern working, not a defect. Only small cut values (tens of px) on a
 *   non-scrolling parent are worth investigating.
 * - "Tap targets": flags anything under 44x44, which includes deliberate compact
 *   controls like a 28px sidebar toggle and 36px-tall buttons. Real, but a
 *   design decision rather than a bug — judge per control.
 *
 * The sections that ARE trustworthy: horizontal overflow, overlapping siblings,
 * heading hierarchy, and the gap-value census. Those have no known false
 * positives after the corrections recorded below.
 */

const BASE_URL = process.env.UI_BASE_URL ?? "http://localhost:3111";
const AUTH_ROUTE = "/api/dev/managed-runtime-demo";

export const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "wide", width: 1920, height: 1080 },
] as const;

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

/**
 * agent-browser returns eval results as a JSON string literal, so the payload
 * arrives double-encoded. JSON.parse reverses that correctly; a regex that
 * strips quotes corrupts any measured label that itself contains one.
 */
function unescapeEval(raw: string): string {
  const trimmed = raw.trim();
  try {
    const once = JSON.parse(trimmed);
    return typeof once === "string" ? once : trimmed;
  } catch {
    return trimmed;
  }
}

/**
 * All measurements happen in one evaluation so every number describes the same
 * layout pass. Splitting them risks measuring across a re-render.
 */
const AUDIT_SCRIPT = String.raw`JSON.stringify((() => {
  const vw = window.innerWidth;
  const label = (el) => {
    const aria = el.getAttribute("aria-label");
    const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 32);
    const cls = typeof el.className === "string" && el.className
      ? "." + el.className.split(" ").filter(Boolean).slice(0, 2).join(".")
      : "";
    return (aria || text || el.tagName.toLowerCase() + cls).slice(0, 44);
  };
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden") return false;
    if (Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  // Scope to the app's own tree. The page also contains browser-extension DOM
  // (a devtools panel with styles-module__* classes) and Next's script tags;
  // measuring those reported 60/60 views "clipped" by an overlay that is not
  // part of this application.
  const roots = Array.from(document.body.children).filter((el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "template") return false;
    if (tag === "next-route-announcer") return false;
    // Extension panels use hashed CSS-module class names; the app uses Tailwind.
    const cls = typeof el.className === "string" ? el.className : "";
    if (/styles-module__/.test(cls)) return false;
    return true;
  });

  // Anything inside an <svg> is excluded: paths and circles overlap by design,
  // and counting them reported "overlaps" on every page in the app.
  const inSvg = (el) => el.closest("svg") !== null;
  const fromExtension = (el) =>
    el.closest('[class*="styles-module__"]') !== null;
  const all = roots
    .flatMap((root) => [root, ...Array.from(root.querySelectorAll("*"))])
    .filter((el) => !inSvg(el))
    .filter((el) => !fromExtension(el))
    .filter(visible);

  // --- overlap: siblings in normal flow sharing pixels -------------------
  const overlaps = [];
  const seen = new Set();
  for (const parent of all) {
    const kids = Array.from(parent.children).filter(visible).filter((k) => {
      const s = getComputedStyle(k);
      return s.position === "static" || s.position === "relative";
    });
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i].getBoundingClientRect();
        const b = kids[j].getBoundingClientRect();
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 2 && oy > 2) {
          const key = label(kids[i]) + "|" + label(kids[j]);
          if (seen.has(key)) continue;
          seen.add(key);
          overlaps.push(label(kids[i]) + " ∩ " + label(kids[j]) +
            " (" + Math.round(ox) + "x" + Math.round(oy) + "px)");
        }
      }
    }
  }

  // --- clipped: child escaping a parent that hides overflow --------------
  // Every clipping boundary, not just the immediate parent, and all four edges
  // — content is just as lost off the left or the bottom, and the ancestor that
  // hides overflow is often a grandparent.
  const clipped = [];
  for (const el of all) {
    const r = el.getBoundingClientRect();
    let p = el.parentElement;
    for (let d = 0; d < 4 && p && p !== document.body; d++) {
      const ps = getComputedStyle(p);
      const pr = p.getBoundingClientRect();
      if (pr.width === 0 || pr.height === 0) { p = p.parentElement; continue; }
      const clipsX = ps.overflowX === "hidden" || ps.overflowX === "clip";
      const clipsY = ps.overflowY === "hidden" || ps.overflowY === "clip";
      const edges = [];
      if (clipsX && r.right - pr.right > 4) edges.push("right by " + Math.round(r.right - pr.right));
      if (clipsX && pr.left - r.left > 4) edges.push("left by " + Math.round(pr.left - r.left));
      if (clipsY && r.bottom - pr.bottom > 4) edges.push("bottom by " + Math.round(r.bottom - pr.bottom));
      if (clipsY && pr.top - r.top > 4) edges.push("top by " + Math.round(pr.top - r.top));
      if (edges.length) {
        clipped.push(label(el) + " cut " + edges.join(", ") + "px inside " + label(p));
        break;
      }
      p = p.parentElement;
    }
  }

  // --- text truncated with no ellipsis ----------------------------------
  const truncated = [];
  for (const el of all) {
    if (el.children.length > 0) continue;
    const s = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
      if (s.textOverflow !== "ellipsis" && s.overflow !== "visible") {
        truncated.push(label(el) + " (" + el.scrollWidth + " in " + el.clientWidth + "px)");
      }
    }
  }

  // --- tap targets, with real hit area including padding -----------------
  const smallTargets = [];
  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role");
    if (!(tag === "button" || tag === "a" || role === "button" || role === "link")) continue;
    const r = el.getBoundingClientRect();
    if (r.width >= 44 && r.height >= 44) continue;
    // A small box inside a larger padded ancestor is still an easy tap.
    let hit = { w: r.width, h: r.height };
    let p = el.parentElement;
    for (let d = 0; d < 2 && p; d++) {
      const ptag = p.tagName.toLowerCase();
      const prole = p.getAttribute("role");
      // Only an ancestor that is itself the control counts. A decorative
      // wrapper centring a small icon does not enlarge the tap target, and
      // treating it as if it did under-reported real defects.
      const isControl =
        ptag === "button" || ptag === "a" || prole === "button" || prole === "link";
      if (!isControl) break;
      const pr = p.getBoundingClientRect();
      if (pr.width <= r.width + 24 && pr.height <= r.height + 24) {
        hit = { w: Math.max(hit.w, pr.width), h: Math.max(hit.h, pr.height) };
      }
      p = p.parentElement;
    }
    if (hit.w < 44 || hit.h < 44) {
      smallTargets.push(label(el) + " " + Math.round(r.width) + "x" + Math.round(r.height) +
        " (hit " + Math.round(hit.w) + "x" + Math.round(hit.h) + ")");
    }
  }

  // --- spacing uniformity: distinct gap values in flex/grid stacks -------
  const gaps = {};
  for (const el of all) {
    const s = getComputedStyle(el);
    if (s.display !== "flex" && s.display !== "grid") continue;
    if (Array.from(el.children).filter(visible).length < 2) continue;
    const g = s.gap && s.gap !== "normal" ? s.gap : null;
    if (!g) continue;
    gaps[g] = (gaps[g] || 0) + 1;
  }

  // --- heading hierarchy: skipped levels ---------------------------------
  const headingJumps = [];
  const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).filter(visible);
  let prev = 0;
  for (const h of headings) {
    const lvl = Number(h.tagName[1]);
    if (prev && lvl > prev + 1) {
      headingJumps.push("h" + prev + " → h" + lvl + " at " + label(h));
    }
    prev = lvl;
  }

  return {
    vw,
    docWidth: document.documentElement.scrollWidth,
    counts: { elements: all.length, headings: headings.length },
    overlaps: overlaps.slice(0, 6),
    clipped: clipped.slice(0, 6),
    truncated: truncated.slice(0, 6),
    smallTargets: smallTargets.slice(0, 6),
    gapValues: Object.entries(gaps).sort((a, b) => b[1] - a[1]).slice(0, 8),
    headingJumps: headingJumps.slice(0, 4),
    firstHeading: headings.length ? headings[0].tagName : null,
  };
})())`;

export type AuditResult = {
  path: string;
  viewport: string;
  width: number;
  docWidth: number;
  overflow: boolean;
  overlaps: string[];
  clipped: string[];
  truncated: string[];
  smallTargets: string[];
  gapValues: [string, number][];
  headingJumps: string[];
  firstHeading: string | null;
  elements: number;
};

export async function audit(
  path: string,
  viewport: (typeof VIEWPORTS)[number],
): Promise<AuditResult | null> {
  await browser(
    ["set", "viewport", `${viewport.width}`, `${viewport.height}`],
    30_000,
  );
  const nav = await browser(["open", `${BASE_URL}${path}`], 120_000);
  // A failed navigation leaves the previous page loaded, so measuring anyway
  // would silently attribute one page's geometry to another.
  if (nav.exitCode !== 0) return null;
  // The mobile tree only exists after hydration; measuring sooner reads the
  // desktop markup the server sent.
  await Bun.sleep(1800);

  const raw = unescapeEval((await browser(["eval", AUDIT_SCRIPT])).output);
  try {
    const p = JSON.parse(raw);
    return {
      path,
      viewport: viewport.name,
      width: viewport.width,
      docWidth: p.docWidth,
      overflow: p.docWidth > p.vw + 1,
      overlaps: p.overlaps,
      clipped: p.clipped,
      truncated: p.truncated,
      smallTargets: p.smallTargets,
      gapValues: p.gapValues,
      headingJumps: p.headingJumps,
      firstHeading: p.firstHeading,
      elements: p.counts.elements,
    };
  } catch {
    return null;
  }
}

export const PATHS = [
  "/",
  "/sessions",
  "/runs",
  "/automations",
  "/repos",
  "/settings",
  "/settings/models",
  "/settings/agents",
  "/settings/profile",
  "/loops",
  "/get-started",
  "/deploy-your-own",
  "/m",
  "/m/new",
  "/m/me",
];

if (import.meta.main) {
  await browser(["close"], 30_000);
  await browser(["open", `${BASE_URL}${AUTH_ROUTE}`], 120_000);
  await browser(["open", `${BASE_URL}/api/auth/info`], 60_000);
  const identity = unescapeEval(
    (await browser(["eval", "document.body.innerText"])).output,
  );
  if (!/"user"\s*:\s*\{/.test(identity)) {
    console.log(`Test-auth cookie not accepted at ${BASE_URL}; aborting.`);
    process.exit(1);
  }

  console.log(
    `Auditing ${PATHS.length} paths x ${VIEWPORTS.length} viewports at ${BASE_URL}\n`,
  );

  const results: AuditResult[] = [];
  for (const path of PATHS) {
    for (const viewport of VIEWPORTS) {
      const result = await audit(path, viewport);
      if (result) results.push(result);
    }
  }

  const section = (title: string, pick: (r: AuditResult) => string[]): void => {
    const hits = results.filter((r) => pick(r).length > 0);
    console.log(`\n## ${title} — ${hits.length} of ${results.length} views`);
    for (const r of hits.slice(0, 14)) {
      console.log(`  ${r.path} @ ${r.width}px`);
      for (const item of pick(r).slice(0, 4)) console.log(`      ${item}`);
    }
    if (hits.length > 14)
      console.log(`  ... and ${hits.length - 14} more views`);
  };

  const overflowing = results.filter((r) => r.overflow);
  console.log(
    `## Horizontal overflow — ${overflowing.length} of ${results.length} views`,
  );
  for (const r of overflowing) {
    console.log(`  ${r.path} @ ${r.width}px — document ${r.docWidth}px`);
  }

  section("Overlapping siblings", (r) => r.overlaps);
  section("Clipped by an overflow-hidden parent", (r) => r.clipped);
  section("Text truncated without an ellipsis", (r) => r.truncated);
  section("Tap targets under 44px (hit area included)", (r) => r.smallTargets);
  section("Skipped heading levels", (r) => r.headingJumps);

  const noH1 = results.filter((r) => r.firstHeading && r.firstHeading !== "H1");
  console.log(
    `\n## Pages whose first heading is not h1 — ${noH1.length} of ${results.length}`,
  );
  for (const r of noH1.slice(0, 10)) {
    console.log(`  ${r.path} @ ${r.width}px starts at ${r.firstHeading}`);
  }

  const allGaps = new Map<string, number>();
  for (const r of results) {
    for (const [value, count] of r.gapValues) {
      allGaps.set(value, (allGaps.get(value) ?? 0) + count);
    }
  }
  console.log(`\n## Distinct flex/grid gap values in use — ${allGaps.size}`);
  for (const [value, count] of [...allGaps]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)) {
    console.log(`  ${value.padEnd(14)} ${count}`);
  }
}
