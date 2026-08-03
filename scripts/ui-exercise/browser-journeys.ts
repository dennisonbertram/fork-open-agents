/**
 * Walks user journeys in a real headless browser via the agent-browser CLI.
 *
 * This is the layer the other two passes are structurally blind to. The render
 * sweep only sees server HTML; the fetch-state census only reads source. Neither
 * can tell you whether a page has interactive controls, whether it throws after
 * hydration, or whether it overflows its viewport.
 *
 * Deliberately NOT a build gate. A browser walk is slower and flakier than the
 * API journey suite, and a check that goes red for timing reasons gets ignored.
 * Run it, read it, act on it.
 */
const BASE_URL = process.env.UI_BASE_URL ?? "http://localhost:3111";
/** Hitting this route sets the synthetic test-auth cookie in the browser. */
const AUTH_ROUTE = "/api/dev/managed-runtime-demo";

export type Step = {
  /** Path to navigate to, or an element ref/selector to click. */
  goto?: string;
  click?: string;
  /** Wait for this text to appear before continuing. */
  expectText?: string;
};

export type Journey = {
  id: string;
  title: string;
  steps: Step[];
};

export type StepOutcome = {
  step: string;
  ok: boolean;
  detail: string;
};

export type JourneyOutcome = {
  id: string;
  title: string;
  steps: StepOutcome[];
  consoleErrors: string[];
  pageErrors: string[];
  horizontalOverflow: { docWidth: number; viewportWidth: number } | null;
  interactiveCount: number;
  passed: boolean;
};

