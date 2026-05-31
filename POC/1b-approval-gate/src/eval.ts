/**
 * POC 1b eval — exercises BOTH paths of the approval gate with real state
 * assertions and an OBSERVABLE side effect (a marker file), so "did it actually
 * execute?" is provable, not merely asserted.
 *
 * Paths covered:
 *   (A) destructive action PARKS with an `approval-requested` chunk carrying a
 *       stable approvalId, and the side effect has NOT happened yet.
 *   (B) APPROVE -> side effect happens + `output-available` streams.
 *   (C) DENY    -> side effect never happens + `output-denied` streams.
 *   (D) safe action passes through with no approval.
 *   (E) durability: resume succeeds from a FRESH store instance (serverless
 *       restart) using only persisted state.
 *
 * Evidence (emitted UI-chunk JSON per path) is written to evidence/.
 */
import { withApproval } from "./approval-gate";
import {
  JsonFileStore,
  resumeFromDecision,
  runUntilPark,
  type ToolCall,
} from "./agent-loop";
import { defineTool } from "./tool";
import type { UIChunk } from "./types";

const EVIDENCE_DIR = new URL("../evidence/", import.meta.url).pathname;

// ---- Observable side effect ------------------------------------------------
// A "deploy" tool whose ONLY side effect is writing a marker file. The presence
// or absence of this file is ground truth for whether execute() ran.
function markerPath(tag: string): string {
  return `${EVIDENCE_DIR}side-effect-${tag}.marker`;
}

function makeDeployTool(tag: string) {
  return defineTool<{ command: string }, { ok: true; ranAt: string }>({
    name: "bash",
    description: "Run a shell command (side effect: writes a marker file).",
    execute: async () => {
      const ranAt = new Date().toISOString();
      await Bun.write(markerPath(tag), `executed at ${ranAt}\n`);
      return { ok: true, ranAt };
    },
  });
}

async function markerExists(tag: string): Promise<boolean> {
  return await Bun.file(markerPath(tag)).exists();
}
async function clearMarker(tag: string): Promise<void> {
  try {
    await Bun.file(markerPath(tag)).unlink();
  } catch {
    /* not present */
  }
}

// ---- Tiny assertion helper -------------------------------------------------
const failures: string[] = [];
let assertionCount = 0;
function assert(cond: boolean, msg: string): void {
  assertionCount += 1;
  if (cond) {
    console.log(`  PASS: ${msg}`);
  } else {
    console.log(`  FAIL: ${msg}`);
    failures.push(msg);
  }
}

function chunkTypes(chunks: UIChunk[]): string[] {
  return chunks.map((c) => c.type);
}

async function writeEvidence(name: string, data: unknown): Promise<void> {
  await Bun.write(
    `${EVIDENCE_DIR}${name}.json`,
    JSON.stringify(data, null, 2) + "\n",
  );
}

