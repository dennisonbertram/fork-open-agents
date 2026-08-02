/**
 * Executes ordered API journeys against a running server and records the
 * observed request/response contract for each step.
 *
 * The point is to exercise the API the way a client actually does — carrying
 * ids from one response into the next request — so contract drift and
 * mistyped errors surface as failed steps rather than as a frontend bug
 * someone finds later.
 */

const BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3111";
const TEST_AUTH_COOKIE = "open_agents_test_user_id=dev-managed-runtime-user";
const DEFAULT_TIMEOUT_MS = 60_000;

export type JourneyContext = Record<string, unknown>;

export type Step = {
  name: string;
  method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
  /** May reference prior captures via `${capturedKey}` placeholders. */
  path: string | ((ctx: JourneyContext) => string);
  body?: unknown | ((ctx: JourneyContext) => unknown);
  /** Status codes considered a pass. Defaults to any 2xx. */
  expect?: number[];
  /** Pull values out of the response body into the journey context. */
  capture?: (body: unknown, ctx: JourneyContext) => void;
  /** Skip when a precondition from an earlier step is missing. */
  skipIf?: (ctx: JourneyContext) => boolean;
  anonymous?: boolean;
  timeoutMs?: number;
};

export type Journey = {
  id: string;
  title: string;
  steps: Step[];
};

export type StepResult = {
  step: string;
  method: string;
  path: string;
  status: number | string;
  ok: boolean;
  skipped: boolean;
  requestBody: unknown;
  responseKeys: string[];
  responseSample: string;
  note?: string;
};

export type JourneyResult = {
  id: string;
  title: string;
  steps: StepResult[];
  passed: boolean;
};

function resolve<T>(
  value: T | ((ctx: JourneyContext) => T),
  ctx: JourneyContext,
): T {
  return typeof value === "function"
    ? (value as (c: JourneyContext) => T)(ctx)
    : value;
}

function topLevelKeys(body: unknown): string[] {
  if (Array.isArray(body)) return ["<array>"];
  if (body && typeof body === "object") return Object.keys(body).sort();
  return [];
}

export async function runJourney(journey: Journey): Promise<JourneyResult> {
  const ctx: JourneyContext = {};
  const steps: StepResult[] = [];

  for (const step of journey.steps) {
    const path = resolve(step.path, ctx);
    const requestBody =
      step.body === undefined ? undefined : resolve(step.body, ctx);

    if (step.skipIf?.(ctx)) {
      steps.push({
        step: step.name,
        method: step.method,
        path,
        status: "skipped",
        ok: true,
        skipped: true,
        requestBody,
        responseKeys: [],
        responseSample: "",
        note: "precondition from an earlier step was not met",
      });
      continue;
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      step.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    try {
      const response = await fetch(`${BASE_URL}${path}`, {
        method: step.method,
        headers: {
          "content-type": "application/json",
          ...(step.anonymous ? {} : { cookie: TEST_AUTH_COOKIE }),
        },
        ...(requestBody === undefined
          ? {}
          : { body: JSON.stringify(requestBody) }),
        signal: controller.signal,
      });

      const text = await response.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Non-JSON responses (SSE, plain text) are recorded verbatim.
      }

      const expected = step.expect ?? [200, 201, 202, 204];
      const ok = expected.includes(response.status);
      if (ok) {
        step.capture?.(parsed, ctx);
      }

      steps.push({
        step: step.name,
        method: step.method,
        path,
        status: response.status,
        ok,
        skipped: false,
        requestBody,
        responseKeys: topLevelKeys(parsed),
        responseSample: text.slice(0, 500),
        ...(ok ? {} : { note: `expected one of ${expected.join("/")}` }),
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      steps.push({
        step: step.name,
        method: step.method,
        path,
        status: aborted ? "timeout" : "network-error",
        ok: false,
        skipped: false,
        requestBody,
        responseKeys: [],
        responseSample:
          error instanceof Error ? error.message.slice(0, 300) : String(error),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    id: journey.id,
    title: journey.title,
    steps,
    passed: steps.every((s) => s.ok),
  };
}

export function formatJourneyMarkdown(result: JourneyResult): string {
  const lines = [
    `## ${result.id}: ${result.title}`,
    "",
    `Result: **${result.passed ? "PASS" : "FAIL"}** (${result.steps.filter((s) => s.ok && !s.skipped).length} passed, ${result.steps.filter((s) => !s.ok).length} failed, ${result.steps.filter((s) => s.skipped).length} skipped)`,
    "",
    "| # | Step | Call | Status | Response keys |",
    "| - | ---- | ---- | ------ | ------------- |",
  ];
  result.steps.forEach((step, index) => {
    const mark = step.skipped ? "—" : step.ok ? "✓" : "✗";
    lines.push(
      `| ${index + 1} | ${mark} ${step.step} | \`${step.method} ${step.path}\` | ${step.status} | ${step.responseKeys.join(", ") || "—"} |`,
    );
  });
  const failures = result.steps.filter((s) => !s.ok);
  if (failures.length > 0) {
    lines.push("", "### Failures", "");
    for (const failure of failures) {
      lines.push(
        `- **${failure.step}** — \`${failure.method} ${failure.path}\` returned ${failure.status}${failure.note ? ` (${failure.note})` : ""}`,
        `  \`\`\``,
        `  ${failure.responseSample.replace(/\n/g, " ").slice(0, 300)}`,
        `  \`\`\``,
      );
    }
  }
  return lines.join("\n");
}
