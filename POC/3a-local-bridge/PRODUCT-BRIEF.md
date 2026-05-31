# Product Brief: Local Bridge — let the cloud agent reach your machine (guarded diff-apply + local-exec)

> Status: Proof-of-concept complete (eval-backed). This brief argues whether to productize it.

## TL;DR

A thin local CLI/daemon (`bridge`) connects a running cloud session to the developer's own machine and does two things: streams the cloud agent's proposed diffs straight into the local working tree (preview → confirm → apply → clean rollback), and exposes a guarded `local_exec` tool so the agent can run commands the cloud sandbox physically cannot reach — local Postgres, attached hardware, VPN-only services. The POC proved both paths over a real websocket with 22 assertions and, critically, proved the security model: `cat /etc/passwd` and `rm -rf .` stay blocked **even when the operator approves them**. This is the highest-risk POC in the program — it is remote code execution on a dev machine — and that fact must dominate the go/no-go.

## The gap today

Today the cloud agent is sealed inside its per-session microVM. It can edit the repo, run commands against a clone, and open a PR, but it cannot touch anything that only exists on the developer's laptop or behind the developer's network. Three populations feel this acutely:

- **Developers whose app only runs locally.** The failing integration test needs the local Postgres with seeded data, a Redis on `localhost`, a device on USB, or a service reachable only through the corporate VPN. The cloud agent can read the code and guess, but it cannot reproduce or verify the fix where the bug actually lives.
- **Developers who want the work to land in their editor, not a PR.** The agent's diff currently arrives as a branch/PR they have to fetch and check out. There is no path for "apply what you just wrote directly into my working tree so I can keep going in my IDE this second."
- **Teams with compliance/network constraints.** Anything that must run inside the corporate perimeter is simply off-limits to a cloud sandbox, so the agent's usefulness drops to zero for exactly the workflows those teams care most about.

The result: the agent is great at greenfield and self-contained repos and weak precisely where real-world, environment-coupled debugging happens.

## What we'd build