// ---------------------------------------------------------------------------
async function main() {
  console.log("=== POC 1b: structured per-tool approval gate eval ===\n");
  await Bun.write(`${EVIDENCE_DIR}.gitkeep`, "");

  // ----- Path A + B: destructive bash, PARK then APPROVE -------------------
  console.log("[A+B] Destructive action parks, then is APPROVED");
  await clearMarker("approve");
  const approveStorePath = `${EVIDENCE_DIR}.store-approve.json`;
  await clearStore(approveStorePath);

  const deployApprove = makeDeployTool("approve");
  const gateApprove = withApproval(deployApprove);
  const destructiveCall: ToolCall = {
    toolCallId: "call_001",
    toolName: "bash",
    input: { command: "rm -rf ./build" },
  };

  // First leg (invocation #1): runs until it parks.
  const legA = await runUntilPark({
    toolCall: destructiveCall,
    gate: gateApprove,
    store: new JsonFileStore(approveStorePath),
  });

  assert(legA.status === "parked", "destructive action PARKED (did not execute)");
  assert(
    chunkTypes(legA.chunks).includes("tool-approval-request"),
    "emitted a tool-approval-request chunk",
  );
  const parkChunk = legA.chunks.find(
    (c) => c.type === "tool-approval-request",
  );
  const approvalId =
    parkChunk && parkChunk.type === "tool-approval-request"
      ? parkChunk.approvalId
      : "";
  assert(approvalId.length > 0, `approval-request carries a stable approvalId (${approvalId})`);
  assert(legA.finalState === "approval-requested", "tool part state is approval-requested");
  assert(
    (await markerExists("approve")) === false,
    "side effect has NOT happened yet (marker absent at park time)",
  );
  await writeEvidence("path-A-park-chunks", legA.chunks);

  // Second leg (invocation #2 — FRESH store instance = serverless restart).
  const resumeApprove = await resumeFromDecision({
    decision: { approvalId, approved: true, reason: "Operator confirmed cleanup" },
    gate: withApproval(makeDeployTool("approve")), // fresh gate too
    store: new JsonFileStore(approveStorePath), // fresh store handle
  });

  assert(
    chunkTypes(resumeApprove.chunks).includes("tool-output-available"),
    "APPROVE streams a tool-output-available chunk",
  );
  assert(resumeApprove.finalState === "output-available", "resumed tool part state is output-available");
  assert(
    (await markerExists("approve")) === true,
    "side effect HAPPENED after approve (marker present)",
  );
  await writeEvidence("path-B-approve-chunks", resumeApprove.chunks);
  console.log();

  // ----- Path C: destructive bash, PARK then DENY --------------------------
  console.log("[C] Destructive action parks, then is DENIED");
  await clearMarker("deny");
  const denyStorePath = `${EVIDENCE_DIR}.store-deny.json`;
  await clearStore(denyStorePath);

  const gateDeny = withApproval(makeDeployTool("deny"));
  const legC = await runUntilPark({
    toolCall: {
      toolCallId: "call_002",
      toolName: "bash",
      input: { command: "dd if=/dev/zero of=/dev/sda" },
    },
    gate: gateDeny,
    store: new JsonFileStore(denyStorePath),
  });
  assert(legC.status === "parked", "destructive action PARKED");
  const denyApprovalId =
    legC.status === "parked" ? legC.approvalId : "";

  const resumeDeny = await resumeFromDecision({
    decision: {
      approvalId: denyApprovalId,
      approved: false,
      reason: "Operator rejected: would wipe the disk",
    },
    gate: withApproval(makeDeployTool("deny")),
    store: new JsonFileStore(denyStorePath),
  });
  assert(
    chunkTypes(resumeDeny.chunks).includes("tool-output-denied"),
    "DENY streams a tool-output-denied chunk",
  );
  assert(resumeDeny.finalState === "output-denied", "denied tool part state is output-denied");
  assert(
    (await markerExists("deny")) === false,
    "side effect NEVER happened after deny (marker absent)",
  );
  await writeEvidence("path-C-deny-chunks", resumeDeny.chunks);
  console.log();

  // ----- Path D: safe action passes through, no approval -------------------
  console.log("[D] Safe action passes through (no approval)");
  await clearMarker("safe");
  const gateSafe = withApproval(makeDeployTool("safe"));
  const legD = await runUntilPark({
    toolCall: {
      toolCallId: "call_003",
      toolName: "bash",
      input: { command: "ls -la" },
    },
    gate: gateSafe,
    store: new JsonFileStore(`${EVIDENCE_DIR}.store-safe.json`),
  });
  assert(legD.status === "completed", "safe action COMPLETED without parking");
  assert(
    !chunkTypes(legD.chunks).includes("tool-approval-request"),
    "no tool-approval-request chunk emitted for safe action",
  );
  assert(
    chunkTypes(legD.chunks).includes("tool-output-available"),
    "safe action streams tool-output-available directly",
  );
  assert(
    (await markerExists("safe")) === true,
    "safe action executed its side effect immediately",
  );
  await writeEvidence("path-D-safe-chunks", legD.chunks);
  console.log();

  // ----- Generalization beyond bash: git push + external API write ---------
  console.log("[E] Policy generalizes beyond bash (git push, external write)");
  const gitTool = defineTool<{ args: string }, string>({
    name: "git",
    execute: () => "pushed",
  });
  const gitGate = withApproval(gitTool);
  const gitLeg = await runUntilPark({
    toolCall: { toolCallId: "call_git", toolName: "git", input: { args: "push --force origin main" } },
    gate: gitGate,
    store: new JsonFileStore(`${EVIDENCE_DIR}.store-git.json`),
  });
  assert(gitLeg.status === "parked", "git force-push PARKED for approval");

  const httpTool = defineTool<{ method: string; url: string }, string>({
    name: "http_request",
    execute: () => "200",
  });
  const httpGate = withApproval(httpTool);
  const httpLeg = await runUntilPark({
    toolCall: {
      toolCallId: "call_http",
      toolName: "http_request",
      input: { method: "POST", url: "https://api.stripe.com/v1/charges" },
    },
    gate: httpGate,
    store: new JsonFileStore(`${EVIDENCE_DIR}.store-http.json`),
  });
  assert(httpLeg.status === "parked", "external POST PARKED for approval");

  const httpGetLeg = await runUntilPark({
    toolCall: {
      toolCallId: "call_http_get",
      toolName: "http_request",
      input: { method: "GET", url: "https://api.github.com/repos/x/y" },
    },
    gate: withApproval(httpTool),
    store: new JsonFileStore(`${EVIDENCE_DIR}.store-http-get.json`),
  });
  assert(httpGetLeg.status === "completed", "external GET (read-only) passed through");
  console.log();

  // ----- Durability: resume after store reload only ------------------------
  console.log("[F] Durability: parked approval survives a fresh process/store");
  const durabilityStore = `${EVIDENCE_DIR}.store-durable.json`;
  await clearStore(durabilityStore);
  await clearMarker("durable");
  const legDur = await runUntilPark({
    toolCall: { toolCallId: "call_dur", toolName: "bash", input: { command: "rm -rf /tmp/x" } },
    gate: withApproval(makeDeployTool("durable")),
    store: new JsonFileStore(durabilityStore),
  });
  const durApprovalId = legDur.status === "parked" ? legDur.approvalId : "";
  // Simulate restart: the only thing that crosses the boundary is the store file.
  const persisted = await new JsonFileStore(durabilityStore).load(durApprovalId);
  assert(persisted !== null, "parked record is durably persisted (survives restart)");
  const resumeDur = await resumeFromDecision({
    decision: { approvalId: durApprovalId, approved: true },
    gate: withApproval(makeDeployTool("durable")),
    store: new JsonFileStore(durabilityStore),
  });
  assert(resumeDur.finalState === "output-available", "resumed-from-disk approval executed");
  assert(await markerExists("durable"), "side effect ran after resume-from-disk");
  console.log();

  // ---- Summary ------------------------------------------------------------
  console.log("=== Summary ===");
  console.log(`Assertions: ${assertionCount}, Failures: ${failures.length}`);
  await writeEvidence("summary", {
    assertions: assertionCount,
    failures,
    paths: {
      A_park: "approval-requested chunk + no side effect",
      B_approve: "output-available chunk + side effect ran",
      C_deny: "output-denied chunk + no side effect",
      D_safe: "passthrough, output-available, no approval",
      E_generalization: "git force-push + external POST parked; GET passed",
      F_durability: "resume from persisted store after simulated restart",
    },
  });

  if (failures.length > 0) {
    console.error(`\n${failures.length} assertion(s) FAILED.`);
    process.exit(1);
  }
  console.log("\nAll assertions passed.");
}

async function clearStore(path: string): Promise<void> {
  try {
    await Bun.file(path).unlink();
  } catch {
    /* not present */
  }
}

main().catch((error) => {
  console.error("Eval crashed:", error);
  process.exit(1);
});
