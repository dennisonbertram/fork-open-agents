/**
 * POC 2c meaningful eval.
 *
 * Feeds REAL-SHAPED webhook payloads through the FULL ingest pipeline
 * (resolve source -> verify signature -> normalize -> match rules -> dispatch)
 * for 5 sources, signing each with that source's REAL scheme:
 *   - GitHub:     x-hub-signature-256: sha256=<hmac-sha256 hex>
 *   - AgentMail:  x-agentmail-signature: <hmac-sha256 hex> (bare)
 *   - Vercel:     x-vercel-signature: <hmac-sha1 hex>
 *   - Sentry:     sentry-hook-signature: <hmac-sha256 hex> (bare)
 *   - generic:    authorization: Bearer <secret>
 *
 * Asserts on real outcomes (verification, canonical shape, matched rule,
 * rendered prompt, dispatch count) plus negative cases (bad signature, no-rule,
 * multi-rule fan-out, redelivery dedup) and the GitHub PR-close regression.
 * Saves per-event normalized JSON + dispatch decisions to ./evidence.
 *
 * Run: tsx eval.ts   (or: npm run eval)
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hmacHex } from "./sources/verify";
import { IngestPipeline } from "./ingest";
import { defaultRules } from "./rules";
import type { AgentRunIntent, RawInbound } from "./types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");
const EVIDENCE = join(__dirname, "evidence");

const SECRETS: Record<string, string> = {
  github: "github-webhook-secret",
  agentmail: "agentmail-webhook-secret",
  "vercel-deploy": "vercel-webhook-secret",
  sentry: "sentry-client-secret",
  generic: "generic-shared-bearer",
};

const log: string[] = [];
function record(line: string) {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(stamped);
  log.push(stamped);
}

let failures = 0;
function assert(cond: boolean, label: string, detail?: unknown) {
  if (cond) {
    record(`PASS  ${label}`);
  } else {
    failures++;
    record(
      `FAIL  ${label}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ""}`,
    );
  }
}

async function loadFixture(name: string): Promise<string> {
  // Read raw text and re-serialize compactly so signature is computed over the
  // EXACT bytes we transmit (mirrors verifying over the raw request body).
  const raw = await readFile(join(FIXTURES, name), "utf-8");
  return JSON.stringify(JSON.parse(raw));
}

function githubInbound(body: string, event: string, secret: string): RawInbound {
  return {
    rawBody: body,
    headers: {
      "x-github-event": event,
      "x-hub-signature-256": `sha256=${hmacHex("sha256", secret, body)}`,
    },
  };
}

function agentmailInbound(body: string, secret: string): RawInbound {
  return {
    rawBody: body,
    headers: { "x-agentmail-signature": hmacHex("sha256", secret, body) },
  };
}

function vercelInbound(body: string, secret: string): RawInbound {
  return {
    rawBody: body,
    headers: { "x-vercel-signature": hmacHex("sha1", secret, body) },
  };
}

function sentryInbound(body: string, secret: string): RawInbound {
  return {
    rawBody: body,
    headers: {
      "sentry-hook-resource": "event_alert",
      "sentry-hook-signature": hmacHex("sha256", secret, body),
    },
  };
}

function genericInbound(body: string, secret: string): RawInbound {
  return {
    rawBody: body,
    headers: { "x-poc-source": "generic", authorization: `Bearer ${secret}` },
  };
}

// Records every intent the fake agent is asked to run (the runAgent seam).
type RunRecord = AgentRunIntent & { runId: string };

async function main() {
  await mkdir(EVIDENCE, { recursive: true });
  const evidence: Record<string, unknown> = {};

  const runs: RunRecord[] = [];
  let counter = 0;
  const fakeRunAgent = async (intent: AgentRunIntent) => {
    counter += 1;
    const runId = `run_${counter}`;
    runs.push({ ...intent, runId });
    return { runId };
  };

  // Shared dedup set so redelivery across calls is caught (production: unique
  // index on idempotency key).
  const seen = new Set<string>();
  const pipeline = new IngestPipeline({
    rules: defaultRules,
    runAgent: fakeRunAgent,
    secrets: SECRETS,
    seen,
  });

  // ----- (a) GitHub issues.opened -----
  record("=== Source A: GitHub issues.opened ===");
  const issueBody = await loadFixture("github-issue-opened.json");
  const issueOut = await pipeline.ingest(
    githubInbound(issueBody, "issues", SECRETS.github),
  );
  assert(issueOut.status === 200, "github issue: verified + processed", issueOut.status);
  if (issueOut.status === 200) {
    const ev = issueOut.body.normalized[0];
    assert(ev?.source === "github", "github issue: source=github", ev?.source);
    assert(ev?.type === "github.issues.opened", "github issue: canonical type", ev?.type);
    assert(ev?.subject === "Login button does nothing on Safari", "github issue: subject", ev?.subject);
    assert(ev?.repo?.owner === "acme" && ev?.repo?.name === "widget", "github issue: repo", ev?.repo);
    assert(ev?.metadata.issueNumber === 412, "github issue: issueNumber metadata", ev?.metadata.issueNumber);
    assert(issueOut.body.dispatch.dispatched === 1, "github issue: exactly 1 dispatch", issueOut.body.dispatch.dispatched);
    const d = issueOut.body.dispatch.decisions[0];
    assert(d?.intent.ruleId === "github-issue-triage", "github issue: matched triage rule", d?.intent.ruleId);
    assert(
      d?.intent.prompt.includes("#412") && d.intent.prompt.includes("acme/widget") && d.intent.prompt.includes("octocat"),
      "github issue: prompt rendered from event fields",
      d?.intent.prompt,
    );
    evidence["github-issues-opened"] = { normalized: ev, dispatch: issueOut.body.dispatch };
  }

  // ----- (b) Inbound email (AgentMail) -----
  record("=== Source B: AgentMail message.received ===");
  const emailBody = await loadFixture("agentmail-message-received.json");
  const emailOut = await pipeline.ingest(agentmailInbound(emailBody, SECRETS.agentmail));
  assert(emailOut.status === 200, "email: verified + processed", emailOut.status);
  if (emailOut.status === 200) {
    const ev = emailOut.body.normalized[0];
    assert(ev?.source === "agentmail", "email: source=agentmail", ev?.source);
    assert(ev?.type === "email.message.received", "email: canonical type", ev?.type);
    assert(ev?.actor === "jane@example.com", "email: actor is parsed sender address", ev?.actor);
    assert(ev?.metadata.to === "support@acme.agentmail.to", "email: to address normalized", ev?.metadata.to);
    assert(ev?.metadata.threadId === "thd_55ab", "email: threadId metadata", ev?.metadata.threadId);
    // Subject contains "Bug" -> matches BOTH support-triage and bug-report (fan-out).
    assert(emailOut.body.dispatch.dispatched === 2, "email: multi-rule fan-out -> 2 dispatches", emailOut.body.dispatch.dispatched);
    const ruleIds = emailOut.body.dispatch.decisions.map((x) => x.intent.ruleId).sort();
    assert(
      JSON.stringify(ruleIds) === JSON.stringify(["email-bug-report", "email-support-triage"]),
      "email: matched the right rule set",
      ruleIds,
    );
    const support = emailOut.body.dispatch.decisions.find((x) => x.intent.ruleId === "email-support-triage");
    assert(
      !!support && support.intent.prompt.includes("jane@example.com") && support.intent.prompt.includes("thd_55ab"),
      "email: support prompt rendered from event fields",
      support?.intent.prompt,
    );
    evidence["agentmail-message-received"] = { normalized: ev, dispatch: emailOut.body.dispatch };
  }

  // ----- (c) Deploy failed (Vercel) -----
  record("=== Source C: Vercel deployment.error ===");
  const deployBody = await loadFixture("vercel-deployment-error.json");
  const deployOut = await pipeline.ingest(vercelInbound(deployBody, SECRETS["vercel-deploy"]));
  assert(deployOut.status === 200, "deploy: verified + processed", deployOut.status);
  if (deployOut.status === 200) {
    const ev = deployOut.body.normalized[0];
    assert(ev?.source === "vercel-deploy", "deploy: source=vercel-deploy", ev?.source);
    assert(ev?.type === "deploy.failed", "deploy: canonical type", ev?.type);
    assert(ev?.repo?.owner === "acme" && ev?.repo?.name === "widget", "deploy: repo derived from commit meta", ev?.repo);
    assert(ev?.metadata.deploymentId === "dpl_8xKq2", "deploy: deploymentId metadata", ev?.metadata.deploymentId);
    assert(ev?.metadata.target === "production", "deploy: target metadata", ev?.metadata.target);
    assert(deployOut.body.dispatch.dispatched === 1, "deploy: exactly 1 dispatch", deployOut.body.dispatch.dispatched);
    const d = deployOut.body.dispatch.decisions[0];
    assert(d?.intent.ruleId === "deploy-failure-investigate", "deploy: matched investigate rule", d?.intent.ruleId);
    assert(
      !!d && d.intent.prompt.includes("dpl_8xKq2") && d.intent.prompt.includes("widget") && d.intent.prompt.includes("production"),
      "deploy: prompt rendered from event fields",
      d?.intent.prompt,
    );
    evidence["vercel-deployment-error"] = { normalized: ev, dispatch: deployOut.body.dispatch };
  }

  // ----- (extra) Sentry alert -----
  record("=== Source D: Sentry issue.alert ===");
  const sentryBody = await loadFixture("sentry-issue-alert.json");
  const sentryOut = await pipeline.ingest(sentryInbound(sentryBody, SECRETS.sentry));
  assert(sentryOut.status === 200, "sentry: verified + processed", sentryOut.status);
  if (sentryOut.status === 200) {
    const ev = sentryOut.body.normalized[0];
    assert(ev?.type === "sentry.issue.alert", "sentry: canonical type", ev?.type);
    assert(ev?.metadata.level === "error", "sentry: level metadata", ev?.metadata.level);
    assert(sentryOut.body.dispatch.dispatched === 1, "sentry: exactly 1 dispatch (level matches)", sentryOut.body.dispatch.dispatched);
    const d = sentryOut.body.dispatch.decisions[0];
    assert(
      !!d && d.intent.prompt.includes("High error volume") && d.intent.prompt.includes("production"),
      "sentry: prompt rendered from event fields",
      d?.intent.prompt,
    );
    evidence["sentry-issue-alert"] = { normalized: ev, dispatch: sentryOut.body.dispatch };
  }

  // ----- GitHub PR-close regression (subsumed original handler) -----
  record("=== Regression: GitHub pull_request.closed subsumed as a rule ===");
  const prBody = await loadFixture("github-pr-closed.json");
  const prOut = await pipeline.ingest(githubInbound(prBody, "pull_request", SECRETS.github));
  assert(prOut.status === 200, "pr-close: verified + processed", prOut.status);
  if (prOut.status === 200) {
    const ev = prOut.body.normalized[0];
    assert(ev?.type === "github.pull_request.closed", "pr-close: canonical type", ev?.type);
    // The original handler derived prStatus = merged ? "merged" : "closed".
    assert(ev?.metadata.prStatus === "merged", "pr-close: prStatus matches original handler logic", ev?.metadata.prStatus);
    assert(prOut.body.dispatch.dispatched === 1, "pr-close: exactly 1 dispatch", prOut.body.dispatch.dispatched);
    const d = prOut.body.dispatch.decisions[0];
    assert(d?.intent.ruleId === "github-pr-close-archive", "pr-close: matched archive rule", d?.intent.ruleId);
    assert(
      !!d && d.intent.prompt.includes("#128") && d.intent.prompt.includes("merged"),
      "pr-close: prompt carries PR number + status",
      d?.intent.prompt,
    );
    evidence["github-pr-closed-regression"] = { normalized: ev, dispatch: prOut.body.dispatch };
  }

  // ----- NEGATIVE 1: bad signature is rejected, no dispatch -----
  record("=== Negative 1: bad signature rejected ===");
  const dispatchesBefore = runs.length;
  const tampered = githubInbound(issueBody, "issues", "WRONG-SECRET");
  const badSig = await pipeline.ingest(tampered);
  assert(badSig.status === 401, "bad-sig: rejected with 401", badSig.status);
  assert(runs.length === dispatchesBefore, "bad-sig: NO new dispatch occurred", { before: dispatchesBefore, after: runs.length });
  evidence["negative-bad-signature"] = { status: badSig.status, body: badSig.body, dispatchesUnchanged: runs.length === dispatchesBefore };

  // ----- NEGATIVE 2: event matching no rule -> no dispatch -----
  record("=== Negative 2: event matches no rule ===");
  // A github issues.closed event: verifies + normalizes, but no rule targets it.
  const closedIssue = JSON.stringify({
    ...JSON.parse(await readFile(join(FIXTURES, "github-issue-opened.json"), "utf-8")),
    action: "closed",
    issue: { ...JSON.parse(await readFile(join(FIXTURES, "github-issue-opened.json"), "utf-8")).issue, id: 999111 },
  });
  const noRuleOut = await pipeline.ingest(githubInbound(closedIssue, "issues", SECRETS.github));
  assert(noRuleOut.status === 200, "no-rule: verified + normalized", noRuleOut.status);
  if (noRuleOut.status === 200) {
    assert(noRuleOut.body.normalized[0]?.type === "github.issues.closed", "no-rule: canonical type closed", noRuleOut.body.normalized[0]?.type);
    assert(noRuleOut.body.dispatch.matched === 0, "no-rule: 0 rules matched", noRuleOut.body.dispatch.matched);
    assert(noRuleOut.body.dispatch.dispatched === 0, "no-rule: 0 dispatches", noRuleOut.body.dispatch.dispatched);
    evidence["negative-no-rule"] = { normalized: noRuleOut.body.normalized[0], dispatch: noRuleOut.body.dispatch };
  }

  // ----- NEGATIVE 3: redelivered webhook is deduped (idempotency) -----
  record("=== Negative 3: redelivered webhook deduped ===");
  const before = runs.length;
  const redeliver = await pipeline.ingest(githubInbound(issueBody, "issues", SECRETS.github));
  assert(redeliver.status === 200, "redeliver: still verifies", redeliver.status);
  if (redeliver.status === 200) {
    assert(redeliver.body.dispatch.matched === 1, "redeliver: rule still matches", redeliver.body.dispatch.matched);
    assert(redeliver.body.dispatch.dispatched === 0, "redeliver: 0 NEW dispatches (deduped)", redeliver.body.dispatch.dispatched);
    assert(redeliver.body.dispatch.duplicates === 1, "redeliver: counted as duplicate", redeliver.body.dispatch.duplicates);
    assert(runs.length === before, "redeliver: runAgent NOT called again", { before, after: runs.length });
    evidence["negative-redelivery-dedup"] = { dispatch: redeliver.body.dispatch, runsBefore: before, runsAfter: runs.length };
  }

  // ----- NEGATIVE 4: unrecognized source -----
  record("=== Negative 4: unrecognized source ===");
  const unknown = await pipeline.ingest({ rawBody: "{}", headers: { "x-something-else": "1" } });
  assert(unknown.status === 400, "unknown-source: 400", unknown.status);

  // ----- generic source (non-HMAC bearer) sanity -----
  record("=== Source E: generic bearer source ===");
  const genericBody = JSON.stringify({
    type: "ci.pipeline.failed",
    externalId: "ci:run:556",
    subject: "Nightly build broke on main",
    actor: "ci-bot",
    metadata: { pipeline: "nightly", branch: "main" },
  });
  const genericOut = await pipeline.ingest(genericInbound(genericBody, SECRETS.generic));
  assert(genericOut.status === 200, "generic: bearer verified + normalized", genericOut.status);
  if (genericOut.status === 200) {
    assert(genericOut.body.normalized[0]?.type === "ci.pipeline.failed", "generic: canonical type passthrough", genericOut.body.normalized[0]?.type);
    assert(genericOut.body.dispatch.dispatched === 0, "generic: 0 dispatch (no rule defined for it)", genericOut.body.dispatch.dispatched);
  }
  const genericBadBearer = await pipeline.ingest(genericInbound(genericBody, "WRONG"));
  assert(genericBadBearer.status === 401, "generic: wrong bearer rejected", genericBadBearer.status);

  // ----- Summary of all dispatched runs -----
  record(`Total agent-run intents dispatched: ${runs.length}`);
  for (const r of runs) {
    record(`  run=${r.runId} rule=${r.ruleId} agent=${r.agentId} key=${r.idempotencyKey}`);
  }

  evidence["_summary"] = {
    totalRunsDispatched: runs.length,
    runs: runs.map((r) => ({
      runId: r.runId,
      ruleId: r.ruleId,
      agentId: r.agentId,
      repo: r.repo,
      idempotencyKey: r.idempotencyKey,
      prompt: r.prompt,
    })),
    assertionFailures: failures,
  };

  await writeFile(join(EVIDENCE, "dispatch-decisions.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  record(`Saved evidence/dispatch-decisions.json`);

  record(failures === 0 ? "ALL ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`);
  await writeFile(join(EVIDENCE, "eval-log.txt"), `${log.join("\n")}\n`);
  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  record(`FATAL ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  await mkdir(EVIDENCE, { recursive: true }).catch(() => {});
  await writeFile(join(EVIDENCE, "eval-log.txt"), `${log.join("\n")}\n`).catch(() => {});
  process.exitCode = 1;
});
