/**
 * POC 3a — MEANINGFUL EVAL (not a smoke test).
 *
 * Spins up the mock cloud server + the bridge CLI over a REAL websocket against
 * a throwaway git repo (the jail). Exercises every path with observable side
 * effects (real file content, real marker files), and captures the session
 * transcript + policy-decision log to evidence/.
 *
 * Paths covered:
 *   [AUTH]  wrong token rejected; right token connects.
 *   [DIFF]  valid patch (modify + add file) applies -> tree matches expected.
 *   [DIFF]  conflicting/invalid patch rejected -> tree rolled back unchanged.
 *   [DIFF]  patch escaping the jail rejected.
 *   [EXEC]  echo within jail -> PARKS -> APPROVE -> real stdout + exit 0.
 *   [EXEC]  marker-file command -> APPROVE -> observable side effect appears.
 *   [EXEC]  out-of-jail (cat /etc/passwd) -> BLOCKED, never runs (even if approve).
 *   [EXEC]  traversal (cat ../../etc/passwd) -> BLOCKED, never runs.
 *   [EXEC]  denied command (rm) -> BLOCKED by denylist, never runs.
 *   [EXEC]  shell metachar (echo a; rm b) -> BLOCKED by shape, never runs.
 *   [EXEC]  destructive but-allowlisted shape on DENY -> never runs.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Bridge, type OperatorGate, type PolicyDecisionLog } from "./bridge";
import { startMockCloud } from "./mock-cloud";
import { DEFAULT_POLICY, type ExecPolicyConfig } from "./policy";
import type { BridgeToServer } from "./protocol";

const EVIDENCE = path.join(import.meta.dir, "..", "evidence");
const VALID_TOKEN = "sess_test_token_abc123";

let pass = 0;
let fail = 0;
const lines: string[] = [];
function log(s: string) {
  lines.push(s);
  console.log(s);
}
function assert(cond: boolean, msg: string) {
  if (cond) {
    pass++;
    log(`  PASS: ${msg}`);
  } else {
    fail++;
    log(`  FAIL: ${msg}`);
  }
}

function git(args: string[], cwd: string) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function makeJailRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-jail-"));
  git(["init", "-q"], dir);
  git(["config", "user.email", "poc@example.com"], dir);
  git(["config", "user.name", "POC"], dir);
  fs.writeFileSync(path.join(dir, "hello.txt"), "line one\nline two\nline three\n");
  fs.writeFileSync(path.join(dir, "keep.txt"), "unchanged\n");
  git(["add", "."], dir);
  git(["commit", "-qm", "init"], dir);
  return dir;
}

/** Build a real unified diff via git so it is guaranteed well-formed. */
function makeValidPatch(jail: string): string {
  // Modify hello.txt and add new.txt in a scratch clone, then capture the diff.
  fs.writeFileSync(path.join(jail, "hello.txt"), "line one\nLINE TWO CHANGED\nline three\nline four added\n");
  fs.writeFileSync(path.join(jail, "new.txt"), "brand new file\n");
  git(["add", "-A"], jail);
  const diff = git(["diff", "--cached"], jail).stdout;
  // Reset back to pristine so the diff is applied for real later.
  git(["reset", "-q", "--hard", "HEAD"], jail);
  return diff;
}

