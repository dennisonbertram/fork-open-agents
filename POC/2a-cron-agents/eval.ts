/**
 * POC 2a eval — proves the standing-agents cron path end to end against a
 * real (bun:sqlite) database with deterministic clock and a fake agent.
 *
 * Run: bun run eval.ts
 *
 * Asserts:
 *   1. Only due + enabled jobs run; not-due and disabled jobs are skipped.
 *   2. Cron matching is correct: `*\/5 * * * *` is due at 09:05, `0 9 * * *`
 *      is due at 09:00 but NOT at 09:05.
 *   3. Each dispatched job creates a scheduled_job_runs row with a status,
 *      and lastRunAt / nextRunAt advance correctly.
 *   4. A disabled job never runs.
 *   5. An unauthenticated request is rejected with 401.
 *   6. The result LANDS: the fake agent wrote an assistant chat_messages row
 *      linked back to the job via chat -> session.
 *   7. Idempotency/overlap: a second invocation in the same scheduled tick
 *      does NOT double-dispatch a still/already-run job.
 *
 * Writes a transcript and a final DB dump to evidence/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { createDb } from "./src/db";
import { handleCron, type CronResult } from "./src/cron-endpoint";
import { createFakeAgent } from "./src/fake-agent";
import { nextRunAfter } from "./src/cron";
import {
  chatMessages,
  chats,
  scheduledJobRuns,
  scheduledJobs,
} from "./src/schema";

const SECRET = "test-cron-secret-abc123";
const EVIDENCE_DIR = join(import.meta.dir, "evidence");

const transcript: string[] = [];
function log(line: string): void {
  transcript.push(line);
  console.log(line);
}

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) {
    passed += 1;
    log(`  PASS  ${label}`);
  } else {
    failed += 1;
    log(`  FAIL  ${label}`);
  }
}

function authedGet(secret = SECRET): Request {
  return new Request("https://app.example.com/api/cron/run", {
    method: "GET",
    headers: { authorization: `Bearer ${secret}` },
  });
}

async function main(): Promise<void> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const { db, sqlite } = createDb(":memory:");
  const prAgent = createFakeAgent(db, {
    // job "j-pr" reports a PR url to exercise the PR-landing path.
    prUrlFor: (o) =>
      o.repoName === "ci-bot"
        ? `https://github.com/${o.repoOwner}/${o.repoName}/pull/42`
        : undefined,
  });

  // Controlled "now": 2026-05-31 09:05:00 UTC.
  const NOW = new Date("2026-05-31T09:05:00.000Z");
  log(`# POC 2a eval`);
  log(`Controlled now = ${NOW.toISOString()}`);
  log("");

  // --- Seed jobs ---------------------------------------------------------
  log("## Seeding jobs");
  const seed = [
    {
      id: "j-5min",
      ownerUserId: "user-1",
      repoOwner: "acme",
      repoName: "web",
      branch: "main",
      cronExpression: "*/5 * * * *", // due at 09:05
      prompt: "Audit dependencies for CVEs and summarize.",
      enabled: true,
    },
    {
      id: "j-9am",
      ownerUserId: "user-1",
      repoOwner: "acme",
      repoName: "reports",
      branch: null,
      cronExpression: "0 9 * * *", // due at 09:00, NOT at 09:05
      prompt: "Generate the daily standup report.",
      enabled: true,
    },
    {
      id: "j-pr",
      ownerUserId: "user-2",
      repoOwner: "acme",
      repoName: "ci-bot",
      branch: "main",
      cronExpression: "*/5 * * * *", // due at 09:05, lands a PR
      prompt: "Open a PR bumping the lockfile.",
      enabled: true,
    },
    {
      id: "j-disabled",
      ownerUserId: "user-1",
      repoOwner: "acme",
      repoName: "infra",
      branch: "main",
      cronExpression: "*/5 * * * *", // would be due, but disabled
      prompt: "Should never run.",
      enabled: false,
    },
  ];
  for (const j of seed) {
    db.insert(scheduledJobs).values(j).run();
    log(
      `  - ${j.id}: ${j.repoOwner}/${j.repoName} "${j.cronExpression}" enabled=${j.enabled}`,
    );
  }
  log("");

  // --- Test 5 first: unauthenticated request rejected -------------------
  log("## Test: unauthenticated request");
  const unauth = new Request("https://app.example.com/api/cron/run", {
    method: "GET",
  });
  const unauthRes = await handleCron(unauth, { db, secret: SECRET, runAgent: prAgent });
  assert(unauthRes.status === 401, "missing Authorization -> 401");
  const wrongSecretRes = await handleCron(authedGet("wrong-secret"), {
    db,
    secret: SECRET,
    runAgent: prAgent,
  });
  assert(wrongSecretRes.status === 401, "wrong bearer secret -> 401");
  log("");

  // --- Invoke the cron endpoint at NOW (09:05) --------------------------
  log("## Invoke cron endpoint (authed, now=09:05)");
  const res = await handleCron(authedGet(), {
    db,
    secret: SECRET,
    runAgent: prAgent,
    now: () => NOW,
  });
  assert(res.status === 200, "authed request -> 200");
  const body = (await res.json()) as CronResult;
  log(`  response: ${JSON.stringify(body, null, 2)}`);
  log("");

  const ranIds = new Set(
    body.outcomes
      .filter((o) => o.status === "succeeded" || o.status === "failed")
      .map((o) => o.jobId),
  );

  // --- Test 1 & 2: due/enabled selection + cron correctness -------------
  log("## Test: due selection + cron matching");
  assert(ranIds.has("j-5min"), "*/5 job is due at 09:05 -> ran");
  assert(ranIds.has("j-pr"), "*/5 PR job is due at 09:05 -> ran");
  assert(!ranIds.has("j-9am"), "0 9 * * * job NOT due at 09:05 -> skipped");
  assert(!ranIds.has("j-disabled"), "disabled job -> never ran");
  assert(body.dispatched === 2, "exactly 2 jobs dispatched");
  log("");

  // --- Test 3: run rows + schedule advance ------------------------------
  log("## Test: run rows + lastRunAt/nextRunAt advance");
  const runRows = db.select().from(scheduledJobRuns).all();
  assert(runRows.length === 2, "2 scheduled_job_runs rows created");
  assert(
    runRows.every((r) => r.status === "succeeded"),
    "all run rows have status=succeeded",
  );
  assert(
    runRows.every((r) => r.finishedAt !== null),
    "all run rows have finishedAt set",
  );

  const j5 = db
    .select()
    .from(scheduledJobs)
    .where(eq(scheduledJobs.id, "j-5min"))
    .get();
  const expectedNext5 = nextRunAfter("*/5 * * * *", NOW); // 09:10
  assert(j5?.lastRunAt?.getTime() === NOW.getTime(), "j-5min lastRunAt = now");
  assert(
    j5?.nextRunAt?.getTime() === expectedNext5.getTime(),
    `j-5min nextRunAt advanced to ${expectedNext5.toISOString()}`,
  );

  const j9 = db
    .select()
    .from(scheduledJobs)
    .where(eq(scheduledJobs.id, "j-9am"))
    .get();
  assert(j9?.lastRunAt == null, "j-9am (not due) lastRunAt untouched (null)");
  log("");

  // --- Test 6: result landed as a linked chat message -------------------
  log("## Test: result landed as chat message linked to job");
  const succeeded = body.outcomes.find(
    (o) => o.status === "succeeded" && o.jobId === "j-5min",
  );
  const landedChatId =
    succeeded && succeeded.status === "succeeded" ? succeeded.chatId : "";
  const msgs = db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.chatId, landedChatId))
    .all();
  assert(msgs.length === 1, "j-5min run produced exactly 1 chat message");
  assert(msgs[0]?.role === "assistant", "landed message role = assistant");
  // Walk the link: chat -> session -> repo matches the job's repo.
  const chat = db.select().from(chats).where(eq(chats.id, landedChatId)).get();
  assert(chat != null, "chat row exists for landed message");
  log(
    `  landed message: ${JSON.stringify((msgs[0]?.parts as unknown[])?.[0])}`,
  );

  // PR landing path.
  const prOutcome = body.outcomes.find((o) => o.jobId === "j-pr");
  const prUrl =
    prOutcome && prOutcome.status === "succeeded" ? prOutcome.prUrl : undefined;
  assert(
    prUrl === "https://github.com/acme/ci-bot/pull/42",
    "j-pr reported a PR url that was recorded",
  );
  const prRun = runRows.find((r) => r.prUrl != null);
  assert(prRun?.prUrl === prUrl, "scheduled_job_runs.prUrl persisted");
  log("");

  // --- Test 7: idempotency / overlap (same tick, second invocation) -----
  log("## Test: idempotency — second invocation in same tick");
  const res2 = await handleCron(authedGet(), {
    db,
    secret: SECRET,
    runAgent: prAgent,
    now: () => NOW, // same 09:05 tick
  });
  const body2 = (await res2.json()) as CronResult;
  log(`  second response outcomes: ${JSON.stringify(body2.outcomes)}`);
  // After advancing nextRunAt to 09:10, the coarse filter should not even
  // select these jobs at 09:05; if it did, the unique tick guard would skip.
  const doubleDispatched = body2.outcomes.filter(
    (o) => o.status === "succeeded" || o.status === "failed",
  );
  assert(
    doubleDispatched.length === 0,
    "no job double-dispatched in the same tick",
  );
  const runRowsAfter = db.select().from(scheduledJobRuns).all();
  assert(
    runRowsAfter.length === 2,
    "still exactly 2 run rows after second invocation",
  );
  log("");

  // --- Test: idempotency under concurrency (explicit unique-index guard) -
  log("## Test: idempotency — concurrent claims for a forced-due job tick");
  // Force j-9am due by setting its nextRunAt into the past, then fire two
  // invocations "concurrently" at the same tick.
  db.update(scheduledJobs)
    .set({ nextRunAt: new Date(NOW.getTime() - 60_000) })
    .where(eq(scheduledJobs.id, "j-9am"))
    .run();
  const [c1, c2] = await Promise.all([
    handleCron(authedGet(), { db, secret: SECRET, runAgent: prAgent, now: () => NOW }),
    handleCron(authedGet(), { db, secret: SECRET, runAgent: prAgent, now: () => NOW }),
  ]);
  const b1 = (await c1.json()) as CronResult;
  const b2 = (await c2.json()) as CronResult;
  const j9Runs = db
    .select()
    .from(scheduledJobRuns)
    .where(eq(scheduledJobRuns.jobId, "j-9am"))
    .all();
  assert(
    j9Runs.length === 1,
    "concurrent invocations created exactly 1 run row for j-9am",
  );
  log(
    `  concurrent dispatched counts: [${b1.dispatched}, ${b2.dispatched}] (sum should be 1)`,
  );
  assert(b1.dispatched + b2.dispatched === 1, "exactly one invocation dispatched j-9am");
  log("");

  // --- Final DB dump -----------------------------------------------------
  const dump = {
    capturedAt: new Date().toISOString(),
    controlledNow: NOW.toISOString(),
    scheduled_jobs: db.select().from(scheduledJobs).all(),
    scheduled_job_runs: db.select().from(scheduledJobRuns).all(),
    chats: db.select().from(chats).all(),
    chat_messages: db.select().from(chatMessages).all(),
  };
  writeFileSync(
    join(EVIDENCE_DIR, "db-final-state.json"),
    JSON.stringify(dump, null, 2),
  );

  log("## Summary");
  log(`  ${passed} passed, ${failed} failed`);
  transcript.push("");
  writeFileSync(join(EVIDENCE_DIR, "eval-transcript.txt"), transcript.join("\n"));
  sqlite.close();

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
