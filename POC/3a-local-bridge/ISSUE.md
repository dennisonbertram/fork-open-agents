<!-- TITLE: feat: Local bridge — guarded diff-apply now, default-deny local-exec behind a security bar -->

## Why this matters

The cloud agent is sealed inside its per-session microVM. It can edit a clone,
run commands against it, and open a PR, but it cannot touch anything that only
exists on the developer's machine or behind the developer's network — the
seeded local Postgres a migration actually fails against, a USB device, a
GPU-specific code path, or a VPN-only staging API. For those workflows the agent
drops from "great" to "useless," because the bug lives where the sandbox cannot
reach. Developers also want the agent's work to land *in their editor right now*,
not as a branch/PR they fetch and check out.

This ticket scopes the production build of the **local bridge**: a thin,
authenticated local CLI/daemon (`bridge`) that (1) streams the cloud agent's
proposed diffs into the developer's real working tree (preview → confirm → apply
→ clean rollback) and (2) exposes a guarded `local_exec` tool so the agent can
run commands on the user's machine — behind explicit per-command operator
approval and a default-deny, shell-free, jailed, env-stripped policy.

`local_exec` is remote code execution on a developer's machine, requested by a
semi-trusted agent. **The security model is the work**, and it dominates the
go/no-go. The POC (PR #86) proved both paths over a real websocket with 22
assertions and proved that `cat /etc/passwd` and `rm -rf .` stay blocked *even
when the operator approves them*. Per the product brief's recommended split,
this ticket builds **diff-apply now** and treats **`local_exec` as gated** on a
hard, documented security bar that must clear an external threat-model review
before exec is enabled in any shipping build.

## User/operator path protected

- A signed-in developer running a cloud session installs `bridge`, authenticates
  with a short-lived session-scoped token, and runs `bridge connect` inside
  their repo.
- **Diff-apply (ship now):** the agent proposes a patch; the developer clicks
  "Apply to my working tree"; the bridge previews (`git apply --check`), the
  developer confirms, the patch lands byte-for-byte, and any failure rolls the
  tree back with no partial writes.
- **`local_exec` (gated):** the agent calls `local_exec({ argv, cwd, reason })`;
  the policy is evaluated *before* the operator is asked; runnable commands park
  for a terminal approval prompt; approved commands run jailed with real
  stdout/stderr/exit streamed back to chat; denied commands never run; commands
  that fail policy are blocked and the operator is never even asked.
- The protected security invariant: a careless "approve" on a malicious command
  still cannot escape the jail, read outside the project, reach a denylisted
  command, or interpret a shell metacharacter.

## Behavior contract

1. **Given** a developer with a valid Better Auth session, **when** `bridge
   connect` presents the session token on the websocket upgrade, **then** the
   cloud binds the socket to `{ userId, sessionId }`; **and given** a missing or
   wrong token, **when** the upgrade is attempted, **then** it is rejected with
   `401` and no socket is established (no capability without auth).
2. **Given** the agent proposes a valid patch, **when** the operator confirms
   the dry-run preview, **then** the patch applies to the real working tree and
   the chat diff card moves `proposing → preview → applied`.
3. **Given** a conflicting or invalid patch, **when** apply fails, **then** the
   working tree is rolled back byte-for-byte (status and file contents unchanged)
   and the card shows `rolled back` — there is never a partial write.
4. **Given** a patch whose target path escapes the working-dir jail
   (`../../etc/evil`, absolute path, symlink), **when** it is previewed, **then**
   it is rejected before anything is written to disk.
5. **Given** an allowlisted `local_exec` that passes all policy layers, **when**
   the agent calls it, **then** the bridge parks with a stable `approvalId`
   (`approval-requested`); on approve it re-checks policy at spawn time, runs with
   `shell:false` inside the jailed cwd, and streams real `stdout`/`stderr`/`exit`
   (`output-available`); on deny it returns `output-denied` and never runs.
6. **Given** an out-of-scope command (`rm -rf .`, `cat /etc/passwd`), **when**
   the operator is scripted to approve it, **then** it is still blocked by policy,
   is **never parked for approval**, returns `output-error` naming the failing
   layer, and produces no side effect (security invariant: approval is necessary
   but not sufficient).
7. **Given** argv containing shell metacharacters (`echo a; rm -rf b`,
   `$(...)`, backticks, pipes), **when** policy runs, **then** the shape layer
   rejects it; **and** because `shell:false`, any passed-through metacharacter is
   a literal argument, never interpreted (working-dir jail + shell-free
   invariants hold).
8. **Given** a connected bridge, **when** the session ends or the token is
   revoked, **then** local-exec authority evaporates immediately and no further
   command can run on that socket.

## Product and design spec

### UX — how users use it & how it's exposed

- **CLI install + auth.** `npm i -g @open-agents/bridge` (or a one-line signed
  installer). `bridge login` opens a browser and mints a short-lived,
  session-scoped Better Auth token; `bridge connect` (run inside the repo) binds
  the daemon to exactly one session. `bridge disconnect` drops authority.
- **Chat-side controls.** Once a bridge is detected, a status pill renders
  **"Bridge connected — your machine"**. A **"Apply to my working tree"** button
  appears on any agent-proposed diff. When `local_exec` is enabled (post
  security bar), the agent gains the tool, registered in its `ToolSet` *only
  while a bridge is connected for the session*.
- **Per-command approval prompt (the trust surface).** When the agent calls
  `local_exec`, the terminal running `bridge` prints a hard-to-fat-finger,
  default-deny prompt that shows the **verbatim argv** (never a reconstructed
  shell line — there is no shell line), the resolved `cwd` with an "inside jail
  ✓" marker, the agent's `reason`, the policy result ("passed all 5 layers"), the
  env allowlist actually granted (`PATH HOME LANG` only), and the timeout +
  output cap. The default action is **deny**; `[a]pprove / [d]eny / [v]iew full
  policy`. Commands that fail policy never reach this prompt — they return
  `output-error` and the operator's attention is reserved for genuinely runnable
  commands.
- **Settings.** A "Local bridge" panel: connected machine, active
  allowlist/denylist, default jail root, per-exec timeout/output caps, an audit
  log surface mirroring the bridge's append-only `decisionLog`, and a "Revoke
  bridge access" kill switch.

### UX — how the feature demonstrates & explains its value to the user

- The diff lands directly in the developer's open editor files: "take what you
  just wrote and put it in my working tree right now" — no fetch, no PR checkout.
- The local command result streams back into the chat tool card, so the agent
  (and the developer) sees the *real* error from the *real* local stack — the
  migration that only fails against the seeded local Postgres now fails *in
  front of the agent*, enabling true iteration instead of blind guessing.
- The blocked case is itself a value signal: when the agent's request is refused,
  the card names the failing policy layer, so the developer *sees the bridge
  protecting them* rather than silently doing something dangerous.

### UX — how it's clear what the feature is doing (states & feedback)

- **Bridge connection:** `auth-rejected` (pill shows "Bridge auth rejected", chat
  control hidden), `connected` (pill "Bridge connected — your machine").
- **Diff card:** `proposing` → `preview` (with the dry-run result) →
  `apply-ok` ("Applied to your working tree") or `apply-rolled-back` ("Apply
  failed — tree rolled back, nothing changed").
- **`local_exec` card (literal `tool-state.ts` states):**
  `parked-for-approval` (`approval-requested` → "Awaiting your approval on your
  machine"), `approved` (`output-available` → streamed real stdout/stderr/exit),
  `denied` (`output-denied` → "You denied this command"),
  `blocked-by-policy` (`output-error` → "Blocked by policy: <failing layer>").
- Every state already renders through `extractRenderState()` in
  `packages/shared/lib/tool-state.ts` — no renderer changes required.

### UX — how to test the UX, including regressions

- **CLI integration test (fail-before/pass-after):** drive `bridge` against a
  mock cloud over a real websocket and a throwaway git repo (the POC eval is the
  starting harness). Assertions on **observable side effects**: marker file
  present after approve, absent after deny/block; jail `keep.txt` survives an
  approved `rm -rf .`; `hello.txt` unchanged after a rejected patch; no file
  written outside the jail for a jail-escaping patch; wrong token → no socket.
  Write the failing assertion first for each new path, confirm red, then green.
- **Authenticated-local-UI smoke (chat controls):** with `POSTGRES_URL` and
  `BETTER_AUTH_SECRET` present and migrations applied, drive the session UI with
  Agent Browser: connect a (stubbed) bridge, assert the **"Apply to my working
  tree"** button appears, click it, assert the diff card transitions
  `proposing → preview → applied`; assert the `local_exec` card renders
  `approval-requested`, then `output-available`/`output-denied`/`output-error`
  copy for each branch. Check `agent-browser errors`/`console` and inspect the
  server logs after the smoke.
- **UX regressions to lock down:** the approval prompt must always default to
  **deny**; it must always show verbatim argv (never a shell reconstruction); a
  policy-blocked command must **never** render an approval prompt; the chat
  control must disappear when the bridge disconnects or auth is rejected.

## Integration spec

- **Session stream — `apps/web/app/workflows/chat.ts`.** The agent step loop
  already streams `UIMessageChunk`s to a workflow `Writable`
  (`type Writable = WritableStream<UIMessageChunk>`, chat.ts:101) and already
  pauses on `approval-requested` via `shouldPauseForToolInteraction`
  (chat.ts:103-107, gate at chat.ts:1271). `local_exec`'s park reuses this exact
  pause — emit the `tool-approval-request` chunk and the existing loop suspends
  until the approval response arrives; **no new suspension machinery**. The
  bridge is the remote consumer of that chunk stream over a websocket fan-out.
- **Auth — `apps/web/lib/auth/config.ts`.** The bridge presents a Better Auth
  session token as a bearer on the websocket upgrade; the cloud verifies it
  (`auth.api.getSession`-equivalent; sessions modeled as `auth_sessions`,
  config.ts:84-85), binds the socket to `{ userId, sessionId }`, and rejects the
  upgrade otherwise. Local-exec authority is therefore session-scoped.
- **Approval contract reuse (POC 1b) — `packages/shared/lib/tool-state.ts`.** The
  bridge emits the literal states `extractRenderState()` consumes:
  `approval-requested` + `approval.id` → `approvalRequested` / `isActiveApproval`
  (tool-state.ts:57-60); `output-denied` + `approval.approved === false` →
  `denied` / `denialReason` (tool-state.ts:55-56); `output-available` /
  `output-error` (tool-state.ts:58) for terminal results. **No change to
  `tool-state.ts` is required.**
- **`local_exec` as a session-scoped tool.** Register `local_exec` in the
  agent's `ToolSet` alongside `bash`/`edit`/`write` (`packages/agent/tools`) only
  when a bridge is connected. Its `needsApproval` generalizes
  `commandNeedsApproval()` (`packages/agent/tools/bash.ts:53`, `needsApproval`
  hook at bash.ts:68-73): `local_exec` is *always* approval-gated. The tool's
  `execute` does not run in the sandbox — it forwards the call over the bridge
  websocket and awaits the result, so the cloud never executes locally itself.
- **Diff-apply** complements the existing `runAutoCommitStep` path
  (`apps/web/app/workflows/chat.ts:48,595`): instead of (or in addition to)
  committing sandbox changes upstream, the bridge streams the proposed patch down
  to the developer's working tree.
- **Wire protocol** is transport-agnostic JSON (POC `src/protocol.ts`), so a
  websocket fan-out or SSE+POST both work; field names are copied verbatim from
  `tool-state.ts` so the mapping is 1:1.

## In scope

- Production `bridge` CLI: `login` (browser OAuth → short-lived session-scoped
  token), `connect` (bind to one session over an authenticated websocket),
  `disconnect`, status pill detection.
- Cloud-side websocket fan-out from the session stream in `chat.ts` and
  session-token verification on the upgrade (`401` on missing/invalid).
- **Diff-apply path (ship now):** dry-run preview, operator confirm, byte-exact
  apply, jail-escape rejection at preview, clean rollback on failure, append-only
  decision log.
- **`local_exec` mechanism, behind the security bar:** the five-layer
  default-deny policy (shape → command allow/deny → working-dir jail →
  path-argument jail → env allowlist), spawn-time re-check (TOCTOU defense),
  `shell:false` argv-only runner, hard timeout + bounded output, park/approve/deny
  flow emitting the existing tool-state chunks, terminal approval prompt.
- Settings panel surfacing allowlist/denylist, jail root, caps, audit log, and a
  revoke kill switch.
- Structured decision/observability logging with redaction (below).

## Out of scope

- **Enabling `local_exec` in any shipping build before the hard security bar is
  cleared.** Exec must not ship until ALL of: (1) per-exec **OS-level
  sandboxing** is in place (`sandbox-exec`/seatbelt on macOS;
  `bwrap`/seccomp/landlock on Linux; or a container/namespace per exec) — the POC
  jail is path/argv enforcement, **not** a kernel boundary; (2) **interpreters
  are removed from the default allowlist** (`node`/`bun` dropped; `git` write
  subcommands gated or routed through the approval-gated commit path, never raw
  `local_exec`) because `node -e "<any JS>"` / `git -c core.pager=…` are
  arbitrary-code escape hatches; (3) **resource limits** are enforced
  (`ulimit`/cgroups for CPU/memory/disk — not capped in the POC); (4) the CLI has
  a **signed-release + token-revocation + audit** story; and (5) a documented
  **threat-model sign-off** plus a working OS-sandbox layer demonstrated against
  the POC's 22-assertion attack suite *with interpreters deliberately
  re-enabled* (prove the kernel boundary holds even when our policy is loosened).
- Per-exec OS sandbox profiles themselves (separate hardening ticket gating
  exec).
- Submodule/LFS-aware diff snapshot coverage beyond the single-repo case.
- Multi-session / multi-machine bridge fan-in.

## Research and context sources

- POC PR: https://github.com/dennisonbertram/fork-open-agents/pull/86
- POC folder: `POC/3a-local-bridge/` (`README.md`, `PRODUCT-BRIEF.md`, `src/`).
- Eval evidence: `POC/3a-local-bridge/evidence/` — `eval-output.txt`
  (`Assertions: 22, Failures: 0`), `transcript.json` (every wire message),
  `policy-decisions.json` (append-only decision log with failing layer),
  `summary.json`.
- POC source seams: `src/policy.ts` (five layers), `src/exec.ts` (spawn-time
  re-check, `shell:false`), `src/diff-apply.ts` (preview/snapshot/rollback),
  `src/bridge.ts` (park/resume), `src/protocol.ts` (wire protocol),
  `src/mock-cloud.ts` (upgrade auth).
- Reused contracts: `POC/1b-approval-gate/` (approval/park-resume),
  `packages/shared/lib/tool-state.ts`, `apps/web/app/workflows/chat.ts`,
  `apps/web/lib/auth/config.ts`, `packages/agent/tools/bash.ts`.
- Process: `docs/process/feature-ticket-format.md`,
  `docs/process/managed-runtime-proof-standard.md`,
  `docs/process/observability-discipline.md`,
  `docs/process/development-workflow.md#authenticated-local-ui-smoke`.

## Agent todo checklist

- [ ] Read `POC/3a-local-bridge/src/{policy,exec,diff-apply,bridge,protocol}.ts`
      and `apps/web/app/workflows/chat.ts` (pause path) to map the protected path.
- [ ] **Diff-apply slice first.** Add a failing CLI integration test asserting a
      conflicting patch leaves the tree byte-for-byte unchanged (rollback) and a
      jail-escaping patch writes nothing outside the jail.
- [ ] Commit the failing test-only state on the work branch.
- [ ] Implement `diff-apply` (preview → confirm → apply → rollback) until the
      targeted tests go green.
- [ ] Add the cloud-side websocket fan-out from the session stream and
      session-token verification on upgrade; add a failing auth test (wrong
      token → no socket), confirm red, implement green.
- [ ] Wire the "Apply to my working tree" chat control and the
      "Bridge connected" pill; add the authenticated-local-UI smoke.
- [ ] Land the structured decision/observability logging with redaction and the
      grep-able debug recipes.
- [ ] **Gate `local_exec`:** implement the policy + runner + park/resume *behind a
      feature flag that is off by default*; do not enable it without the security
      bar. Port the 22 POC assertions as the regression suite.
- [ ] Open the security-review / threat-model sign-off issue and attach the
      OS-sandbox demonstration before flipping the exec flag in any build.
- [ ] Run targeted tests, the adjacent suite, `git diff --check`, and
      `bun --bun run ci`.
- [ ] Update process docs and capture observability evidence (screenshots +
      decision-log excerpt).

## Tests to add first

- **Auth:** websocket upgrade with a wrong/missing token is rejected — assert no
  socket is created (fail before the verification exists).
- **Diff-apply OK:** valid patch applies; assert real file content matches the
  patch and a new file is created (observable side effect, not return value).
- **Diff-apply rollback:** conflicting patch → tree status and `hello.txt`
  contents byte-for-byte unchanged.
- **Diff-apply jail escape:** patch targeting `../../etc/evil` rejected at
  preview; assert no file written outside the jail.
- **Exec approve (gated):** allowlisted command parks with a stable `approvalId`,
  approve → marker file present, exit 0 streamed back.
- **Exec deny:** allowlisted command denied → `output-denied`, marker absent.
- **Exec blocked-with-approval (the security proof):** `cat /etc/passwd` and
  `rm -rf .` with the operator scripted to **approve** → blocked, **never
  parked**, `output-error` names the failing layer, jail `keep.txt` survives.
- **Shape layer:** `echo a; rm -rf b` blocked by the shape layer.
- **Spawn-time re-check:** policy re-evaluated at spawn (TOCTOU) — a path that
  becomes a symlink-escape after approval is caught.

## Observability and user feedback

- **User-visible status:** the "Bridge connected — your machine" pill, the diff
  card states, the `local_exec` card states (parked/approved/denied/blocked), and
  the settings audit log mirroring the decision log.
- **Named service:** `local-bridge` emits structured events. Examples:
  - `bridge-connected` at **info** with `{ userId, sessionId, bridgeSessionId,
    machine }`.
  - `bridge-auth-rejected` at **warn** with `{ requestId, reason: "invalid-token"
    }` (token value never logged).
  - `diff-preview` at **info** with `{ sessionId, chatId, bridgeSessionId,
    files, jailEscape: boolean }`.
  - `diff-applied` / `diff-rolled-back` at **info/warn** with `{ bridgeSessionId,
    commandId, outcome }`.
  - `exec-parked` at **info** with `{ bridgeSessionId, commandId, command:
    argv[0], policyLayersPassed }` — **command args are NEVER logged**.
  - `exec-blocked` at **warn** with `{ bridgeSessionId, commandId, errorKind:
    "policy-blocked", failingLayer }`.
  - `exec-approved` / `exec-denied` at **info** with `{ bridgeSessionId,
    commandId, exitCode? }`.
- **Typed error kinds (`errorKind`):** `invalid-token`, `policy-blocked`,
  `jail-escape`, `apply-conflict`, `exec-timeout`, `output-cap-exceeded`,
  `operator-denied`.
- **Correlation IDs:** `userId`, `sessionId`, `chatId`, `requestId`, plus
  bridge-specific `bridgeSessionId` and `commandId` on every exec/diff event.
- **Redaction rules:** **never** log command argv beyond `argv[0]` (the bare
  command name), never log stdout/stderr payloads, env values, patch contents, or
  the session token. The append-only `decisionLog` records the *decision* and the
  *failing layer*, not the data.
- **Debug recipes:**
  `grep '"service":"local-bridge"' logs | grep '"bridgeSessionId":"<id>"'`;
  `grep '"event":"exec-blocked"' logs | grep '"failingLayer"'`.
- **Evidence expectation:** capture the eval transcript ending in
  `Assertions: 22, Failures: 0`, a screenshot of the terminal approval prompt,
  and a screenshot of each chat card state.

## Regression harness plan

- **Existing coverage:** the POC eval (`src/eval.ts`, 22 assertions over a real
  websocket + throwaway git repo) is the starting durable harness; port it into
  the package test suite.
- **New tests/smoke:** CLI integration test (diff-apply + exec paths, observable
  side effects) plus the authenticated-local-UI smoke for the chat controls.
- **Fixtures:** throwaway git repo with seeded `hello.txt`/`keep.txt`, a valid
  patch, a conflicting patch, a jail-escaping patch, a marker-file command, and
  the blocked-command set (`cat /etc/passwd`, `rm -rf .`, `echo a; rm -rf b`).
- **Fail-before/pass-after:** each path asserts a side effect that is *absent*
  before the implementation (marker file, applied content) or *present* and
  unchanged (rollback, survived `keep.txt`).
- **Limits not caught:** the harness uses process-level path/argv jailing, **not**
  an OS sandbox, so it cannot catch a kernel-boundary escape (network egress from
  an allowlisted binary, interpreter abuse) — that is exactly why exec is gated on
  the OS-sandbox demonstration, which needs its own proof artifact.

## TDD audit trail

- Red: commit failing diff-apply rollback + jail-escape tests (no implementation).
- Green: commit the diff-apply implementation that turns them green.
- Red: commit failing websocket auth test (wrong token → no socket).
- Green: commit upgrade verification.
- Red (gated, flag-off): commit the ported 22-assertion exec suite as failing
  against an unimplemented policy/runner.
- Green: commit the policy + `shell:false` runner + park/resume so the suite
  passes, with exec still behind the off-by-default flag pending security sign-off.

## Regression risks and concerns

- **Remote code execution attack surface.** This is RCE on a developer's machine
  requested by a semi-trusted agent. One allowlist mistake, one interpreter
  escape, one symlink race and the blast radius is the developer's entire user
  account (exfiltrated SSH keys, wiped tree, lateral movement inside a corporate
  network). The POC has **no OS-level sandbox** — the jail is process enforcement.
- **Interpreter escape hatches.** `node`/`bun`/`git` in any allowlist are
  effectively arbitrary-code interpreters (`node -e`, `git -c core.pager=…`,
  hooks, `git config`). The shape layer blocks shell metacharacters but a single
  `node -e` argument is a whole program. Mitigation: drop interpreters from the
  default allowlist; gate `git` writes.
- **Approval fatigue.** A developer who approves every prompt converts the layered
  policy into theater for anything that passes policy. Mitigation: tight
  default-deny allowlist (so most malicious calls never reach a prompt), default
  to deny, show verbatim argv + cwd, rate-limit prompts.
- **Token leakage.** The session token grants local-exec authority; it must be
  short-lived, revocable, session-bound, and never logged — a leak is a leak of
  "run commands on the user's machine."
- **Symlink-created-during-run / resource exhaustion.** Closed only by per-exec
  OS sandboxing + `ulimit`/cgroups, neither in the POC.
- **Diff snapshot gaps.** Rollback uses git snapshot semantics; submodules/LFS/
  pre-existing index conflicts need broader coverage before GA.

## Deploy or migration impact

- **Signed CLI release distribution.** Shipping software that runs on customer
  laptops with the power to execute commands requires a signed-release pipeline,
  an update channel, CVE-response process, and an incident runbook for "the bridge
  ran something it shouldn't have."
- **Token scoping/revocation.** Mint short-lived, session-scoped tokens bound to
  one session; provide server-side revocation and a settings kill switch; ensure
  authority evaporates when the session ends.
- **Schema:** an audit/decision-log surface may add a table or reuse session JSON;
  generate a Drizzle migration (`bun run --cwd apps/web db:generate`) and commit
  the `.sql` if `schema.ts` changes. Preview deployments get isolated Neon
  branches, so QA never touches production data.
- **Security review gate.** `local_exec` must not be enabled in production (or any
  shipped build) until the documented threat-model sign-off and the OS-sandbox
  demonstration against the loosened attack suite are complete. Diff-apply may
  ship independently ahead of this gate.

## Definition of done

- [ ] Protected user/operator path named (diff-apply + gated `local_exec`).
- [ ] Behavior proof captured **red first** (failing test observed before code).
- [ ] Red-test commit recorded on the work branch (or a documented exception).
- [ ] Green commit follows the red commit for each slice.
- [ ] Targeted tests pass (diff-apply OK/rollback/jail-escape; auth; exec suite).
- [ ] Adjacent suite passes.
- [ ] `git diff --check` is clean.
- [ ] `bun --bun run ci` passes.
- [ ] Regression harness implemented (ported 22-assertion eval + CLI integration
      test + authenticated-local-UI smoke).
- [ ] Observability evidence captured (eval transcript `22/0`, approval-prompt
      screenshot, chat-card-state screenshots, decision-log excerpt).
- [ ] Docs updated (process notes + lessons learned).
- [ ] Deploy notes included (signed CLI release, token scoping/revocation,
      migration if schema changed).
- [ ] **Security gate (blocking for exec): documented threat-model sign-off plus a
      working OS-sandbox layer demonstrated against the 22-assertion attack suite
      with interpreters re-enabled — required before `local_exec` is enabled in
      any shipping build.** Diff-apply may ship without this gate.
