/**
 * vercel.json cron registration — RED / regression test (issue #758, ticket #764)
 *
 * BUG: /api/agent-loops/sweep (app/api/agent-loops/sweep/route.ts) is fully
 * implemented and accepts GET with the cron secret, but is absent from
 * apps/web/vercel.json's `crons` array. A wedged loop run is never
 * auto-recovered in production because the sweep route is never invoked.
 *
 * This test parses vercel.json directly so a future edit that silently drops
 * the entry (or the schedule) is caught in CI without needing a live Vercel
 * deploy.
 */

import { describe, expect, test } from "bun:test";
import vercelConfig from "./vercel.json";

type CronEntry = { path: string; schedule: string };

describe("vercel.json crons — agent-loops sweep registration", () => {
  test("includes a cron entry for /api/agent-loops/sweep on a 5-minute schedule", () => {
    const crons = vercelConfig.crons as CronEntry[];
    expect(Array.isArray(crons)).toBe(true);

    const sweepCron = crons.find(
      (cron) => cron.path === "/api/agent-loops/sweep",
    );

    expect(sweepCron).toBeDefined();
    expect(sweepCron?.schedule).toBe("*/5 * * * *");
  });

  test("still includes the existing background-agents cron entry (no regression)", () => {
    const crons = vercelConfig.crons as CronEntry[];
    const backgroundAgentsCron = crons.find(
      (cron) => cron.path === "/api/background-agents/cron",
    );

    expect(backgroundAgentsCron).toBeDefined();
    expect(backgroundAgentsCron?.schedule).toBe("*/5 * * * *");
  });
});

/**
 * Same failure shape as #758, for the model price sync.
 *
 * `model_prices` starts empty, and nothing else populates it. If the route
 * ships without its cron entry, every usage event is written with
 * `pricing_status = 'unknown_model'` and a NULL cost — cost instrumentation
 * that is fully installed, passes its own tests, and reports nothing forever.
 */
describe("vercel.json crons — model price sync registration", () => {
  test("includes a daily cron entry for /api/usage/price-sync", () => {
    const crons = vercelConfig.crons as CronEntry[];

    const priceSyncCron = crons.find(
      (cron) => cron.path === "/api/usage/price-sync",
    );

    expect(priceSyncCron).toBeDefined();
    // Published vendor rates change on the order of months, not minutes; daily
    // is frequent enough and keeps the price book's history readable.
    expect(priceSyncCron?.schedule).toBe("0 6 * * *");
  });
});
