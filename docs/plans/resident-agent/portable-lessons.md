# Portable Lessons from the Open Agents Fork

This document distills the operational scar tissue of this repository — a production Next.js/Vercel agent platform, ~2,100 commits deep, with durable workflows, sandboxed execution, background agents, and multi-environment deploys — into rules that survive a change of stack. Every lesson here was learned by shipping something that was green in CI and broken in production.

Use it during the resident-agent build as a design review checklist. When a design decision touches guards, durable execution, environment configuration, shared state, or agent self-reporting, find the matching lesson and answer its question *before* writing the code, not after the incident. The "Applies to" lines are conjectures for the planned Cloudflare architecture — a Durable Object per worker, a Workflow per turn, Sandbox SDK containers running coding-agent CLIs, R2 for persistence, and an MCP front door behind OAuth — not settled decisions.

## Guards and the configuration that feeds them

### A guard that passes its own tests proves nothing

This repo shipped four guards that were correct in isolation, passed their unit tests, and did nothing in production. Each was discovered only after it failed to prevent the thing it existed to prevent. The pattern never varied: the defect was found, the guard was written, unit tests called the guard *directly* and passed, and in the real path the guard received different inputs — stripped, unset, unvalidated — and silently allowed what it was written to block. CI was green the entire time. One instance: a branded `ProviderModelId` type whose mint accepted any string, so the brand compiled and blessed bad values. Another: a migration-target guard whose key input never reached it (next lesson).

