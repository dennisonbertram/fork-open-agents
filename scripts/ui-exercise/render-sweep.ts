/**
 * Loads every page in the app and records what the server actually returns.
 *
 * The page inventory says 42 pages can throw during server render with no
 * error boundary in their segment chain. That is a structural fact; this asks
 * whether it is reachable. Dynamic routes are requested with a well-formed but
 * nonexistent id — the most ordinary way a real user reaches a failing loader
 * (a stale link, a deleted record, a shared URL).
 *
 * HTML only, no browser: this is the cheap pass that decides whether browser
 * work is warranted.
 */
import { buildPageInventory, type PageEntry } from "./page-inventory";

const BASE_URL = process.env.UI_BASE_URL ?? "http://localhost:3111";
const TEST_AUTH_COOKIE = "open_agents_test_user_id=dev-managed-runtime-user";
const TIMEOUT_MS = 45_000;

/** Well-formed but certainly absent, per param name. */
const PARAM_VALUES: Record<string, string> = {
  username: "definitely-not-a-real-user",
  repo: "definitely-not-a-real-repo",
  owner: "definitely-not-a-real-owner",
  sessionId: "definitely-not-a-real-session",
  chatId: "definitely-not-a-real-chat",
  loopId: "definitely-not-a-real-loop",
  runId: "definitely-not-a-real-run",
  agentId: "definitely-not-a-real-agent",
  shareId: "definitely-not-a-real-share",
  profileId: "definitely-not-a-real-profile",
  learningId: "definitely-not-a-real-learning",
  serverId: "definitely-not-a-real-server",
  repoOwner: "definitely-not-a-real-owner",
  repoName: "definitely-not-a-real-repo",
  idOrName: "definitely-not-a-real-project",
};

export type SweepResult = {
  path: string;
  url: string;
  anonStatus: number | string;
  authStatus: number | string;
  authLooksLikeError: boolean;
  /** Anonymous probes get classified too — a page can fail only when logged out. */
  anonLooksLikeError: boolean;
  hasDynamicParams: boolean;
  hasErrorBoundary: boolean;
  note?: string;
};

function concretePath(page: PageEntry): string {
  return page.path.replace(
    /\[(\.\.\.)?([^\]]+)\]/g,
    (_m, _spread, name: string) => {
      return PARAM_VALUES[name] ?? `not-a-real-${name}`;
    },
  );
}

/**
 * An unhandled server-component throw. Deliberately narrow.
 *
 * The first version of this also matched `__next_error__`, which turns out to
 * be present in the HTML of a perfectly graceful `notFound()` page — it is
 * Next's marker for the not-found boundary, not a crash. That produced 22 false
 * positives, every one of them a page behaving correctly. A 404 from
 * `notFound()` and a 307 to sign-in are the right answers, not failures.
 */
function looksLikeErrorPage(html: string, status: number | string): boolean {
  if (typeof status === "number" && status >= 500) return true;
  if (typeof status !== "number") return true;
  return html.includes("Application error: a server-side exception");
}

async function load(
  url: string,
  authenticated: boolean,
): Promise<{ status: number | string; html: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: authenticated ? { cookie: TEST_AUTH_COOKIE } : {},
      redirect: "manual",
      signal: controller.signal,
    });
    return { status: response.status, html: await response.text() };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { status: aborted ? "timeout" : "network-error", html: "" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The whole authenticated half of this sweep rides on one cookie, and
 * `isTestAuthEnabled()` only honours it when NODE_ENV is development or
 * OPEN_AGENTS_ENABLE_TEST_AUTH=1. Point UI_BASE_URL at a production-mode server
 * and every "authenticated" probe is silently anonymous — the sweep still
 * reports 64 clean pages, and every one of them is a redirect to sign-in.
 *
 * A harness that cannot tell you it measured nothing is worse than no harness,
 * so this refuses to run rather than reporting false confidence.
 */
async function assertTestAuthAccepted(): Promise<void> {
  const response = await fetch(`${BASE_URL}/api/auth/info`, {
    headers: { cookie: TEST_AUTH_COOKIE },
  });
  const body = (await response.json().catch(() => null)) as {
    user?: { id?: string };
  } | null;

  if (!body?.user?.id) {
    throw new Error(
      `The test-auth cookie was not accepted at ${BASE_URL}: /api/auth/info returned no user.\n` +
        "Every authenticated probe would silently run as anonymous and the sweep would report\n" +
        "false confidence. Start the server with NODE_ENV=development, or set\n" +
        "OPEN_AGENTS_ENABLE_TEST_AUTH=1, then re-run.",
    );
  }
}

export async function runRenderSweep(): Promise<SweepResult[]> {
  await assertTestAuthAccepted();
  const results: SweepResult[] = [];

  for (const page of buildPageInventory()) {
    const path = concretePath(page);
    const url = `${BASE_URL}${path}`;
    const anon = await load(url, false);
    const auth = await load(url, true);

    results.push({
      path: page.path,
      url: path,
      anonStatus: anon.status,
      authStatus: auth.status,
      authLooksLikeError: looksLikeErrorPage(auth.html, auth.status),
      anonLooksLikeError: looksLikeErrorPage(anon.html, anon.status),
      hasDynamicParams: page.params.length > 0,
      hasErrorBoundary: page.hasErrorInChain,
    });
  }

  return results;
}

if (import.meta.main) {
  const results = await runRenderSweep();
  const broken = results.filter((r) => r.authLooksLikeError);
  const timeouts = results.filter((r) => typeof r.authStatus !== "number");

  console.log(`Loaded ${results.length} pages at ${BASE_URL}\n`);

  console.log(`Rendered an error page while authenticated: ${broken.length}`);
  for (const r of broken) {
    console.log(
      `  ${r.authStatus}  ${r.url}${r.hasErrorBoundary ? "" : "   [no error boundary]"}`,
    );
  }

  const anonBroken = results.filter(
    (r) => r.anonLooksLikeError && !r.authLooksLikeError,
  );
  console.log(
    `\nRendered an error page ONLY when anonymous: ${anonBroken.length}`,
  );
  for (const r of anonBroken) {
    console.log(`  ${r.anonStatus}  ${r.url}`);
  }

  console.log(`\nTimed out or failed to connect: ${timeouts.length}`);
  for (const r of timeouts) {
    console.log(`  ${r.authStatus}  ${r.url}`);
  }

  const byStatus = new Map<string, number>();
  for (const r of results) {
    const key = `${r.anonStatus} anon / ${r.authStatus} auth`;
    byStatus.set(key, (byStatus.get(key) ?? 0) + 1);
  }
  console.log("\nStatus pairs:");
  for (const [pair, count] of [...byStatus].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(3)}  ${pair}`);
  }
}
