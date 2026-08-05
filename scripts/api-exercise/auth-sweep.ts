/**
 * Baseline API sweep: calls every parameterless route with and without a
 * session and records what comes back.
 *
 * Two questions it answers that no unit test does:
 *   1. Does every route that reads user data actually require a session?
 *   2. Do error responses share one shape the frontend can rely on?
 *
 * Run against a local server only — it issues real writes on POST routes.
 */
import { buildRouteInventory, type RouteMethod } from "./route-inventory";

const BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3111";
const API_ROOT = new URL("../../apps/web/app/api", import.meta.url).pathname;
const TEST_AUTH_COOKIE = "open_agents_test_user_id=dev-managed-runtime-user";
const REQUEST_TIMEOUT_MS = 20_000;

export type ProbeResult = {
  path: string;
  method: RouteMethod;
  anonStatus: number | string;
  authStatus: number | string;
  anonBody: string;
  authBody: string;
  errorShape: string | null;
};

function summarizeErrorShape(
  body: string,
  status: number | string,
): string | null {
  if (typeof status !== "number" || status < 400) {
    return null;
  }
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    return Object.keys(parsed).sort().join(",") || "<empty object>";
  } catch {
    return "<non-json>";
  }
}

async function probe(
  path: string,
  method: RouteMethod,
  authenticated: boolean,
): Promise<{ status: number | string; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(authenticated ? { cookie: TEST_AUTH_COOKIE } : {}),
      },
      // Every write route is probed with an empty object so the request is
      // well-formed JSON; routes that need real fields answer 400, which is
      // itself the contract being recorded.
      ...(method === "GET" || method === "DELETE" ? {} : { body: "{}" }),
      signal: controller.signal,
    });
    return {
      status: response.status,
      body: (await response.text()).slice(0, 400),
    };
  } catch (error) {
    return {
      status:
        error instanceof Error && error.name === "AbortError"
          ? "timeout"
          : "network-error",
      body:
        error instanceof Error ? error.message.slice(0, 200) : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runAuthSweep(
  options: { includeWrites?: boolean } = {},
): Promise<ProbeResult[]> {
  const routes = buildRouteInventory(API_ROOT).filter(
    (route) => route.params.length === 0,
  );
  const results: ProbeResult[] = [];

  for (const route of routes) {
    for (const method of route.methods) {
      if (method !== "GET" && !options.includeWrites) {
        continue;
      }
      const anon = await probe(route.path, method, false);
      const auth = await probe(route.path, method, true);
      results.push({
        path: route.path,
        method,
        anonStatus: anon.status,
        authStatus: auth.status,
        anonBody: anon.body,
        authBody: auth.body,
        errorShape:
          summarizeErrorShape(auth.body, auth.status) ??
          summarizeErrorShape(anon.body, anon.status),
      });
    }
  }

  return results;
}

if (import.meta.main) {
  const includeWrites = process.argv.includes("--writes");
  const results = await runAuthSweep({ includeWrites });

  console.log(`Probed ${results.length} route/method pairs at ${BASE_URL}\n`);

  const anonReadable = results.filter(
    (r) => typeof r.anonStatus === "number" && r.anonStatus < 400,
  );
  console.log(`Reachable without a session (${anonReadable.length}):`);
  for (const r of anonReadable) {
    console.log(`  ${r.anonStatus} ${r.method} ${r.path}`);
  }

  const shapes = new Map<string, string[]>();
  for (const r of results) {
    if (!r.errorShape) continue;
    const list = shapes.get(r.errorShape) ?? [];
    list.push(`${r.method} ${r.path}`);
    shapes.set(r.errorShape, list);
  }
  console.log(`\nError body shapes (${shapes.size} distinct):`);
  for (const [shape, paths] of [...shapes].sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    console.log(`  ${shape}  (${paths.length})`);
    if (paths.length <= 6) {
      for (const p of paths) console.log(`      ${p}`);
    }
  }

  const broken = results.filter(
    (r) => typeof r.authStatus !== "number" || r.authStatus >= 500,
  );
  console.log(`\nServer errors or timeouts (${broken.length}):`);
  for (const r of broken) {
    console.log(
      `  ${r.authStatus} ${r.method} ${r.path} :: ${r.authBody.slice(0, 160)}`,
    );
  }
}
