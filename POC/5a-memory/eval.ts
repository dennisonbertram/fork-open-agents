/**
 * POC 5a eval — proves RELEVANCE, SCOPING, and DEDUP for cross-session memory.
 *
 * Run: bun run eval
 *
 * Offline & deterministic: uses the local hashing embedder, so rankings are
 * reproducible with no API key. Writes a full transcript to
 * evidence/eval-output.txt and a machine-readable summary to
 * evidence/eval-results.json. Exits non-zero if any assertion fails.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMemoryDb } from "./src/db";
import { localHashingEmbedder } from "./src/embedder";
import { MemoryStore } from "./src/memory-store";
import {
  REPO_X,
  REPO_Y,
  SEED_CORPUS,
  USER_A,
  USER_B,
} from "./src/corpus";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = join(__dirname, "evidence");

// ---- tiny test harness ----------------------------------------------------
const lines: string[] = [];
let passed = 0;
let failed = 0;
const failures: string[] = [];

function log(s = ""): void {
  lines.push(s);
}
function assert(cond: boolean, label: string): void {
  if (cond) {
    passed++;
    log(`  PASS  ${label}`);
  } else {
    failed++;
    failures.push(label);
    log(`  FAIL  ${label}`);
  }
}
function fmt(n: number): string {
  return n.toFixed(4);
}

async function main() {
  const db = createMemoryDb(":memory:");
  const embedder = localHashingEmbedder();
  const store = new MemoryStore(db, embedder);

  log("=".repeat(78));
  log("POC 5a — cross-session / project memory eval");
  log(`embedder: ${embedder.id}  (offline, deterministic)`);
  log(`run at:   ${new Date().toISOString()}`);
  log("=".repeat(78));

  // -- seed -----------------------------------------------------------------
  for (const m of SEED_CORPUS) {
    await store.write(m);
  }
  log("");
  log(`Seeded ${store.count()} memories total:`);
  log(
    `  ${USER_A} / ${REPO_X.owner}/${REPO_X.name}: ${store.count({ userId: USER_A, repoOwner: REPO_X.owner, repoName: REPO_X.name })}`,
  );
  log(
    `  ${USER_B} / ${REPO_Y.owner}/${REPO_Y.name}: ${store.count({ userId: USER_B, repoOwner: REPO_Y.owner, repoName: REPO_Y.name })}`,
  );

  const scopeA = {
    userId: USER_A,
    repoOwner: REPO_X.owner,
    repoName: REPO_X.name,
  };
  const scopeB = {
    userId: USER_B,
    repoOwner: REPO_Y.owner,
    repoName: REPO_Y.name,
  };

  // == RELEVANCE =============================================================
  log("");
  log("-".repeat(78));
  log("RELEVANCE — query -> ranked results, assert expected top result");
  log("-".repeat(78));

  type RelCase = {
    query: string;
    expectTopIncludes: string; // substring the #1 result must contain
    // A truly-unrelated memory that must be entirely absent from top-k.
    unrelatedAbsent: string;
    // A distractor that may rank low but must score far below #1 (ranking, not
    // mere presence). We require #1 to beat it by a wide relative margin.
    distractor?: string;
    topK: number;
  };
  const relCases: RelCase[] = [
    {
      query: "how does our auth work?",
      expectTopIncludes: "Better Auth",
      unrelatedAbsent: "2-space indentation",
      topK: 3,
    },
    {
      query: "why am I getting rate limited?",
      expectTopIncludes: "429",
      unrelatedAbsent: "Stripe",
      distractor: "Better Auth",
      topK: 3,
    },
    {
      query: "the app crashes on cold start loading a user session",
      expectTopIncludes: "null pointer in session hydration",
      unrelatedAbsent: "Stripe",
      topK: 3,
    },
    {
      query: "how are database schema changes applied?",
      expectTopIncludes: "Drizzle",
      unrelatedAbsent: "2-space indentation",
      distractor: "Better Auth",
      topK: 3,
    },
  ];

  for (const c of relCases) {
    const results = await store.retrieve(c.query, scopeA, { topK: c.topK });
    log("");
    log(`  QUERY: "${c.query}"  (top ${c.topK}, scope=${USER_A}/${REPO_X.name})`);
    results.forEach((r, i) => {
      log(`    #${i + 1}  score=${fmt(r.score)}  [${r.kind}]  ${r.content}`);
    });
    const top = results[0];
    assert(
      !!top && top.content.includes(c.expectTopIncludes),
      `top result for "${c.query}" contains "${c.expectTopIncludes}"`,
    );
    assert(
      !results.some((r) => r.content.includes(c.unrelatedAbsent)),
      `unrelated "${c.unrelatedAbsent}" absent from top-${c.topK} for "${c.query}"`,
    );
    if (c.distractor) {
      const distractorHit = results.find((r) =>
        r.content.includes(c.distractor as string),
      );
      // The distractor must rank well below #1: at most 25% of the top score.
      const margin = distractorHit ? distractorHit.score / (top?.score ?? 1) : 0;
      assert(
        margin <= 0.25,
        `distractor "${c.distractor}" scores <=25% of #1 for "${c.query}" (ratio=${fmt(margin)})`,
      );
    }
  }

  // == SCOPING ===============================================================
  log("");
  log("-".repeat(78));
  log("SCOPING — strict per-user + per-repo isolation (no cross-tenant leak)");
  log("-".repeat(78));

  // userA asking about auth must NEVER see userB's Clerk decision.
  const aAuth = await store.retrieve("how does our auth work?", scopeA, {
    topK: 10,
  });
  log("");
  log(`  QUERY as ${USER_A}/${REPO_X.name}: "how does our auth work?" (top 10)`);
  aAuth.forEach((r, i) =>
    log(`    #${i + 1}  score=${fmt(r.score)}  [${r.kind}]  ${r.content}`),
  );
  assert(
    !aAuth.some((r) => r.content.includes("Clerk")),
    "userA/repoX results never include userB/repoY 'Clerk' memory",
  );
  assert(
    !aAuth.some((r) => r.content.includes("Contentful")),
    "userA/repoX results never include any userB/repoY memory",
  );

  // userB asking about auth must NEVER see userA's Better Auth decision.
  const bAuth = await store.retrieve("how does our auth work?", scopeB, {
    topK: 10,
  });
  log("");
  log(`  QUERY as ${USER_B}/${REPO_Y.name}: "how does our auth work?" (top 10)`);
  bAuth.forEach((r, i) =>
    log(`    #${i + 1}  score=${fmt(r.score)}  [${r.kind}]  ${r.content}`),
  );
  assert(
    !bAuth.some((r) => r.content.includes("Better Auth")),
    "userB/repoY results never include userA/repoX 'Better Auth' memory",
  );
  assert(
    !!bAuth[0] && bAuth[0].content.includes("Clerk"),
    "userB/repoY correctly surfaces its OWN 'Clerk' auth memory on top",
  );

  // Cross-repo for the SAME user with no memories there -> empty, no leak.
  const aWrongRepo = await store.retrieve("how does our auth work?", {
    userId: USER_A,
    repoOwner: REPO_Y.owner,
    repoName: REPO_Y.name,
  });
  log("");
  log(
    `  QUERY as ${USER_A} but scoped to ${REPO_Y.owner}/${REPO_Y.name} (userA has no memories there):`,
  );
  log(`    -> ${aWrongRepo.length} results`);
  assert(
    aWrongRepo.length === 0,
    "userA scoped to repoY (no memories) returns EMPTY — no cross-repo leak of userB or own repoX",
  );

  // == DEDUP =================================================================
  log("");
  log("-".repeat(78));
  log("DEDUP — near-duplicate merges/reinforces instead of inserting a row");
  log("-".repeat(78));

  const before = store.count(scopeA);
  // A near-paraphrase of the existing Better Auth decision.
  const dupResult = await store.write({
    ...scopeA,
    kind: "decision",
    content:
      "We chose Better Auth for authentication instead of NextAuth; the NextAuth migration is done.",
    sourceSessionId: "sess_a7",
  });
  const after = store.count(scopeA);
  log("");
  log(`  Before: ${before} memories in ${USER_A}/${REPO_X.name}`);
  log(
    `  Wrote near-duplicate of the Better Auth decision -> action="${dupResult.action}"` +
      ("mergedScore" in dupResult ? ` (score=${fmt(dupResult.mergedScore)})` : ""),
  );
  log(`  After:  ${after} memories (count unchanged means it merged)`);
  assert(dupResult.action === "merged", "near-duplicate write returns action=merged");
  assert(after === before, "near-duplicate did NOT create a second row");

  // A genuinely new memory in the same scope/kind should insert.
  const distinctResult = await store.write({
    ...scopeA,
    kind: "decision",
    content:
      "We decided to adopt feature flags via LaunchDarkly for gradual rollout of checkout changes.",
    sourceSessionId: "sess_a8",
  });
  const afterDistinct = store.count(scopeA);
  log(
    `  Wrote a genuinely distinct decision -> action="${distinctResult.action}", count now ${afterDistinct}`,
  );
  assert(distinctResult.action === "inserted", "distinct write returns action=inserted");
  assert(afterDistinct === before + 1, "distinct write DID create a new row");

  // Confirm the merged memory's reinforcement signal moved.
  const merged = await store.retrieve("better auth decision", scopeA, { topK: 1 });
  log(
    `  Reinforced memory now: useCount=${merged[0]?.useCount} content="${merged[0]?.content}"`,
  );
  assert(
    !!merged[0] && merged[0].useCount >= 1,
    "merged memory useCount was reinforced (>=1)",
  );
  assert(
    !!merged[0] && merged[0].content.includes("chose Better Auth"),
    "merged memory content refreshed to the newer phrasing",
  );

  // == SUMMARY ===============================================================
  log("");
  log("=".repeat(78));
  log(`RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    log(`FAILURES:\n  - ${failures.join("\n  - ")}`);
  }
  log("=".repeat(78));

  const transcript = lines.join("\n");
  console.log(transcript);

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(join(EVIDENCE_DIR, "eval-output.txt"), `${transcript}\n`);
  writeFileSync(
    join(EVIDENCE_DIR, "eval-results.json"),
    `${JSON.stringify(
      {
        embedder: embedder.id,
        runAt: new Date().toISOString(),
        passed,
        failed,
        failures,
        seededTotal: SEED_CORPUS.length,
      },
      null,
      2,
    )}\n`,
  );

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
