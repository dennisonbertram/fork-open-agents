# Product Brief: Structured Per-Tool Approval Gate

> Status: Proof-of-concept complete (eval-backed). This brief argues whether to productize it.

## TL;DR
A reusable, policy-driven "this action needs your sign-off" gate that parks any outward-facing or destructive tool call (destructive bash, `git push --force`, `git reset --hard`, external API writes, outbound messages) behind a human decision, then resumes on approve or returns a denied result on deny. It serves every user who wants the agent to move fast on safe work but pause before anything irreversible. The core bet: a single, consistent, trustworthy "park → approve/deny" affordance lets users grant the agent *more* autonomy, not less, because the dangerous edges are reliably fenced. Recommendation: build it — it's low-risk, mostly wiring over primitives the repo already has, and it's a safety prerequisite for the browser tool and MCP client.

## The gap today
Today approval is a one-off, hard-coded special case. `bashTool` carries an inline `commandNeedsApproval()` regex block in `packages/agent/tools/bash.ts`, and the web client knows how to render that single tool's `approval-requested` state. There is no general, reusable gate: every new outward-facing tool would have to re-implement its own ad-hoc "should I pause?" logic, and there's no shared policy describing *what classes of action* are dangerous. So the moment we add a browser tool that navigates arbitrary URLs, an MCP client that hits external services, or any `git push` / external-write capability, each one either ships ungated (unsafe) or reinvents the bash special-case (inconsistent, divergent, error-prone). Users get an approval prompt for one risky thing (some bash) and silent execution for others, which is exactly the inconsistency that erodes trust in an autonomous agent.

## What we'd build
A composable approval policy plus a uniform gate behavior across all outward-facing tools. Concretely: a `packages/agent/tools/approval-policy.ts` module with layered policies (`bashPolicy` lifted out of `bash.ts`, plus `gitPushPolicy`, `externalWritePolicy`, composed first-match-wins), and `needsApproval: (input) => classify(toolName, input).requires` set on each outward-facing tool. The POC proved the four-path contract — **park / approve / deny / passthrough** — with 22 real-state assertions and an observable marker-file side effect: a destructive action parks without executing, approve runs it and streams `output-available`, deny streams `output-denied` and the side effect *never* happens, and safe actions pass straight through with no prompt. Crucially it maps onto primitives that already exist: AI SDK v6 `needsApproval`, the `approval-requested` / `output-denied` states in `packages/shared/lib/tool-state.ts`, the pause boundary in `apps/web/app/workflows/chat.ts` (`shouldPauseForToolInteraction`), and the existing approval-response persistence (`persist-tool-results.ts`). No new framework plumbing and no `tool-state.ts` changes are required — the net new work is the policy module plus flipping `needsApproval` on more tools.

## How users experience it
### Where it lives (exposure)
- **Inline in the chat stream:** when a gated action is reached, the agent visibly stops and renders an **approval card** with Approve / Deny buttons. This is the primary surface — it appears exactly where the action would have run.
- **Settings → Agent Capabilities → "Require approval for":** a per-repo policy panel with toggles/levels for action classes (destructive file ops, `git push` / history rewrite, external API writes, outbound messages). Power users can loosen (auto-approve a class) or tighten (require approval for all writes).
- **An autonomy slider** at the session level — e.g. "Cautious / Balanced / YOLO" — that maps to a policy preset, so users pick a posture once instead of clicking through every action.

### Sample UI
- **Approval card (parked state):** a bordered card with a caution accent, a one-line title ("Approve `git push --force` to `origin/main`?"), the exact command/args in a code block, the policy reason ("History-rewriting push — irreversible"), and two buttons: **Approve** (primary) and **Deny**. The conversation below it is visibly suspended ("Agent paused — waiting for your decision").
- **Deny flow:** clicking Deny opens an optional reason field ("Why?"); the captured reason flows back to the agent so it can adapt. The card collapses to a "Denied — *reason*" chip.
- **Approve flow:** the card collapses to "Approved" and the tool result streams in below (`output-available`), the agent continues automatically.
- **Passthrough (no card):** safe actions (read-only `GET`, `ls -la`) never render a card — they just execute, so the gate is invisible until it matters.
- **States:** parked (awaiting), approved (resolved, result shown), denied (resolved, reason shown), expired (if no decision within TTL — "This request expired; ask the agent to retry"), and superseded (a second decision arrives for an already-resolved request — idempotently ignored).
- **Notification:** if the user has navigated away, a "1 action awaiting your approval" badge and optional push, since a parked agent is otherwise silently stalled.

### UX walkthrough
1. User: "Clean up the release branch and force-push it."
2. Agent edits files, commits, and reaches `git push --force origin release`.
3. The policy classifies it as history-rewriting; the agent **parks**. An approval card renders inline with the exact command, the reason, and Approve/Deny. The marker-file eval guarantees nothing has executed yet.
4. User reads the command, sees it targets `release` (not `main`), and clicks **Approve**.
5. The card collapses to "Approved"; the push executes; `output-available` streams the result; the agent reports success and continues.
6. Later: "Also reset main to last week's commit." Agent reaches `git reset --hard`, parks again. This time the user clicks **Deny** and types "wrong branch — leave main alone." The agent receives the denial + reason and replies "Understood, I won't touch main — did you mean `release`?" The destructive reset never ran (no marker).

