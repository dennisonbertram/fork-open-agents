# POC 3a — Local bridge daemon/CLI (cloud agent ↔ user's machine)

A small local CLI/daemon (`bridge`) that authenticates to a cloud session and
bridges two capabilities between the cloud agent and the developer's machine:

1. **Diff apply** — streams the cloud agent's proposed patches into the local
   working tree (dry-run preview → operator confirm → apply → clean rollback on
   failure).
2. **Local exec** — exposes a guarded `local_exec` tool back to the agent so it
   can run commands on the user's machine for things the sandbox can't reach
   (local DB, hardware, VPN-only services), behind **explicit per-command
   operator approval** and **tight, layered scoping**.

This is a **meaningful eval, not a smoke test**: the mock cloud and the bridge
talk over a real websocket, against a throwaway git repo, and every path —
apply OK, apply rollback, exec approve, exec deny, out-of-scope blocked, auth
rejected — is asserted with **observable side effects** (real file content,
real marker files), not by trusting return values. Evidence is captured to
[`evidence/`](evidence/).

> **The security model IS the work here.** `local_exec` is remote code
> execution on a developer's machine, requested by a cloud agent. Most of this
> document and code is about constraining that.

## Goal

Prove that a cloud agent (the same surface as
`apps/web/app/workflows/chat.ts`, which streams `UIMessageChunk`s to a workflow
`Writable`) can hand work to the user's local machine through a thin, auditable
local agent that:

- authenticates with a session token (Better Auth session, see
  `apps/web/lib/auth/config.ts`),
- applies proposed diffs safely and reversibly,
- runs commands only after per-command human approval **and** only if they pass
  a default-deny, jailed, shell-free policy,
- streams real `stdout`/`stderr`/`exit` back, using the exact tool-lifecycle
  states the repo already renders (`packages/shared/lib/tool-state.ts`).

## What was built

All code is self-contained in this folder (`ws` + `zod` + types only; no root
`package.json`, root lockfile, or app/package source touched).

| File | Responsibility |
| --- | --- |
| `src/protocol.ts` | The cloud↔bridge wire protocol (Zod-validated). Models the subset of the chat stream relevant to the bridge plus the upstream replies. Tool-lifecycle field names (`approval-requested`, `output-available`, `output-denied`, `approval: { id, approved, reason }`) are copied verbatim from `packages/shared/lib/tool-state.ts` / `POC/1b-approval-gate` so it maps 1:1 onto production. |
| `src/policy.ts` | **The security policy.** Pure, synchronous, auditable. Five scoping layers (shape → command allow/deny → working-dir jail → path-argument jail → env allowlist) plus timeout/output caps. Default-deny. |
| `src/exec.ts` | The guarded runner. Spawns with `shell: false` (argv only), inside the jailed cwd, stripped env, hard timeout, bounded output. **Re-checks the policy at spawn time** (TOCTOU defense). |
| `src/diff-apply.ts` | Diff applier: dry-run preview (`git apply --check`), jail-escape rejection, snapshot, apply on confirm, **clean rollback** on failure. |
| `src/bridge.ts` | The `bridge` daemon. Connects over websocket with a bearer session token, dispatches `diff-proposed` and `local_exec` tool calls, **PARKS** for approval, and emits the tool-state chunks back. Pluggable `OperatorGate` (terminal prompt in prod, scripted in the eval). Append-only `decisionLog`. |
| `src/mock-cloud.ts` | Mock cloud session stream server. Authenticates the **websocket upgrade** against the session token (wrong/missing → `401`, no socket). Emits diffs + tool calls, records replies. |
| `src/eval.ts` | The end-to-end eval: 22 assertions across all paths, observable side effects, evidence capture. |

### Transport choice

A **real websocket** (`ws` library) between the bridge and the mock cloud. A
websocket is the right transport for a local CLI ↔ cloud bridge because the
handoff is **bidirectional and long-lived**: the cloud pushes diffs and tool
calls; the bridge pushes approvals, results, and streamed output. (SSE + POST
would also work — SSE down for cloud→bridge, POST up for bridge→cloud — and is
the natural fit if the cloud session is a Next.js route rather than a dedicated
socket server. The protocol in `src/protocol.ts` is transport-agnostic JSON, so
either substrate works.)

## The security model

### Threat model

The cloud agent is **semi-trusted at best**. It may be steered by a malicious
prompt, a poisoned repo, or a compromised upstream tool. We assume the agent
can emit **arbitrary** `local_exec` inputs and **arbitrary** patches. The
attacker's goals we defend against:

- read secrets outside the project (`cat /etc/passwd`, `cat ~/.ssh/id_rsa`,
  `cat .env`),
- escape the project directory (`../../`, absolute paths, symlinks),
- run destructive commands (`rm -rf`, `dd`, `mkfs`, fork bombs),
- escape argv into a shell (`echo a; rm -rf b`, `$(...)`, backticks, pipes),
- exfiltrate via the environment (read `AWS_*`, `GITHUB_TOKEN`, SSH agent),
- patch files outside the working tree,
- connect to the session without a valid token,
- run a command the operator never saw / never approved.

The operator (the developer at the machine) is trusted, but **fallible** —
approval is treated as **necessary but not sufficient**. Scoping is enforced
**before** the operator is asked *and again at run time*, so a careless
"approve" on a malicious command still cannot escape the jail.

### Scoping layers (all must pass, in order)

`local_exec` input is `{ argv: string[], cwd: string, reason?: string }` —
**never a shell string.**

1. **Shape** — argv only. Reject any token containing shell metacharacters
   (`; & | ` `` ` `` `$()` `<>` `{}` `* ? ~ ! #`). The executable (`argv[0]`)
   must be a **bare command name** (no `/`, no `./script`, no absolute path), so
   only an allowlisted command on `PATH` can be selected.
2. **Command denylist** (precedence) — `rm`, `sudo`, `ssh`, `curl`, `wget`,
   `bash`/`sh`/`zsh`, `env`, `dd`, `mkfs`, `shred`, `kill`, `chmod`, … are
   always rejected.
3. **Command allowlist** (default-deny) — only `echo`, `ls`, `cat`, `git`,
   `node`, `bun`, `pwd`, `touch` (the POC default set) may run. An empty
   allowlist runs nothing.
4. **Working-directory jail** — the resolved `cwd` must stay inside the jail
   root. Absolute paths and `..` traversal are rejected. The longest existing
   path prefix is `realpath`'d, so a **symlink** anywhere in the prefix pointing
   outside the jail is caught.
5. **Path-argument jail** — every argv token that looks like a path is resolved
   against the cwd and must land inside the jail. This blocks
   `cat /etc/passwd` and `cat ../../secret` even though `cat` is allowlisted.
6. **Env allowlist** — the child gets only `PATH`, `HOME`, `LANG`, `LC_ALL`,
   `TERM`. Tokens/credentials in the bridge's own environment are stripped.
7. **Timeout + output cap** — hard wall-clock kill (10s default) and a bounded
   output buffer (256 KiB default) returned to the cloud.

The runner (`exec.ts`) **re-evaluates the entire policy at spawn time**, so a
TOCTOU symlink swap or policy change between approval and execution is caught.

### Approval flow (park / resume)

This reuses the approval concepts proven in `POC/1b-approval-gate/` and the
tool-state model in `packages/shared/lib/tool-state.ts`:

1. Cloud agent calls `local_exec` → bridge runs the **pre-approval** policy
   check.
2. If the policy **blocks**, the bridge emits `tool-output-error` and the
   operator is **never even asked** (a blocked command is never parked).
3. If the policy passes, the bridge **PARKS**: emits a `tool-approval-request`
   chunk carrying a stable `approvalId` (renders as `approvalRequested: true`
   via `extractRenderState()`), and suspends.
4. Operator **approves** → re-check policy at run time → spawn → stream
   `tool-output-available` with real `stdout`/`stderr`/`exit`.
   Operator **denies** → `tool-output-denied`, command never runs.

### What is explicitly NOT allowed

- No shell. Ever. `shell: false`, argv only.
- No command outside the allowlist; nothing on the denylist.
- No path (cwd or argument) outside the jail; no absolute paths; no `..`; no
  symlink escape.
- No inherited environment beyond the allowlist.
- No execution of a blocked command, **even with operator approval**.
- No patch that targets a path outside the jail.
- No unauthenticated connection (the websocket upgrade is rejected).
- No unbounded runtime or output.

## How it was tested + evidence

```bash
cd POC/3a-local-bridge
bun install
bun run typecheck   # tsc --noEmit, clean
bun run eval        # 22 assertions, all pass; real websocket + temp git repo
```

Real eval output (every required path):

```
[AUTH] websocket upgrade is gated on the session token
  PASS: connection with WRONG token is rejected (no socket)
  PASS: connection with VALID token succeeds
[DIFF] valid patch (modify hello.txt + add new.txt) applies to tree
  PASS: valid patch reported as applied
  PASS: hello.txt content matches the proposed patch (real apply)
  PASS: new.txt was created by the patch
[DIFF] conflicting/invalid patch is rejected and the tree is rolled back
  PASS: conflicting patch reported as rejected
  PASS: working tree status is unchanged after rejected patch
  PASS: hello.txt content unchanged after rejected patch
[DIFF] patch whose target escapes the jail is rejected before touching disk
  PASS: jail-escaping patch rejected
  PASS: no file was written outside the jail
[EXEC] local_exec echo within jail -> PARKS -> APPROVE -> real stdout, exit 0
  PASS: echo call PARKED with a stable approvalId
  PASS: real stdout streamed back
  PASS: exit code 0 reported
[EXEC] APPROVE a command with an observable side effect (marker file)
  PASS: approved command actually ran (marker file present)
[EXEC] cat /etc/passwd -> BLOCKED by policy, never runs (operator set to APPROVE)
  PASS: absolute-path read blocked by policy
  PASS: blocked command was NEVER parked for approval (fails before the operator)
[EXEC] cat ../../etc/passwd traversal -> BLOCKED, never runs
  PASS: path traversal blocked by policy
[EXEC] rm -rf . (denylist) -> BLOCKED, never runs (operator set to APPROVE)
  PASS: rm blocked by command denylist
  PASS: jail files still intact (rm never ran)
[EXEC] echo a; rm b (shell metachar in argv) -> BLOCKED by shape layer
  PASS: shell metachar argv blocked by shape layer
[EXEC] allowlisted echo but operator DENIES -> never runs
  PASS: denied call parked then returned output-denied
  PASS: DENIED command never ran (no marker)

Assertions: 22, Failures: 0
```

Note both the `cat /etc/passwd` and `rm -rf .` cases have the operator scripted
to **APPROVE** — they are still blocked, proving approval is not sufficient.
"Did it run?" is proven by observable side effects: the marker file appears for
the approved command and is absent for the denied/blocked ones; the jail's
`keep.txt` survives the `rm` attempt.

### Captured evidence ([`evidence/`](evidence/))

- `eval-output.txt` — full assertion transcript ending in `Assertions: 22, Failures: 0`.
- `transcript.json` — every wire message in/out (the `tool-approval-request`
  with its stable `approvalId` and `local_exec` input, the streamed
  `tool-output-available`, the `tool-output-denied`, the `tool-output-error`
  for blocked commands, and the `diff-result`s).
- `policy-decisions.json` — the append-only policy/approval decision log:
  `diff-confirmed`, `diff-rejected-preview` (with reason), `parked-for-approval`,
  `approved-and-ran`, `blocked-by-policy` (with the failing **layer** + reason),
  `denied-by-operator`.
- `summary.json` — `{ assertions: 22, pass: 22, fail: 0 }`.

## Integration plan

The POC is built against the real integration points so wiring it in is
mechanical:

- **Session stream (`apps/web/app/workflows/chat.ts`).** The cloud agent step
  loop already streams `UIMessageChunk`s to a workflow `Writable` and **already
  pauses** when a part is `approval-requested` (`shouldPauseForToolInteraction`,
  chat.ts:103). `local_exec`'s park reuses this exact pause: emit the
  `tool-approval-request` chunk and the existing loop suspends until the
  approval response arrives — no new suspension machinery. The bridge is the
  remote consumer of that same chunk stream over a websocket fan-out from the
  session.
- **Auth (`apps/web/lib/auth/config.ts`).** The bridge presents a Better Auth
  session token as a bearer on the websocket upgrade. The cloud verifies it
  (`auth.api.getSession`-equivalent), binds the socket to `{ userId, sessionId }`,
  and rejects the upgrade with `401` otherwise — exactly what the mock server's
  `verifyClient` models. The bridge's local-exec authority is therefore
  **session-scoped**: it only runs while a valid session owns the socket.
- **Approval UI states (`packages/shared/lib/tool-state.ts`).** The bridge emits
  the literal states `extractRenderState()` consumes: `approval-requested` +
  `approval.id` → `approvalRequested` / `isActiveApproval`; `output-denied` +
  `approval.approved === false` → `denied` / `denialReason`;
  `output-available` / `output-error` for the terminal results. **No change to
  `tool-state.ts` is required** — the existing TUI/web renderers light up for
  `local_exec` for free.
- **`local_exec` as a session-scoped tool.** Register `local_exec` in the
  agent's `ToolSet` (alongside `bash`/`edit`/`write` in `packages/agent/tools`)
  **only when a bridge is connected for the session**. Its `needsApproval`
  generalizes `commandNeedsApproval()` from `packages/agent/tools/bash.ts`
  (reused conceptually in `POC/1b-approval-gate`): `local_exec` is *always*
  approval-gated. The tool's `execute` does not run in the cloud sandbox — it
  forwards the call over the bridge websocket and awaits the bridge's result,
  so the cloud never executes anything locally itself.
- **Diff apply** complements the existing `auto-commit`/`auto-PR` path
  (`chat.ts` `runAutoCommitStep`): instead of (or in addition to) committing
  sandbox changes upstream, the bridge can stream the proposed patch down to the
  developer's working tree for local review/iteration.

## Feasibility verdict

**Feasible, and the security model holds.** A thin local bridge can safely host
both capabilities. The diff path is reversible (preview + snapshot + rollback)
and jail-bounded. The exec path is constrained by a default-deny, shell-free,
jailed, env-stripped, timeout-bounded policy that is enforced both before
approval and at spawn time, so operator approval is a *second* gate rather than
the only one. Every chunk it emits already renders in the existing UI. The main
cost of real integration is the cloud-side websocket fan-out from the session
stream and the session-token verification on upgrade — both small, both modeled
here.

## Blind spots eliminated

- **"Approval is enough."** Disproven — `cat /etc/passwd` and `rm -rf .` are
  blocked **with the operator approving**. Scoping is independent of approval.
- **"Did the command actually run?"** Proven by marker-file side effects, not
  return values — present after approve, absent after deny/block.
- **Shell injection via argv.** `echo a; rm -rf b` is blocked by the shape
  layer; `shell: false` means even a passed-through metacharacter is a literal
  arg, never interpreted.
- **Patch escaping the working tree.** A patch targeting `../../etc/evil` is
  rejected at preview; nothing is written outside the jail.
- **Failed apply corrupting the tree.** A conflicting patch leaves the tree
  byte-for-byte unchanged (status + file content asserted).
- **Unauthenticated access.** Wrong token → the websocket upgrade fails; no
  socket, no capability.

## Remaining risks (highest-risk POC — be thorough)

- **Interpreter commands in the allowlist (`node`, `bun`, `git`).** These are
  legitimately useful but are **escape hatches**: `node -e "<arbitrary JS>"`,
  `git -c core.pager=... `, `git apply`, hooks, or `git config` can do nearly
  anything the user can. The shape layer blocks shell metacharacters, but a
  single `node -e` argument can still contain a full program. **Mitigation for
  production:** drop `node`/`bun` from the default allowlist; gate interpreters
  behind sub-policies (e.g. only `node <script-inside-jail>`, never `-e`/`-p`);
  or run under an OS sandbox (see below). The POC keeps them only to demonstrate
  the marker side effect with an allowlisted binary.
- **No OS-level sandbox.** The jail is path/argv enforcement in the bridge, not
  a kernel boundary. An allowlisted binary with a network capability (or a
  future allowlist mistake) can still reach the network or read files the user
  can read inside the jail. Production should layer `sandbox-exec`/seatbelt
  (macOS), `bwrap`/seccomp/landlock (Linux), or a container/namespace per exec.
- **`git` writes.** `git` is allowlisted for read-style use, but `git` can
  mutate (`reset --hard`, `checkout`, `clean`, hooks). A real deployment should
  either deny `git` write subcommands or run them through the existing
  approval-gated commit path rather than raw `local_exec`.
- **Symlinks created *during* a run.** The jail re-checks paths at spawn, but a
  long-running approved command could create a symlink and then follow it.
  Per-exec sandboxing (above) closes this.
- **Token handling.** The session token grants local-exec authority; it must be
  short-lived, revocable, and never logged. The bridge should bind to one
  session and refuse capability after the session ends or the token is revoked.
- **Operator fatigue / blind approval.** The biggest practical risk: a developer
  who approves every prompt. Mitigations: show the exact argv + cwd + diff of
  effect, default to deny, rate-limit prompts, and keep the allowlist tight so
  most malicious calls are auto-blocked and never reach a prompt at all.
- **Resource exhaustion beyond output/timeout.** CPU/memory/disk are not capped
  here. Production should add `ulimit`/cgroup limits per exec.
- **Diff snapshot completeness.** Rollback uses `git` snapshot semantics; a repo
  with submodules, LFS, or pre-existing index conflicts needs broader snapshot
  coverage than this POC's temp-repo case.