type Decision = { approve?: boolean; confirm?: boolean };
function scriptedGate(decisions: Map<string, Decision>): OperatorGate {
  return {
    approveExec: async (ctx) => {
      const d = decisions.get(ctx.toolCallId);
      return d?.approve ?? false;
    },
    confirmDiff: async (ctx) => {
      const d = decisions.get(ctx.diffId);
      return d?.confirm ?? false;
    },
  };
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const transcript: { dir: string; msg: unknown }[] = [];
  const decisionLog: PolicyDecisionLog = [];

  // ---- [AUTH] wrong token rejected ----
  log("\n[AUTH] websocket upgrade is gated on the session token");
  const cloud = await startMockCloud(VALID_TOKEN);
  const url = `ws://127.0.0.1:${cloud.port}/session`;

  const decisions = new Map<string, Decision>();
  const policy: ExecPolicyConfig = { ...DEFAULT_POLICY, jailRoot: "" };

  let authRejected = false;
  try {
    const badBridge = new Bridge({
      url,
      token: "wrong-token",
      policy: { ...policy, jailRoot: os.tmpdir() },
      gate: scriptedGate(decisions),
      decisionLog: [],
    });
    await badBridge.connect();
    badBridge.close();
  } catch (err) {
    authRejected = true;
    log(`  (connect threw: ${(err as Error).message})`);
  }
  assert(authRejected, "connection with WRONG token is rejected (no socket)");

  // ---- valid connection ----
  const jail = makeJailRepo();
  policy.jailRoot = fs.realpathSync(jail);
  const bridge = new Bridge({
    url,
    token: VALID_TOKEN,
    policy,
    gate: scriptedGate(decisions),
    decisionLog,
    onWire: (dir, msg) => transcript.push({ dir, msg }),
  });
  await bridge.connect();
  await cloud.waitForConnection();
  assert(true, "connection with VALID token succeeds");

  // ================= DIFF: valid apply =================
  log("\n[DIFF] valid patch (modify hello.txt + add new.txt) applies to tree");
  const validPatch = makeValidPatch(jail);
  decisions.set("diff-1", { confirm: true });
  cloud.send({ type: "diff-proposed", diffId: "diff-1", patch: validPatch, summary: "edit+add" });
  const diffRes1 = await cloud.waitFor(
    (m): m is Extract<BridgeToServer, { type: "diff-result" }> =>
      m.type === "diff-result" && m.diffId === "diff-1",
  );
  assert(diffRes1.status === "applied", "valid patch reported as applied");
  const helloAfter = fs.readFileSync(path.join(jail, "hello.txt"), "utf8");
  const newAfter = fs.existsSync(path.join(jail, "new.txt"))
    ? fs.readFileSync(path.join(jail, "new.txt"), "utf8")
    : "";
  assert(
    helloAfter === "line one\nLINE TWO CHANGED\nline three\nline four added\n",
    "hello.txt content matches the proposed patch (real apply)",
  );
  assert(newAfter === "brand new file\n", "new.txt was created by the patch");
  // commit so the next conflicting-patch test has a clean base
  git(["add", "-A"], jail);
  git(["commit", "-qm", "applied diff-1"], jail);

  // ================= DIFF: conflicting/invalid -> rollback =================
  log("\n[DIFF] conflicting/invalid patch is rejected and the tree is rolled back");
  // A patch that references context that does not exist -> will not apply.
  const badPatch = `diff --git a/hello.txt b/hello.txt
index 0000000..1111111 100644
--- a/hello.txt
+++ b/hello.txt
@@ -1,3 +1,3 @@
 THIS CONTEXT DOES NOT EXIST
-some other nonexistent line
+replacement
 trailing nonexistent
`;
  const treeBefore = git(["status", "--porcelain"], jail).stdout;
  const helloBefore = fs.readFileSync(path.join(jail, "hello.txt"), "utf8");
  decisions.set("diff-2", { confirm: true });
  cloud.send({ type: "diff-proposed", diffId: "diff-2", patch: badPatch });
  const diffRes2 = await cloud.waitFor(
    (m): m is Extract<BridgeToServer, { type: "diff-result" }> =>
      m.type === "diff-result" && m.diffId === "diff-2",
  );
  assert(diffRes2.status === "rejected", "conflicting patch reported as rejected");
  const treeAfter = git(["status", "--porcelain"], jail).stdout;
  const helloUnchanged = fs.readFileSync(path.join(jail, "hello.txt"), "utf8");
  assert(treeAfter === treeBefore, "working tree status is unchanged after rejected patch");
  assert(helloUnchanged === helloBefore, "hello.txt content unchanged after rejected patch");

  // ================= DIFF: jail escape =================
  log("\n[DIFF] patch whose target escapes the jail is rejected before touching disk");
  const escapePatch = `diff --git a/../../etc/evil b/../../etc/evil
--- a/../../etc/evil
+++ b/../../etc/evil
@@ -0,0 +1 @@
+pwned
`;
  decisions.set("diff-3", { confirm: true });
  cloud.send({ type: "diff-proposed", diffId: "diff-3", patch: escapePatch });
  const diffRes3 = await cloud.waitFor(
    (m): m is Extract<BridgeToServer, { type: "diff-result" }> =>
      m.type === "diff-result" && m.diffId === "diff-3",
  );
  assert(diffRes3.status === "rejected", "jail-escaping patch rejected");
  assert(!fs.existsSync("/etc/evil"), "no file was written outside the jail");

  // ================= EXEC: approve, runs, real stdout =================
  log("\n[EXEC] local_exec echo within jail -> PARKS -> APPROVE -> real stdout, exit 0");
  decisions.set("call-echo", { approve: true });
  cloud.send({
    type: "tool-call",
    toolCallId: "call-echo",
    toolName: "local_exec",
    input: { argv: ["echo", "hello-from-local-machine"], cwd: ".", reason: "probe" },
  });
  const parkEcho = await cloud.waitFor(
    (m): m is Extract<BridgeToServer, { type: "tool-approval-request" }> =>
      m.type === "tool-approval-request" && m.toolCallId === "call-echo",
  );
  assert(!!parkEcho.approvalId, "echo call PARKED with a stable approvalId");
  const echoOut = await cloud.waitFor(
    (m): m is Extract<BridgeToServer, { type: "tool-output-available" }> =>
      m.type === "tool-output-available" && m.toolCallId === "call-echo",
  );
  assert(echoOut.output.stdout.trim() === "hello-from-local-machine", "real stdout streamed back");
  assert(echoOut.output.exitCode === 0, "exit code 0 reported");

  // ================= EXEC: observable side effect via marker =================
  log("\n[EXEC] APPROVE a command with an observable side effect (marker file)");
  decisions.set("call-marker", { approve: true });
  cloud.send({
    type: "tool-call",
    toolCallId: "call-marker",
    toolName: "local_exec",
    // touch is allowlisted; create a marker inside the jail. No shell involved,
    // and the argv has no shell metacharacters (those are blocked by the shape
    // layer — see the metachar test below).
    input: { argv: ["touch", "did-run.marker"], cwd: "." },
  });
  await cloud.waitFor(
    (m): m is BridgeToServer =>
      m.type === "tool-output-available" && m.toolCallId === "call-marker",
  );
  const markerPath = path.join(jail, "did-run.marker");
  assert(fs.existsSync(markerPath), "approved command actually ran (marker file present)");

  // ================= EXEC: out-of-jail BLOCKED even if approved =================
  log("\n[EXEC] cat /etc/passwd -> BLOCKED by policy, never runs (operator set to APPROVE)");
  decisions.set("call-passwd", { approve: true }); // operator would approve!
  cloud.send({
    type: "tool-call",
    toolCallId: "call-passwd",
    toolName: "local_exec",
    input: { argv: ["cat", "/etc/passwd"], cwd: "." },
  });
  const passwdErr = await cloud.waitFor(
    (m): m is Extract<BridgeToServer, { type: "tool-output-error" }> =>
      m.type === "tool-output-error" && m.toolCallId === "call-passwd",
  );
  assert(/blocked by policy/.test(passwdErr.errorText), "absolute-path read blocked by policy");
  assert(
    !cloud.received.some(
      (m) => m.type === "tool-approval-request" && m.toolCallId === "call-passwd",
    ),
    "blocked command was NEVER parked for approval (fails before the operator)",
  );

  // ================= EXEC: traversal BLOCKED =================
  log("\n[EXEC] cat ../../etc/passwd traversal -> BLOCKED, never runs");
  decisions.set("call-trav", { approve: true });
  cloud.send({
    type: "tool-call",
    toolCallId: "call-trav",
    toolName: "local_exec",
    input: { argv: ["cat", "../../etc/passwd"], cwd: "." },
  });
  const travErr = await cloud.waitFor(
    (m): m is Extract<BridgeToServer, { type: "tool-output-error" }> =>
      m.type === "tool-output-error" && m.toolCallId === "call-trav",
  );
  assert(/blocked by policy/.test(travErr.errorText), "path traversal blocked by policy");

  // ================= EXEC: denied command BLOCKED =================
  log("\n[EXEC] rm -rf . (denylist) -> BLOCKED, never runs (operator set to APPROVE)");
  decisions.set("call-rm", { approve: true });
  cloud.send({
    type: "tool-call",
    toolCallId: "call-rm",
    toolName: "local_exec",
    input: { argv: ["rm", "-rf", "."], cwd: "." },
  });
  const rmErr = await cloud.waitFor(
    (m): m is Extract<BridgeToServer, { type: "tool-output-error" }> =>
      m.type === "tool-output-error" && m.toolCallId === "call-rm",
  );
  assert(/denied by policy/.test(rmErr.errorText), "rm blocked by command denylist");
  assert(fs.existsSync(path.join(jail, "keep.txt")), "jail files still intact (rm never ran)");

  // ================= EXEC: shell metachar BLOCKED =================
  log("\n[EXEC] echo a; rm b (shell metachar in argv) -> BLOCKED by shape layer");
  decisions.set("call-meta", { approve: true });
  cloud.send({
    type: "tool-call",
    toolCallId: "call-meta",
    toolName: "local_exec",
    input: { argv: ["echo", "a; rm -rf b"], cwd: "." },
  });
  const metaErr = await cloud.waitFor(
    (m): m is Extract<BridgeToServer, { type: "tool-output-error" }> =>
      m.type === "tool-output-error" && m.toolCallId === "call-meta",
  );
  assert(/shell metacharacters/.test(metaErr.errorText), "shell metachar argv blocked by shape layer");

  // ================= EXEC: DENY path =================
  log("\n[EXEC] allowlisted echo but operator DENIES -> never runs");
  decisions.set("call-deny", { approve: false });
  cloud.send({
    type: "tool-call",
    toolCallId: "call-deny",
    toolName: "local_exec",
    input: { argv: ["touch", "denied.marker"], cwd: "." },
  });
  const denied = await cloud.waitFor(
    (m): m is Extract<BridgeToServer, { type: "tool-output-denied" }> =>
      m.type === "tool-output-denied" && m.toolCallId === "call-deny",
  );
  assert(!!denied.approvalId, "denied call parked then returned output-denied");
  assert(!fs.existsSync(path.join(jail, "denied.marker")), "DENIED command never ran (no marker)");

  log(`\nAssertions: ${pass + fail}, Failures: ${fail}`);

  // ---- evidence (written before teardown so the saved log is complete) ----
  fs.writeFileSync(path.join(EVIDENCE, "transcript.json"), JSON.stringify(transcript, null, 2));
  fs.writeFileSync(path.join(EVIDENCE, "policy-decisions.json"), JSON.stringify(decisionLog, null, 2));
  fs.writeFileSync(
    path.join(EVIDENCE, "summary.json"),
    JSON.stringify({ assertions: pass + fail, pass, fail }, null, 2),
  );
  fs.writeFileSync(path.join(EVIDENCE, "eval-output.txt"), lines.join("\n") + "\n");

  bridge.close();
  await cloud.close();
  // cleanup temp jail
  try {
    fs.rmSync(jail, { recursive: true, force: true });
  } catch {}
  // Force exit so a lingering socket handle cannot keep the process alive.
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