## Value to the user
**Job-to-be-done:** "Let the agent work autonomously, but make sure I get the final say on anything I can't undo — consistently, every time, for every kind of risky action." Scenarios:
- **Confident delegation:** a user sets autonomy to "Balanced" and walks away, trusting that file edits and tests run freely but pushes and external writes will wait for them — turning a babysat session into a fire-and-forget one.
- **Catching the near-miss:** the agent, mid-cleanup, is about to `git reset --hard` the wrong branch; the approval card surfaces the exact target and the user denies it before damage. The gate paid for itself in one click.
- **Outbound safety:** the agent drafts a Slack message / external API write to production; the card lets the user eyeball the payload before it leaves the sandbox, which is the difference between trusting the agent with integrations and not.

## Value to the product
This is the **trust substrate** that makes every other risky capability shippable. It's the difference between "the agent can push code / browse / call your tools" being a scary liability versus a controllable feature. It's a direct enabler of expansion — you can safely ship `git push`, external writes, and (with 1a/1c) browsing and arbitrary MCP tools *because* there's a uniform fence. Strategically it positions open-agents as the *governable* autonomous agent: enterprise and team buyers care far more about "can I control what it's allowed to do without supervision" than about raw capability. A consistent, auditable approval trail is also the seed of an audit-log / compliance story that terminal-only competitors don't naturally have.

## The case FOR (strong)
1. **It's a safety prerequisite, not a standalone feature.** The browser tool (arbitrary navigation) and MCP client (arbitrary external calls) are materially safer to ship behind this gate. Building it first de-risks the other two POCs.
2. **Proven and genuinely low-risk.** The four-path contract holds with 22 real-state assertions and a ground-truth marker file: the deny path leaves *no* marker, proving the side effect truly doesn't run while parked. Durability across a process restart is proven for the serialization shape (path F resumes from disk only).
3. **It rides primitives the repo already has.** AI SDK v6 `needsApproval`, the existing `tool-state.ts` states, the `chat.ts` pause boundary, and the existing approval-response persistence all exist today. Net new work is a composable policy module plus flipping a flag on more tools — not new plumbing or UI.
4. **It increases autonomy rather than limiting it.** Counterintuitively, a reliable fence lets users grant *more* freedom: they can confidently leave the agent running because the irreversible edges are guarded. This raises the ceiling on delegation.
5. **It generalizes cleanly.** The POC proved the same gate parks `git push --force` and external `POST`s while letting read-only `GET` and `ls -la` through — so one mechanism covers the whole growing surface of outward-facing tools.

## The case AGAINST (strong)
1. **End-to-end durability is an unproven hard dependency on POC 2b.** This POC proves the parked record is serializable and resumable *from persistence*, but NOT that Vercel's `"use workflow"` runtime durably suspends a real workflow across a serverless teardown and re-wakes on the resume POST. If the durable-workflow layer isn't ready, a long-parked approval risks a stuck or lost session — the riskiest gap, and it's outside this POC's control.
2. **A bad classifier is worse than no gate — it breeds false confidence.** The policy is only as safe as its patterns. The POC's `bashPolicy` flags only *known*-destructive patterns; production must keep the conservative "unknown → approve" default, or users will trust a fence that silently lets novel dangerous commands through. Maintaining and auditing this policy is permanent work.
3. **Approval fatigue can quietly nullify it.** If the gate prompts too often, users will reflexively click Approve (or slam the autonomy slider to YOLO), at which point the safety is theater. Tuning *what* parks — enough to catch real danger, rarely enough that each prompt is read — is a hard, ongoing product-design problem, not a one-time build.
4. **Race / double-decision and expiry are unmodeled.** Two resume POSTs for the same `approvalId` must be idempotent (production needs compare-and-delete against the DB); parked actions need TTL + notification. These are real correctness/UX gaps the POC explicitly leaves open.
5. **A simpler alternative already half-exists.** `bash.ts` already gates the most common dangerous case. One could argue for incrementally hard-coding approval on each new risky tool as it ships, deferring the general policy module until there are enough tools to justify the abstraction — avoiding premature generalization.

## Effort, dependencies & risk
- **Feasibility verdict (from POC):** Feasible and low-risk — four-path contract holds with real state assertions and an observable side effect, mapping entirely onto existing repo primitives.
- **Build size:** Small-to-medium. Extract `bashPolicy` into `approval-policy.ts`, add `gitPushPolicy` / `externalWritePolicy`, set `needsApproval` on outward-facing tools, add the Settings policy panel + autonomy preset, add TTL/notification and idempotent resume.
- **Cross-POC dependencies:** Hard dependency on **POC 2b** (durable workflow / job queue) for true cross-restart park/resume. Is itself a dependency *for* POC 1a (gate arbitrary navigation/destructive actions) and 1c (gate external MCP writes).
- **Top risks & mitigations:** (a) Durability → block GA on 2b proving real workflow suspend/resume; until then, scope to within-lifetime parks. (b) Classifier gaps → keep "unknown → approve" default, treat the policy as a reviewed, tested artifact. (c) Approval fatigue → autonomy presets + careful default of what parks + telemetry on approve/deny ratios. (d) Double-decision → compare-and-delete idempotency against the DB. (e) Expiry → TTL + operator notification.

## The decision
**The question to answer:** Do we want a single, consistent, governable approval surface for *all* outward-facing actions now — or keep hard-coding approval per-tool until the surface is larger? **Greenlight trigger:** POC 2b demonstrates durable workflow suspend/resume across a serverless teardown (or we accept within-lifetime-only parks for v1). **Success looks like:** outward-facing actions ship gated by default with a low false-approval rate (users actually read prompts), a measurable count of denials that prevented real damage, approve/deny telemetry showing the gate fires often enough to matter but rarely enough to not annoy, and zero double-execution incidents. **Suggested default: build now** as the foundation layer — it's small, low-risk, reuses existing primitives, and unblocks the safe shipping of 1a and 1c. Sequence it *before or alongside* the browser and MCP tools rather than after.