A signed-in user installs a small local CLI (`bridge`), runs it inside their repo, and it authenticates to their active cloud session with a Better Auth session token over a websocket (the POC's mock cloud gates the **websocket upgrade** on that token — wrong/missing token gets a `401` and no socket at all). Once connected, two capabilities light up in the existing chat UI:

1. **Diff apply** — the agent's proposed patch streams down, the bridge shows a dry-run preview (`git apply --check`), the operator confirms, the patch applies to the real working tree, and any failure rolls the tree back byte-for-byte (proven: a conflicting patch left the tree status and file contents unchanged).
2. **Local exec** — the agent can call a `local_exec({ argv, cwd, reason })` tool that runs on the user's machine behind **per-command human approval** and a **default-deny, shell-free, jailed, env-stripped policy** that is checked before the operator is even asked and re-checked again at spawn time (TOCTOU defense). The proven mechanism reuses the repo's exact tool-lifecycle states (`packages/shared/lib/tool-state.ts`) and the approval/park-resume contract from POC 1b, so every chunk it emits already renders in the current TUI/web UI with no renderer changes.

The defining design choice: **argv only, never a shell string.** No `local_exec` input is ever passed to a shell. `shell: false` plus five scoping layers (shape → command allow/deny → working-dir jail → path-argument jail → env allowlist) mean operator approval is a *second* gate, never the only one.

## How users experience it

### Where it lives (exposure)

- **CLI install + auth.** `npm i -g @open-agents/bridge` (or a one-line installer). The user runs `bridge login` (opens a browser, mints a short-lived session-scoped token via Better Auth) then `bridge connect` from inside the repo they're working in. The daemon binds to exactly one session: it only has authority while that session owns the socket, and loses it when the session ends or the token is revoked.
- **Chat-side controls.** In the session UI, once a bridge is detected, a status pill appears: **"Bridge connected — your machine"**. Two new affordances become available: a **"Apply to my working tree"** button on any diff the agent proposes, and the agent gains the `local_exec` tool (registered in its `ToolSet` *only when a bridge is connected*, exactly as the integration plan describes).
- **Settings.** A "Local bridge" settings panel: view connected machine, the active allowlist/denylist, default jail root, per-exec timeout and output caps, and a "Revoke bridge access" kill switch. An audit log surface mirrors the bridge's append-only `decisionLog`.

### Sample UI

**The CLI approval prompt (the heart of the trust surface).** When the agent calls `local_exec`, the terminal where `bridge` runs prints a hard-to-fat-finger prompt:

```
┌─ Agent wants to run a command on THIS machine ──────────────┐
│ reason:  "reproduce the failing migration against local DB" │
│ argv:    ["bun", "run", "db:migrate:apply"]                  │
│ cwd:     ~/dev/myapp           (inside jail ✓)               │
│ policy:  passed all 5 layers   env: PATH HOME LANG (only)    │
│ timeout: 10s   output cap: 256 KiB                          │
│                                                             │
│   [a]pprove   [d]eny   [v]iew full policy   (default: deny) │
└─────────────────────────────────────────────────────────────┘
```

The argv is shown verbatim (never a reconstructed shell line, because there is no shell line). The default action is **deny**. Commands that fail policy never reach this prompt at all — they return a `tool-output-error` and the operator is never asked, so the prompt stream stays clean and the operator's attention is reserved for genuinely runnable commands.

**Chat-side states.** The diff card shows: *proposing → preview (with the dry-run result) → applied* or *rolled back*. The `local_exec` tool card shows the literal repo states: `approval-requested` (renders as "Awaiting your approval on your machine"), then `output-available` (real streamed stdout/stderr/exit) or `output-denied` ("You denied this command") or `output-error` ("Blocked by policy: path-argument jail"). The blocked case names the failing layer, so the user learns *why* the agent's request was refused.

### UX walkthrough

1. User is debugging a migration that only fails against their seeded local Postgres. They tell the agent so in chat.
2. User runs `bridge connect` in the repo. The chat shows **"Bridge connected — your machine"**.
3. Agent proposes a schema fix. User clicks **"Apply to my working tree"**; the bridge previews the patch, the user confirms, the patch lands in their editor's open files.
4. Agent calls `local_exec(["bun","run","db:migrate:apply"], cwd=repo)` to verify. The bridge runs the policy (passes), then **parks** and prompts in the terminal.
5. User reviews argv + cwd + reason, presses **[a]pprove**. The command runs jailed, real stdout streams back into the chat tool card, exit 0.
6. The migration now fails differently — a real reproduction. Agent iterates, proposes a second patch, and the loop repeats.
7. Later the agent tries `local_exec(["cat","/etc/passwd"])` (prompt-injected by a poisoned dependency README it read). The policy blocks it at the path-argument jail; the user is **never even asked**; the chat shows "Blocked by policy." Nothing ran.
8. User finishes, runs `bridge disconnect` (or closes the session); the local-exec authority evaporates.

## Value to the user

**Job to be done:** "Let the agent help me where my problem actually lives — on my machine, in my environment — without handing it the keys to my laptop."

- **Local-only reproduction (the killer scenario).** The bug only reproduces against the developer's seeded local database / Redis / message queue. With the bridge, the agent can run the failing test against the real local stack, see the real error, and iterate — instead of guessing blind from source. This is the single most compelling reason to build it.
- **Hardware / device work.** Firmware, USB peripherals, GPU-specific code paths, simulators — none of which exist in the cloud sandbox. `local_exec` (tightly scoped) lets the agent drive build-and-run loops against the real device.
- **VPN-only / perimeter-locked services.** Enterprise developers whose staging API, internal package registry, or database is reachable only inside the corporate network finally get an agent that can run end-to-end there, because the command executes from inside the perimeter on their machine.
- **Continue in my editor instantly.** Diff-apply means "take what you just wrote and put it in my working tree right now" — no fetch, no PR checkout, no context-switch.

## Value to the product

- **Differentiation.** Most cloud coding agents are sealed in a sandbox by construction. A *safe, auditable, default-deny* bridge to the user's machine is a capability competitors either don't have or implement recklessly. "We can reach your local environment, and here is exactly how we keep that safe" is a strong, defensible story.
- **Activation/retention.** It directly removes the "the agent can't reproduce my bug" wall that causes users to bounce. The workflows it unlocks (local DB, hardware, VPN) are sticky and recurring.
- **Expansion / enterprise.** Perimeter-locked teams are exactly the high-ACV accounts. A bridge with a tight, audited security model is a wedge into orgs that otherwise can't adopt a cloud agent at all. The decision log and revocation controls are the kind of thing a security review wants to see.
- **Strategic positioning.** It reframes the product from "cloud agent that opens PRs" to "agent that operates across cloud *and* local, with one trust model spanning both." That is a category-defining position — if, and only if, the security story is airtight.

## The case FOR (strong)

1. **It unlocks the workflows where the agent is currently useless.** Local-DB/hardware/VPN debugging is not a niche — it is where a large fraction of real bug-fixing happens. No amount of cloud-sandbox cleverness reaches it. The bridge is the only way in.
2. **The security model is already proven, not aspirational.** The POC didn't hand-wave safety — it asserted it. `cat /etc/passwd`, `cat ../../etc/passwd`, `rm -rf .`, and `echo a; rm -rf b` are all blocked, two of them *with the operator scripted to approve*, proving approval is necessary-but-not-sufficient. Side effects (marker files) prove what did and didn't run. This is a credible foundation.
3. **It reuses contracts we already ship.** The approval/park-resume flow is POC 1b's contract; the tool-lifecycle states are `packages/shared/lib/tool-state.ts` verbatim; the cloud step loop already pauses on `approval-requested` (`chat.ts:103`). The existing TUI/web renderers light up for `local_exec` for free. The new surface area is small and modeled.
4. **Diff-apply is a clean, low-risk win on its own.** "Apply to my working tree" is reversible (preview + snapshot + rollback), jail-bounded, and far less dangerous than exec. It could ship *alone* and still deliver the "continue in my editor" value while the exec path bakes.
5. **The default-deny posture means most attacks never reach a human.** The biggest practical risk with any approval system is operator fatigue. Here, malicious calls are auto-blocked by policy and never prompt the user — so the human is only asked about commands that already passed five layers. Tight scoping protects the fallible operator instead of leaning on them.

## The case AGAINST (strong)

1. **This is remote code execution on a developer's machine, requested by a semi-trusted agent — and that is the whole ballgame.** The agent can be steered by a malicious prompt, a poisoned repo, or a compromised upstream tool, and we *assume* it can emit arbitrary `local_exec` inputs and arbitrary patches. Every defense is in our own bridge process; **there is no OS-level sandbox in the POC** — the jail is path/argv enforcement, not a kernel boundary. One allowlist mistake, one interpreter escape, one symlink race, and the blast radius is the developer's entire user account. The honest steelman for "don't build it" is: the downside of a single bypass (exfiltrated SSH keys, wiped working tree, lateral movement inside a corporate network) is catastrophic and reputationally unrecoverable, and the upside is a convenience that a careful developer can get by running the agent's suggested command themselves.
2. **The allowlist contains its own escape hatches.** `node`, `bun`, and `git` are in the POC default set and are effectively arbitrary-code interpreters: `node -e "<any JS>"`, `git -c core.pager=…`, `git apply`, hooks, `git config`. The shape layer blocks shell metacharacters but a single `node -e` argument is a whole program. Productionizing means dropping interpreters from the default allowlist and gating them behind sub-policies — real, careful work, and a permanent source of "we forgot this one binary can do X" footguns.
3. **Operator fatigue is the realistic failure mode, and it's a human problem we can't fully engineer away.** A developer who approves every prompt converts the whole layered policy into theater for any command that *does* pass policy. Tight allowlists help, but the moment we loosen them for usefulness (and users will demand it), the human becomes the last line of defense — and humans click "approve."
4. **The support and trust burden is large and ongoing.** We are now shipping software that runs on customer laptops with the power to execute commands and modify files. That means CVE response, signed releases, an incident process for "the bridge ran something it shouldn't have," and a security-review burden every time the policy changes. This is a different operational commitment than a web app.
5. **Token handling raises the stakes.** The session token grants local-exec authority. It must be short-lived, revocable, never logged, and bound to one session. Any leak of that token is a leak of "run commands on the user's machine." That is a high-value secret we'd be minting and distributing to CLIs on untrusted laptops.

## Effort, dependencies & risk

- **Feasibility verdict (from the POC): feasible, and the security model holds — but Medium-Hard, because the security model *is* the work.** The diff path is reversible and jail-bounded; the exec path is constrained by a default-deny, shell-free, jailed, env-stripped, timeout-bounded policy enforced both before approval and at spawn. The mechanics are proven; the productionization risk is entirely in hardening.
- **Build size.** The transport (websocket fan-out from the session stream) and session-token verification on upgrade are both small and already modeled by the mock cloud. The real cost is: (a) OS-level sandboxing per exec (`sandbox-exec`/seatbelt on macOS, `bwrap`/seccomp/landlock on Linux, or a container/namespace), (b) hardening the allowlist (removing interpreters, sub-policies for `git` writes), (c) resource limits (`ulimit`/cgroups for CPU/mem/disk, which the POC does not cap), and (d) the CLI distribution + signing + update pipeline.
- **Dependencies.** Reuses the **POC 1b approval contract** and `packages/shared/lib/tool-state.ts` directly. Plugs into `apps/web/app/workflows/chat.ts` (existing `shouldPauseForToolInteraction` pause) and `apps/web/lib/auth/config.ts` (Better Auth session token on upgrade). No changes to `tool-state.ts` required.
- **Top risks + mitigations** (from the POC's own list): interpreter escape hatches → drop `node`/`bun`, gate `git` writes; no kernel boundary → add per-exec OS sandbox; operator fatigue → tight default-deny allowlist, show exact argv/cwd, default-to-deny, rate-limit prompts; token leakage → short-lived, revocable, session-bound, never logged; symlink-during-run and resource exhaustion → per-exec sandbox + `ulimit`/cgroups; diff snapshot gaps (submodules/LFS) → broaden snapshot coverage before GA.

## The decision

**The crisp question:** Do we ship a capability that gives a semi-trusted cloud agent the ability to execute commands on the developer's own machine — and are we prepared to own the security model, the OS-sandbox hardening, and the ongoing trust/support burden that requires?

**Recommended split decision:**

- **Diff-apply ("Continue in my editor / Apply to my working tree"): build now.** It delivers most of the "continue locally" value, is reversible and jail-bounded, and carries a fraction of the risk. (Note: POC 3b offers an arguably safer, daemon-free path to the same "continue locally" outcome — weigh 3a's diff-apply against 3b before committing.)
- **`local_exec`: build later, gated on a hard security bar.** Do not greenlight exec until: (1) per-exec OS-level sandboxing is in place, (2) interpreters are removed from the default allowlist and `git` writes are gated, (3) resource limits are enforced, and (4) the CLI has a signed-release + revocation + audit story that passes an external security review.

**Greenlight trigger for exec:** a documented threat-model sign-off plus a working OS-sandbox layer demonstrated against the POC's existing attack suite (the 22 assertions) *with interpreters in the allowlist* — i.e., prove the kernel boundary holds even when our policy is deliberately loosened.

**Success metrics:** for diff-apply — % of sessions that use "apply to working tree," rollback rate, time-to-first-local-iteration. For exec — number of local-only bugs reproduced/fixed that the cloud agent could not, approval-rate vs. block-rate (a high block-rate is *healthy*; a near-100% approve-rate is a fatigue alarm), and zero security incidents as a gating, non-negotiable metric.

**Suggested default:** **Build diff-apply now; build `local_exec` later behind the security bar above.** The exec capability is genuinely differentiating and the POC proves it *can* be done safely, but "can be done safely" depends on hardening that is explicitly not in the POC. Shipping exec before that hardening trades a unique capability against a catastrophic, hard-to-recover downside — not a trade to make on convenience grounds.
