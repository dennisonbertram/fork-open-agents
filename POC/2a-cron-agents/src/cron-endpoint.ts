/**
 * Cron endpoint handler — POC equivalent of `/api/cron/run`.
 *
 * Mirrors the repo's existing cron route auth convention in
 * `apps/web/app/api/background-agents/cron/route.ts`:
 *   - `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron sends), or
 *   - a fallback `x-cron-secret` header.
 * The comparison is timing-safe, matching the HMAC compare style in
 * `apps/web/app/api/github/webhook/route.ts`.
 *
 * On a valid request it queries due+enabled jobs and dispatches each via the
 * runner. Vercel invokes cron paths with GET; we accept GET and POST like the
 * real route.
 */
import { timingSafeEqual } from "node:crypto";
import { and, eq, lte, or, isNull } from "drizzle-orm";
import { isDue } from "./cron";
import { runJob, type DispatchOutcome } from "./runner";
import { scheduledJobs } from "./schema";
import type { Db } from "./db";
import type { RunAgent } from "./agent-seam";

function safeBearerEqual(authHeader: string | null, secret: string): boolean {
  if (typeof authHeader !== "string") {
    return false;
  }
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(authHeader);
  if (expected.length !== provided.length) {
    return false;
  }
  return timingSafeEqual(expected, provided);
}

function isAuthorized(req: Request, secret: string): boolean {
  if (safeBearerEqual(req.headers.get("authorization"), secret)) {
    return true;
  }
  const headerSecret = req.headers.get("x-cron-secret");
  if (headerSecret) {
    const a = Buffer.from(headerSecret);
    const b = Buffer.from(secret);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  return false;
}

export type CronResult = {
  ok: true;
  now: string;
  scanned: number;
  dispatched: number;
  outcomes: DispatchOutcome[];
};

export type CronDeps = {
  db: Db;
  secret: string;
  runAgent: RunAgent;
  /** Injectable clock for deterministic eval. */
  now?: () => Date;
};

export async function handleCron(
  req: Request,
  deps: CronDeps,
): Promise<Response> {
  if (!deps.secret) {
    return Response.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 },
    );
  }
  if (!isAuthorized(req, deps.secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = deps.now?.() ?? new Date();

  // Coarse DB filter: enabled jobs whose next_run_at is null (never run) or
  // already past. We refine with the cron parser below so we never dispatch a
  // job whose stored next_run_at is stale relative to its expression.
  const candidates = deps.db
    .select()
    .from(scheduledJobs)
    .where(
      and(
        eq(scheduledJobs.enabled, true),
        or(isNull(scheduledJobs.nextRunAt), lte(scheduledJobs.nextRunAt, now)),
      ),
    )
    .all();

  const outcomes: DispatchOutcome[] = [];
  for (const job of candidates) {
    if (!isDue(job.cronExpression, now, job.nextRunAt ?? null)) {
      continue;
    }
    outcomes.push(await runJob(deps.db, job, now, deps.runAgent));
  }

  const dispatched = outcomes.filter(
    (o) => o.status === "succeeded" || o.status === "failed",
  ).length;

  return Response.json({
    ok: true,
    now: now.toISOString(),
    scanned: candidates.length,
    dispatched,
    outcomes,
  } satisfies CronResult);
}