**Portable form:** Green tests are evidence about the function, not about the system. A guard is not done until its refusal has been exercised through the real entry point, with the environment the real caller actually provides, and its exit code checked without a pipe (`cmd | tail` reports `tail`'s status). Prove the allow paths too — an over-firing guard on a deploy-gating path blocks every release, which is worse than the bug.

**Applies to resident agent service as:** The MCP front door will have authorization guards (OAuth scopes, per-worker grants, repo allowlists). Test each refusal through the actual Worker entry point and real OAuth token flow, not by calling the policy function. Run the "denied scope returns 403" case against a deployed dev environment, and keep must-stay-green allow cases for legitimate traffic.

### Configuration indirection silently defeats guards

The migration guard read `PRODUCTION_DB_HOST` from `process.env`. Turbo's build task runs in strict env mode and passes only its declared allowlist — the variable was undeclared, so under the real build the guard got `undefined` and failed open, inert in exactly the path it protected. Locally it was absent from `.env.example` too, so no developer machine armed it either. The enforcement test asserted the key was *present* in `.env.example` — but the template shipped it empty, so the test enforcing the guard committed the same error the guard was written to prevent.

**Portable form:** Every layer of indirection between a config value and the code that reads it (build-tool env allowlists, secrets managers, template files, platform env scoping) is a place the value can silently vanish. Presence of a key is not configuration — templates ship keys empty on purpose. Pin wiring with a test that derives expectations from the source (grep the guard for its own env reads; assert the deploy config declares every one), because a hand-copied list drifts exactly like the config did.

**Applies to resident agent service as:** Cloudflare Workers have per-binding and per-environment config (`wrangler.toml` vars, secrets, service bindings, preview vs production). Any guard reading a binding needs a wiring test that asserts the binding exists in every environment that runs the path — including preview deployments — derived from the code's reads, not a manual list.

### Choose fail-open vs fail-closed deliberately, and say which

The migration guard gates every deploy, so it must fail *open* when unconfigured — blocking all releases over a missing variable is worse than the bug. But when a reviewer named `PRODUCTION_DB_HOST` as missing, adding only that variable would have armed the guard while leaving `VERCEL_ENV` stripped: every production deploy would have looked local and been *refused*. A guard's inputs work as a set; add them together or not at all.

**Portable form:** Decide fail-open or fail-closed per guard based on what the path costs when blocked, write the choice and the reason in a module doc comment, and treat the guard's entire input set as one unit when arming it. An undocumented fail-open reads as a bug to the next engineer; an undocumented fail-closed becomes an outage.

**Applies to resident agent service as:** Auth at the MCP boundary and data-integrity checks on R2 writes should fail closed. Anything gating worker startup or scheduled turn execution — where a false refusal strands every resident agent — should fail open with a loud, inspectable "DISARMED" signal rather than silence.

## Durable execution and background work

### Durable workflow composition fails at runtime, not at build

Functions called from a `"use workflow"` body that touch Node modules need a `"use step"` directive; without it the DevKit fails at runtime with an error that points at call-sites, not the missing declaration. Workflow files reached only through dynamic `import()` are silently skipped by the compiler — the file loads, `start()` targets are never registered, and nothing errors at build time. A `node:*` import transitively pulled into a workflow file failed the Vercel build *only at deploy time*; local CI was green.

**Portable form:** Any framework that splits user code across two execution models (deterministic replay vs side-effecting steps) has a composition boundary the type system cannot fully check. Expect misconfiguration at that boundary to surface as silent non-execution or late runtime failure. Smoke-test that each workflow actually starts and completes one turn in a real environment; a registered-looking manifest is not proof of a runnable workflow.

**Applies to resident agent service as:** Cloudflare Workflows have the same shape: `step.do()` closures are the durable/side-effect boundary. Verify every turn-workflow actually executes end-to-end in a deployed environment — a workflow that compiles but is never triggered, or whose step throws unclassified, will look identical to "agent is idle" from the outside.

### Step boundaries are serialization boundaries

A workflow step that returned function-valued agent hooks compiled fine and failed in production; step return values must be plain serializable data. The fix was to return flags/IDs from the step and rebuild closures in the ordinary workflow frame before use.

**Portable form:** Nothing that crosses a durability boundary can carry behavior — only data. Design step payloads as IDs and flags, and rehydrate capabilities (clients, closures, callbacks) on the consuming side.

**Applies to resident agent service as:** Workflow steps and Durable Object alarms on Cloudflare persist state across replays and restarts. Container handles, MCP sessions, and OAuth token *objects* must never cross a step boundary — pass the worker ID or credential reference and re-acquire.

### Claim the lease after start, and reconcile instead of failing

Sandbox lifecycle code persisted `lifecycleRunId` before calling `start(...)`; canceled fire-and-forget kicks stranded stale leases. The fix: start first, let the durable workflow claim and verify its own lease. Separately, the lifecycle evaluator had to retry after a "not due yet" verdict — without retry the sandbox never hibernated unless a new event kicked a fresh workflow — and snapshot-in-progress `422`s had to be treated as idempotent conditions to reconcile, not failures.

**Portable form:** Durable schedulers need three properties built in from the start: ownership is claimed by the run itself after it exists, "nothing to do yet" schedules the next evaluation rather than terminating, and duplicate or in-progress operations reconcile to success instead of erroring.

**Applies to resident agent service as:** A Durable Object per worker plus alarms is exactly this shape. The DO should claim its turn-Workflow run after the Workflow exists, alarms must re-arm themselves after every "not due" evaluation, and a container snapshot/restore already in flight must read as `alreadyRunning`, not an error.

## Environment isolation and config hygiene

### Environments share state until you prove they don't

Preview and Production shared one `POSTGRES_URL`, and the build ran migrations on every deploy — so every PR preview applied unmerged migrations to the production database, confirmed by a migration recorded on prod 29 seconds after a preview deploy started. AGENTS.md actively asserted the opposite ("preview deployments never touch production data"), which is why nobody checked. Separately, Neon serves one database at two hostnames (`-pooler` and direct); comparing raw hostnames let the direct variant through and recreated the whole hazard.

**Portable form:** Never assert environment isolation — demonstrate it by pulling each environment's actual config and comparing resource identities, normalized for aliases (pooler hosts, custom domains, replica endpoints). A doc that describes intended architecture as current fact is worse than no doc: it converts a checkable fact into an assumption. When correcting one, say explicitly that older copies are wrong.

**Applies to resident agent service as:** Preview and production Workers will both want Durable Objects, R2 buckets, and Queues with similar names. Bind each environment to physically separate namespaces/buckets, verify it by listing the actual bindings per environment, and write a guard that refuses a production-identified resource from a non-production build — exercised through the real deploy path.

### Unused variables are armed traps

`.env.local` carried `DATABASE_URL`, `PGHOST`, and similar variables holding *production* credentials that nothing read — until an ad-hoc script reached for `DATABASE_URL` by convention and silently operated on the wrong database while the app (reading `POSTGRES_URL`) looked consistent. Both databases held similar user data, so the mistake was invisible.

**Portable form:** A credential that exists but is unused is not harmless; it is a trap for the next script, tool, or agent that follows naming convention. Delete unused credentials, or repoint them at the same target the app reads. Before any data operation, source the connection from what the application code actually uses, not from convention.

**Applies to resident agent service as:** OAuth client secrets, container registry tokens, and LLM gateway keys will accumulate across wrangler configs, `.dev.vars`, and the Cloudflare dashboard. Audit for credentials that exist in more than one place with different values, and make the app the single reader of each secret's canonical location.

### Read the exact key before reporting what config points at

Two findings were wrong because a value was read loosely: `grep -o 'ep-...' .env.local | head -1` matched a different variable's value and attributed it to the key under investigation. One earlier lesson draft blamed the wrong allowlist for a scheduling bug for exactly this reason.

**Portable form:** Before reporting that a config points somewhere, read the specific key by name. Before generalizing from one checkout's state, say it is one checkout's state.

**Applies to resident agent service as:** When diagnosing "the staging worker hit the production bucket," print the actual binding resolution from the deployed environment (e.g. `wrangler` tail/logs or the dashboard's binding list), not a grep of the nearest config file.

## Shared-state ownership and concurrency

### Single writer, claimed atomically

Chat stream ownership lived in `chats.activeStreamId`. The bugs came in a family: pre-registration placeholders published to `activeStreamId` were cleared as stale by resume probes; `onFinish` writes raced new owners; an older run could clear a newer owner's token. The fix was a protocol: claims and clears are atomic compare-and-set operations keyed on the owner's token, upserts are refused on message-id scope conflict, and an older run can never clear a newer owner.

**Portable form:** Any field that records "who currently owns this work" is a lease, and leases need compare-and-set semantics, idempotent claims, and the rule that only the recorded owner may release. Multiple writers with last-write-wins will interleave eventually, and the failure looks like corruption, not a race.

**Applies to resident agent service as:** A Durable Object gives single-writer semantics *per object* for free — use it, and keep exactly one DO as the owner of a worker's turn state. Anything that must live outside the DO (R2 blobs, queue messages, container exec) needs an ownership token written by the DO and checked by the writer, with CAS on handoff. Never let a turn Workflow write worker state directly.

### Never coerce on read

A user's chosen default runtime profile was silently reset on every read: the write path was fixed and its unit tests passed, but a read-path normalizer coerced any non-built-in id back to the default, defeating the entire feature. Unit tests missed it; a live `create → set default → GET` chain found it immediately. The repo's rule is now: validate on write, resolve with typed failures, reset dangling references in the delete lifecycle — never coerce on read.

**Portable form:** Read paths should return what is stored or fail legibly. Every "helpful" fallback on a read path is a silent override of whatever the write path carefully validated, and no unit test of the write path will ever see it. Verify round-trips end to end: write a value, read it back through the real API, compare.

**Applies to resident agent service as:** Worker configuration (model choice, schedule, tool grants) will be written via MCP and read back by the DO and by status endpoints. If the DO's config loader normalizes or defaults any field, it can silently veto what the MCP write path accepted. Round-trip every writable field through the real read path in tests.

### Concurrent agents on shared state manufacture mirage bugs

Three naive-walker agents sharing one account generated convincing phantom criticals — "my change silently reverted," "the status flipped" — because each walker observed the others' writes. Three of three reported criticals were cross-contamination; the one real bug was found only by deterministic re-testing in isolation.

**Portable form:** Agents testing a system with shared mutable state will observe each other and report the interference as product bugs, with total confidence. Serialize state-mutating agents or give each its own data, and reproduce any agent-reported defect solo before ticketing it.

**Applies to resident agent service as:** Resident agents are *concurrent by design* — many workers sharing an account, a repo, a queue. Test suites and canaries need per-worker fixture isolation, and any anomaly report from one agent's logs must be correlated against its neighbors' activity before it is believed.

## Trust, verification, and tooling

### Never trust an agent's self-report — verify via the real path

A "managed runtime" label in the UI was not proof managed execution happened; a model saying it used managed runtime was not proof; a transcript showing tool calls was not proof. Enforcement had to be a tool boundary (managed mode physically removes direct mutation tools from the coordinator), and proof had to be a linked evidence bundle — run ids, sandbox attribution, setup probes, exit codes — that agrees across UI, persisted records, and tool outputs. The same discipline caught the read-coercion bug: not a test, but a curl chain through the real API.

**Portable form:** Any claim about what the system did must be verifiable from records outside the actor's own narration. Build the evidence trail (structured events with provenance: run id, worker id, container id, timestamps, redacted summaries) as part of the feature, not as an afterthought. If the surfaces disagree, the proof is incomplete.

**Applies to resident agent service as:** Every turn should emit a structured ledger: which DO, which Workflow run, which container, which CLI, which commands and exit codes — queryable independently of the agent's chat output. "Tests passed" in agent prose is marketing; the ledger row with the test command's exit code is the product.

### A green test can cover a path production never takes

A test mocked a streaming SDK to throw synchronously; the real SDK resolves, emits a start part, and rejects a derived promise. Two defects stayed green in CI for two days while every delegated worker failed in production with no attribution. Elsewhere, ten hand-written copies of a two-line library predicate diverged from the real one, hiding an entire class of tool from every test that used them. And mocks that accepted any string as a foreign key let an insert referencing a nonexistent run id pass tests and throw PG 23503 in production.

**Portable form:** A test double is a claim about a dependency's behavior, and claims rot. Import the real predicate instead of re-implementing it; model the real failure shape (async rejection, stream parts, FK enforcement), not a convenient one. When a test is green and production is broken, suspect the double first.

**Applies to resident agent service as:** The coding-agent CLIs in containers are the dependency most likely to be mocked. Keep at least one test lane that runs a real CLI in a real container against a disposable repo — mock-based suites will happily certify a protocol the CLI never speaks.

### Lint autofix is a code change

`bun run fix` silently rewrote `{ cause }` to `{ cause: <caught binding> }` inside a catch block, with zero warnings in its output. The original cause expression was deliberate — the stream's error part rather than the caught rejection — and the autofix put the generic message back, breaking a passing assertion after the fact.

**Portable form:** An autofixer is an unattended code modification with no author and no review. Run the test suite *after* any autofix, not before, and when a test passes before the fixer and fails after, suspect the fixer first. Suppressions belong on the exact line with a reason.

**Applies to resident agent service as:** Whatever formatter/linter the new stack adopts, wire CI so autofix never lands un-tested, and treat any "semantics-preserving" rewrite rule touching error handling as guilty until proven innocent.

### Generic error messages send investigations sideways

`"Workspace setup failed. Try again in a moment."` was the catch-all final return of an error mapper, reached for *any* unclassified failure. A production incident was investigated as a sandbox problem for an hour on the strength of that wording; the actual error was an unresolved model id. Compounding it, the failed turn's metadata recorded the app's default model because the crash happened before a model runtime existed — metadata on an abandoned turn describes the fallback, not the selection.

**Portable form:** A catch-all error string is a hypothesis generator, and it always generates the wrong one. Give every failure a classified kind, surface the real underlying error in operator-facing logs before forming any hypothesis, and never let fallback defaults be recorded as if they were observed facts.

**Applies to resident agent service as:** Turn failures across DO → Workflow → container → CLI will collapse into one user-facing message unless each hop propagates a typed error kind. Design the error taxonomy first; the MCP front door should return the classified kind, and operator logs the original cause.

## The meta-lesson

Every failure in this document was "green but broken": tests passed, CI passed, and the system was wrong, because the tests exercised functions while production exercised wiring — config allowlists, read-path fallbacks, workflow composition boundaries, ownership races, and mocks that lied. The single discipline that caught every one of them was exercising the real path: the real entry point, the real environment's config, the real round-trip, the real deploy. A rebuild does not avoid this class of failure by choosing a better stack; the wiring hazards just change their names. Budget for real-path verification from day one — the harness that boots a real worker, runs a real turn in a real container, and asserts on the ledger is not a nice-to-have, it is the product's immune system.

## Sources

- `docs/agents/lessons-learned.md` — the curated fragility ledger (guard failures, workflow composition traps, environment isolation incidents, sandbox lifecycle and stream-ownership races, tooling hazards).
- `docs/process/guard-integrity.md` — the four inert guards, the real-entry-point / exit-code / allow-path / input-set / fail-open-closed checklist, and the test-double doctrine.
- `docs/process/managed-runtime-proof-standard.md` — proof levels and the evidence-bundle contract behind "never trust self-report."
- `docs/process/observability-discipline.md` — the required-questions checklist and the rule that completion must be backed by records, not transcripts.
- `docs/process/session-durability-proof.md` — the stream-ownership compare-and-set protocol and safe evidence contract for durable sessions.