async function browser(args: string[], timeoutMs = 90_000): Promise<string> {
  try {
    const proc = Bun.spawn(["agent-browser", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    clearTimeout(timer);
    return `${out}${err}`;
  } catch (error) {
    return `AGENT_BROWSER_FAILED: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** Console output that is noise in dev and would drown any real signal. */
const IGNORED_CONSOLE =
  /React DevTools|\[HMR\]|\[Fast Refresh\]|Vercel Web Analytics|Download the React/i;

async function collectDiagnostics(): Promise<{
  consoleErrors: string[];
  pageErrors: string[];
  overflow: { docWidth: number; viewportWidth: number } | null;
  interactiveCount: number;
}> {
  const consoleOut = await browser(["console"]);
  const errorsOut = await browser(["errors"]);
  const overflowRaw = await browser([
    "eval",
    "JSON.stringify({d:document.documentElement.scrollWidth,w:window.innerWidth})",
  ]);
  const snapshot = await browser(["snapshot", "-i"]);

  const consoleErrors = consoleOut
    .split("\n")
    .filter((line) => /^\[(error|warning)\]/i.test(line.trim()))
    .filter((line) => !IGNORED_CONSOLE.test(line));

  const pageErrors = errorsOut
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) => l.length > 0 && !l.startsWith("(") && !IGNORED_CONSOLE.test(l),
    );

  let overflow: { docWidth: number; viewportWidth: number } | null = null;
  const match = overflowRaw.match(/\{\\?"d\\?":(\d+),\\?"w\\?":(\d+)\}/);
  if (match) {
    const docWidth = Number(match[1]);
    const viewportWidth = Number(match[2]);
    if (docWidth > viewportWidth + 1) {
      overflow = { docWidth, viewportWidth };
    }
  }

  const interactiveCount = snapshot
    .split("\n")
    .filter((l) => /\[ref=e\d+\]/.test(l)).length;

  return { consoleErrors, pageErrors, overflow, interactiveCount };
}

export async function runJourney(journey: Journey): Promise<JourneyOutcome> {
  const steps: StepOutcome[] = [];

  // The console buffer persists across navigations, so without this a warning
  // from one journey is reported against the next one. The first run of this
  // file blamed /deploy-your-own and /get-started for a warning that only the
  // not-found page emits.
  await browser(["console", "--clear"], 30_000);

  for (const step of journey.steps) {
    if (step.goto) {
      const out = await browser(["open", `${BASE_URL}${step.goto}`], 120_000);
      const ok = !/AGENT_BROWSER_FAILED|error/i.test(out) || out.includes("✓");
      steps.push({
        step: `goto ${step.goto}`,
        ok,
        detail: out
          .split("\n")
          .filter(Boolean)
          .slice(-2)
          .join(" | ")
          .slice(0, 160),
      });
    }

    if (step.click) {
      const out = await browser(["click", step.click]);
      steps.push({
        step: `click ${step.click}`,
        ok: !/AGENT_BROWSER_FAILED|not found|No element/i.test(out),
        detail: out
          .split("\n")
          .filter(Boolean)
          .slice(-1)
          .join("")
          .slice(0, 160),
      });
    }

    if (step.expectText) {
      const out = await browser(["snapshot"]);
      const found = out.includes(step.expectText);
      steps.push({
        step: `expect "${step.expectText}"`,
        ok: found,
        detail: found ? "found" : "not present in the accessibility tree",
      });
    }
  }

  const diagnostics = await collectDiagnostics();

  return {
    id: journey.id,
    title: journey.title,
    steps,
    consoleErrors: diagnostics.consoleErrors,
    pageErrors: diagnostics.pageErrors,
    horizontalOverflow: diagnostics.overflow,
    interactiveCount: diagnostics.interactiveCount,
    passed:
      steps.every((s) => s.ok) &&
      diagnostics.consoleErrors.length === 0 &&
      diagnostics.pageErrors.length === 0 &&
      diagnostics.overflow === null,
  };
}

export const journeys: Journey[] = [
  {
    id: "BJ-NAV-01",
    title: "Sessions index, then across the primary navigation",
    steps: [
      { goto: "/sessions", expectText: "New session" },
      { goto: "/runs" },
      { goto: "/automations" },
      { goto: "/repos" },
      { goto: "/settings", expectText: "Settings" },
    ],
  },
  {
    id: "BJ-SETTINGS-01",
    title: "Settings sub-pages render with controls",
    steps: [
      { goto: "/settings/models" },
      { goto: "/settings/agents" },
      { goto: "/settings/skills" },
      { goto: "/settings/profile" },
    ],
  },
  {
    id: "BJ-LOOPS-01",
    title: "Automations and loops listing then a detail page",
    steps: [
      { goto: "/loops" },
      { goto: "/automations/new" },
      { goto: "/loops/new" },
    ],
  },
  {
    // KNOWN: this journey reports a console error on the not-found path —
    // "Encountered a script tag while rendering React component". It is NOT an
    // app defect. Every <script> on that page is _next_dist_* (Next devtools,
    // react-dom, turbopack) plus instrumentation-client; `grep -rn "<script"
    // apps/web/app --include="*.tsx"` returns nothing. It is Next's own
    // dev-mode rendering. Left visible rather than filtered, because silencing
    // a warning you have not proven harmless is how real ones get lost.
    id: "BJ-NOTFOUND-01",
    title: "A nonexistent record renders a real not-found page, not a crash",
    steps: [
      { goto: "/loops/definitely-not-a-real-loop" },
      { goto: "/sessions/definitely-not-a-real-session" },
    ],
  },
  {
    id: "BJ-PUBLIC-01",
    title: "Public surfaces",
    steps: [{ goto: "/deploy-your-own" }, { goto: "/get-started" }],
  },
];

if (import.meta.main) {
  console.log(`Walking ${journeys.length} journeys headless at ${BASE_URL}\n`);

  await browser(["close"], 30_000);
  const authOut = await browser(["open", `${BASE_URL}${AUTH_ROUTE}`], 120_000);
  if (!authOut.includes("✓")) {
    console.log(
      "Could not set the test-auth cookie — every journey would run anonymous.\n" +
        "Start the server with NODE_ENV=development or OPEN_AGENTS_ENABLE_TEST_AUTH=1.",
    );
    process.exit(1);
  }

  const outcomes: JourneyOutcome[] = [];
  for (const journey of journeys) {
    const outcome = await runJourney(journey);
    outcomes.push(outcome);
    console.log(
      `${outcome.passed ? "PASS" : "FAIL"}  ${outcome.id}  ${outcome.title}`,
    );
    for (const step of outcome.steps.filter((s) => !s.ok)) {
      console.log(`        ✗ ${step.step} :: ${step.detail}`);
    }
    for (const line of outcome.consoleErrors) {
      console.log(`        console: ${line.slice(0, 150)}`);
    }
    for (const line of outcome.pageErrors) {
      console.log(`        page error: ${line.slice(0, 150)}`);
    }
    if (outcome.horizontalOverflow) {
      console.log(
        `        horizontal overflow: document ${outcome.horizontalOverflow.docWidth}px in a ${outcome.horizontalOverflow.viewportWidth}px viewport`,
      );
    }
    console.log(
      `        ${outcome.interactiveCount} interactive elements on the final page`,
    );
  }

  const failed = outcomes.filter((o) => !o.passed).length;
  console.log(
    `\n${outcomes.length - failed}/${outcomes.length} journeys passed`,
  );
}
