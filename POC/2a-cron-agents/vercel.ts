/**
 * Cron registration for standing agents.
 *
 * The platform now prefers a type-safe `vercel.ts` (`@vercel/config/v1`) over
 * `vercel.json`. The repo currently registers crons in
 * `apps/web/vercel.json`:
 *
 *   { "crons": [{ "path": "/api/background-agents/cron", "schedule": "*\/5 * * * *" }] }
 *
 * To add standing agents, add a second cron entry pointing at the new route.
 * Vercel invokes the path with GET on the schedule and (when CRON_SECRET is
 * set in project env) attaches `Authorization: Bearer <CRON_SECRET>`.
 *
 * NOTE ON GRANULARITY: this `*\/1 * * * *` (every minute) cadence requires a
 * Pro/Enterprise plan. Hobby projects are limited to a small number of crons
 * that run at most once per day. The job's OWN cron expression can be finer
 * than the platform tick because due-ness is computed from next_run_at via
 * cron-parser, but the platform tick is the upper bound on how often we scan.
 *
 * NOTE: `@vercel/config` is a real-app dependency, not installed in this
 * self-contained POC, so this file is excluded from the POC `typecheck`
 * (see tsconfig.json `include`). It is the integration artifact to copy into
 * the app.
 */
import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  crons: [
    // Existing background-agents cron (kept).
    { path: "/api/background-agents/cron", schedule: "*/5 * * * *" },
    // New: standing (saved) agents scan. Scan frequency = platform tick.
    { path: "/api/cron/run", schedule: "*/5 * * * *" },
  ],
};

export default config;
