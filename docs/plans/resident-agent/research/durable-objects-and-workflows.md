# Durable Objects & Workflows

**TL;DR:** Cloudflare's primitives map unusually well onto the resident agent service architecture. One SQLite-backed Durable Object per resident worker gives you a globally addressable, single-threaded actor with up to 10 GB of embedded, strongly consistent SQLite storage (billed per row read/written and per GB-month), WebSocket hibernation so idle workers cost nothing, and an alarm API for "wake me later" scheduling with at-least-once delivery. Cloudflare Workflows (GA since 2025-04-07) provide durable multi-step execution with per-step retries, sleeps up to a year, `waitForEvent` for human/agent-in-the-loop, unlimited per-step wall-clock time, and up to 10,000–25,000 steps per instance — a natural fit for executing agent turns as durable steps. The front-door Worker routes MCP requests to the right DO via `getByName()`/`idFromName()`, and the DO owns Workflow instance IDs in its own storage. The main caveats: an agent turn's *orchestration* fits comfortably in CPU limits (model/sandbox latency is I/O wait, not CPU), but each DO is single-threaded (~1,000 req/s soft limit) and 128 MB memory; there are no published cold-start latency numbers for waking a hibernated DO (UNVERIFIED — likely tens-to-hundreds of ms, must be measured); and Workflows step/storage billing only started 2026-08-10, so cost behavior at scale is young.

**Status / maturity (as of 2026-08-11):** Durable Objects are GA and mature; SQLite-backed storage GA'd in 2024 and is the recommended backend (KV backend is legacy); SQLite *storage* billing began 2026-01-07. Cloudflare Workflows went GA 2025-04-07 ("production-ready durable execution"); step and storage billing began no earlier than 2026-08-10 (announced in the 2026-07-07 changelog) — i.e., billing for those dimensions is brand new. Queues are GA and stable. This doc is based on live developers.cloudflare.com pages fetched 2026-08-11.

---

## Durable Objects: Storage (SQLite-backed)

Source: [Durable Object Storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [Limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)

### SQLite storage API

Each SQLite-backed DO has a **private embedded SQLite database**, accessible synchronously via `ctx.storage.sql`. Synchronous execution is a major ergonomics win for agent state access — no `await` round-trips for reads:

```ts
import { DurableObject } from "cloudflare:workers";

export class MyDurableObject extends DurableObject {
  sql: SqlStorage;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS artist(
        artistid    INTEGER PRIMARY KEY,
        artistname  TEXT
      );
      INSERT INTO artist (artistid, artistname) VALUES
        (123, 'Alice'),
        (456, 'Bob'),
        (789, 'Charlie');
    `);
  }
}
```

Cursor patterns (`sql.exec()` returns `SqlStorageCursor`):

```ts
// Row objects
let resultsArray = this.sql.exec("SELECT * FROM artist;").toArray();
// Raw column-value arrays + column names
let cursor = this.sql.exec("SELECT * FROM artist;");
let rawResults = cursor.raw().toArray();
// Exactly one row (throws otherwise)
let oneRow = this.sql.exec("SELECT * FROM artist WHERE artistname = ?;", "Alice").one();
// Billing introspection
console.log(cursor.rowsRead, cursor.rowsWritten);
// DB size in bytes
let size = ctx.storage.sql.databaseSize;
```

Key facts:

- **Transactions:** `ctx.storage.transactionSync(callback)` wraps synchronous SQL in a transaction (rolls back on throw). Explicit transactions are "no longer necessary" for KV-style code — a run of writes with no intervening `await` commits atomically, and input gates serialize concurrent events.
- **Migrations:** there is no built-in schema-migration framework; the documented pattern is `CREATE TABLE IF NOT EXISTS` in the constructor (which re-runs on every wake). Wrangler-level class migrations are handled via the `exports` field (`"storage": "sqlite"`) or the legacy `migrations: [{ tag: "v1", new_sqlite_classes: [...] }]` array. Class lifecycle ops (delete/rename/transfer) go through `exports` tombstones; deleting a class **permanently deletes all its data**. Storage backend is immutable once provisioned. Source: [Durable Objects migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)
- **Supported extensions:** FTS5 (full-text search, incl. `fts5vocab`), JSON functions, math functions. FTS5 is directly relevant for searching agent decision logs / plans.
- **Point-in-time recovery (PITR):** SQLite-backed DOs can restore storage to any point in the last 30 days via bookmarks: `ctx.storage.getBookmarkForTime(ts)` + `ctx.storage.onNextSessionRestoreBookmark(bookmark)` + `ctx.abort()`. Useful as an "undo" for agent memory corruption.
- **Full-storage behavior:** at the 10 GB cap, writes fail with `SQLITE_FULL`; reads and deletes keep working.

### KV vs SQLite backend

| | SQLite-backed (recommended) | KV-backed (legacy) |
| --- | --- | --- |
| SQL API | ✅ | ❌ |
| PITR | ✅ | ❌ |
| KV API | Synchronous (`ctx.storage.kv`), stored in hidden `__cf_kv` table | Async only |
| Storage per DO | **10 GB** (Paid) / 1 GB (Free) | Unlimited |
| Storage per account | Unlimited (Paid) / 5 GB (Free) | 50 GB (raiseable on request) |
| Key/value size | key+value combined ≤ 2 MB | key ≤ 2 KiB, value ≤ 128 KiB |
| Availability | Free + Paid | Paid only |

SQLite SQL-specific limits: max 100 columns/table, max 2 MB row/BLOB, 100 KB statement length, 100 bound parameters, 50-byte `LIKE`/`GLOB` patterns.

### Storage billing (SQLite backend, Workers Paid)

| Meter | Included | Overage |
| --- | --- | --- |
| Rows read | 25 billion / month | $0.001 / million rows |
| Rows written (incl. deletes, index row updates, each `setAlarm()`) | 50 million / month | $1.00 / million rows |
| Stored data | 5 GB-month | $0.20 / GB-month |

Row writes dominate agent-memory cost modeling: every plan update, decision-log append, and task-graph mutation is ≥1 row written, and **each index row updated counts as an additional row written**. An empty SQLite DB consumes ~12 KB; internal metadata tables count toward billable storage until `deleteAll()`.

## Hibernation, lifecycle, and cold start

Source: [Lifecycle of a Durable Object](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/), [WebSockets (Hibernation API)](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)

### Lifecycle states

| State | Meaning |
| --- | --- |
| Active, in-memory | Running, handling requests |
| Idle, in-memory, non-hibernateable | Waiting, but hibernation preconditions not met (billed) |
| Idle, in-memory, hibernateable | Waiting, eligible; runtime hibernates after ~10 s of inactivity |
| Hibernated | Evicted from memory; hibernatable WebSockets stay connected; **no duration charges** |
| Inactive | Fully removed from host; cold start on next request |

Hibernation requires ALL of: no `setTimeout`/`setInterval` pending; no in-flight awaited `fetch()`; no standard (non-hibernation) WebSocket API in use; no request still being processed; no active outbound `connect()` socket or outbound WebSocket. Non-hibernateable idle DOs are evicted to **inactive** after 70–140 s of inactivity. DOs can also shut down at any time (deploys, runtime updates, host moves); **there are no shutdown hooks** — the docs explicitly direct you to write state incrementally.

**What persists:** SQLite storage always persists. In-memory JS variables are lost on hibernate/evict (constructor re-runs on wake — keep it cheap). Per-WebSocket small state survives hibernation via `ws.serializeAttachment()` / `deserializeAttachment()` (max 16,384 bytes, structured-cloneable). Hibernated WebSockets stay connected at the network layer; incoming pings are answered by the runtime without waking the DO.

```ts
export class WebSocketHibernationServer extends DurableObject {
	async fetch(request) {
		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);
		this.ctx.acceptWebSocket(server); // hibernatable
		return new Response(null, { status: 101, webSocket: client });
	}
	async webSocketMessage(ws, message) { /* runs after wake; constructor re-ran first */ }
	async webSocketClose(ws, code, reason, wasClean) { ws.close(code, reason); }
}
```

**Cold-start latency: UNVERIFIED.** Cloudflare publishes no number for "time to wake a hibernated/inactive DO." The lifecycle docs say only that the constructor re-runs on the next event. Workers themselves are famous for ~0 ms cold starts, but a DO wake additionally requires the runtime to locate/reopen the object's SQLite state, so expect a small additional cost. This must be benchmarked before committing the design (see Open questions). Related data point: `setAlarm()` docs note alarms "usually execute within a few milliseconds after the set time, but can be delayed by up to a minute."

## Alarms / scheduling

Source: [Alarms API](https://developers.cloudflare.com/durable-objects/api/alarms/)

- One alarm per DO at a time: `setAlarm(ts)` overrides any existing alarm; `getAlarm()`; `deleteAlarm()`.
- **Guaranteed at-least-once execution**; handler retried on uncaught exception with exponential backoff from 2 s, up to 6 retries. `alarm(alarmInfo)` receives `{ retryCount, isRetry }`.
- Alarm handler wall-clock limit: **15 minutes**.
- Millisecond granularity; usually fires within a few ms, can be delayed up to ~1 minute during maintenance/failover.
- Each `setAlarm()` is billed as one row written.
- Documented pattern for many scheduled events per DO (directly applicable to per-worker timers, reminders, retries): store events in storage, keep the single alarm pointed at the soonest event, and reschedule from the handler:

```ts
async alarm() {
	const now = Date.now();
	const events = await this.ctx.storage.list({ prefix: "event:" });
	let nextAlarm = null;
	for (const [key, event] of events) {
		if (event.runAt <= now) {
			await this.processEvent(event);
			if (event.repeatMs) {
				event.runAt = now + event.repeatMs;
				await this.ctx.storage.put(key, event);
			} else {
				await this.ctx.storage.delete(key);
			}
		}
		if (event.runAt > now && (!nextAlarm || event.runAt < nextAlarm)) nextAlarm = event.runAt;
	}
	if (nextAlarm) await this.ctx.storage.setAlarm(nextAlarm);
}
```

This is the canonical "wake the worker later" primitive and also the documented way to "guarantee that operations within a Durable Object will complete without relying on incoming requests to keep the Durable Object alive."

## Durable Objects limits

Source: [Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)

| Feature | Limit (SQLite backend) |
| --- | --- |
| Number of objects | Unlimited |
| Classes per account | 500 (Paid) / 100 (Free) |
| Storage per DO | 10 GB (Paid) / 1 GB (Free) |
| Memory per DO | 128 MB (billed as full 128 MB regardless of use) |
| CPU per invocation (HTTP/RPC/WS message/alarm) | 30 s default, configurable to **5 min** via `limits.cpu_ms` |
| Wall time (RPC/HTTP) | Unlimited while caller connected |
| Wall time (alarm handler) | 15 min |
| Throughput per object | Soft limit ~1,000 req/s (single-threaded) |
| Outgoing connections per request | 6 |
| WebSocket message size (inbound) | 32 MiB |

**Execution model:** each DO is inherently single-threaded. The runtime uses **input gates** (storage ops in progress pause delivery of new events) and **output gates** (outgoing network messages held until prior writes flush) so single-threaded JS doesn't produce storage race conditions — you get serializable semantics without locks. Overloaded objects queue then return "overloaded" errors. CPU time is *active processing* only; waiting on model APIs, sandbox I/O, or storage does not count against CPU.

## Addressing & routing

Source: [Durable Object Namespace API](https://developers.cloudflare.com/durable-objects/api/namespace/), [Data location](https://developers.cloudflare.com/durable-objects/platform/data-location/)

- `idFromName(name)` — deterministic ID from a string (e.g. the resident worker's task ID). Same name → same object, globally. Most common pattern.
- `newUniqueId()` — random ID; you must persist the string yourself to find the object again.
- `idFromString(str)` — rehydrate a previously stringified ID.
- `getByName(name)` / `get(id)` — return a stub immediately (no round trip); object is lazily instantiated on first method call. RPC methods on the stub or `stub.fetch(request)` both work.
- Jurisdictions: `env.NS.jurisdiction("eu" | "us" | "fedramp")` pins where the object runs and stores data (GDPR/FedRAMP); same name in different jurisdictions = different objects.
- Location hints: `get(id, { locationHint: "wnam" | "enam" | "weur" | "eeur" | "apac" | ... })` — respected only on first creation. **Objects never move once created** (relocation is "planned for the future"); requests from elsewhere are forwarded to the object's home data center, adding latency. For a per-task worker, pick the hint near the sandbox/model region at creation.

Front-door routing for the MCP Worker is therefore trivial and cheap:

```ts
const stub = env.RESIDENT_WORKER.idFromName(taskId); // or getByName(taskId)
const result = await stub.handleMcpMessage(msg);     // RPC; billed as 1 request
```

## Durable Objects pricing (Workers Paid)

Source: [Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)

| Meter | Included / month | Overage |
| --- | --- | --- |
| Requests (HTTP, RPC sessions, alarm invocations; inbound WS messages at 20:1) | 1 million | $0.15 / million |
| Duration (wall-clock while active, billed at 128 MB) | 400,000 GB-s | $12.50 / million GB-s |
| SQLite rows read | 25 billion | $0.001 / million |
| SQLite rows written | 50 million | $1.00 / million |
| SQLite stored data | 5 GB-month | $0.20 / GB-month |

Critical cost mechanic for this design: **duration is billed whenever the DO is active or idle-but-not-hibernateable**. A resident worker holding an open *outbound* connection (e.g. to a sandbox) stays in memory and bills up to 15 min per connection even with no requests. Hibernatable WebSockets and alarms let an idle worker cost $0 in duration. The docs' own hibernation example (100 DOs × 100 WS connections, 1 msg/min) costs **$10/month total** vs ~$139–417/month without hibernation — hibernation is the single biggest cost lever.

## Workflows: programming model

Source: [Workflows overview](https://developers.cloudflare.com/workflows/), [Workers API](https://developers.cloudflare.com/workflows/build/workers-api/), [Sleeping and retrying](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/)

A Workflow is a class extending `WorkflowEntrypoint` with a `run(event, step)` method. Each `step.do()` is a durable, memoized checkpoint: its return value is persisted, and on failure/restart the Workflow resumes after the last completed step. Any JS control flow (loops, try/catch, `Promise.race`) is allowed around steps.

```ts
export class ImageProcessingWorkflow extends WorkflowEntrypoint {
	async run(event: WorkflowEvent, step: WorkflowStep) {
		const imageData = await step.do("fetch image", async () => { /* ... */ });

		const description = await step.do("generate description", {
			retries: { limit: 10, delay: "10 seconds", backoff: "exponential" },
			timeout: "30 minutes",
		}, async () => { /* model call */ });

		await step.waitForEvent("await approval", { event: "approved", timeout: "24 hours" });
		await step.sleep("cool down", "1 hour");           // up to 365 days
		await step.sleepUntil("release day", someDate);
	}
}
```

Semantics:

- `step.do(name, config?, callback)` — durable step. Default retry config: **5 attempts, 10 s delay, exponential backoff, 10 min per-attempt timeout**. Max 10,000 retries/step. Backoff: `constant | linear | exponential`, or a delay function receiving `{ ctx, error }` (useful for model rate limits). Steps returning large binary data can return a `ReadableStream<Uint8Array>`.
- `step.sleep(name, duration)` — up to 365 days; **does not count against the step limit**. `step.sleepUntil(name, timestamp)` for absolute times.
- `step.waitForEvent(name, { type, timeout })` — pause until `instance.sendEvent({ type, payload })` arrives; default 24 h timeout, then throws. This is the human-in-the-loop / external-signal primitive.
- `NonRetryableError` (from `cloudflare:workflows`) — aborts retries and fails the instance.
- **Rollback/saga:** `step.do(name, cb, { rollback: async ({ctx, output, error}) => {...} })` registers compensating actions, run in reverse step order on failure or on `terminate({ rollback: true })`.
- **Durability guarantees:** state persists between steps "for minutes, hours, or even weeks"; waiting/sleeping instances consume no CPU and don't count toward concurrency. Failed steps retry automatically; uncaught failure ends the instance in `errored` with state retained (30 days on Paid).
- **Instance management** (from any Worker/DO with the binding): `create({ id, params, retention })` (user-supplied IDs up to 100 chars; duplicate ID throws), `createBatch()` (up to 100, idempotent), `get(id)`, `status()`, `pause()/resume()`, `restart({ from: { name, count, type } })` (re-runs from a named step, reusing cached results of earlier steps — useful for re-running a bad agent turn), `terminate({ rollback })`.
- Instance statuses: `queued | running | paused | errored | terminated | complete | waiting | waitingForPause | unknown`; `status()` also returns `output` (the `run()` return value) and rollback outcome.

## Workflows limits & pricing

Source: [Limits](https://developers.cloudflare.com/workflows/reference/limits/), [Pricing](https://developers.cloudflare.com/workflows/reference/pricing/)

| Feature | Free | Paid |
| --- | --- | --- |
| CPU per step | 10 ms | 30 s default, configurable to **5 min** (`limits.cpu_ms`) |
| Wall time per step | Unlimited | **Unlimited** (e.g. waiting on model APIs) |
| Steps per instance | 1,024 | 10,000 default, up to 25,000 (`limits.steps`) |
| Max persisted state per instance | 100 MB | 1 GB |
| Max step result / event payload | 1 MiB | 1 MiB |
| Max `step.sleep` | 365 days | 365 days |
| Concurrent running instances / account | 100 | **50,000** (waiting/sleeping instances don't count) |
| Instance creation rate | 100/s | 300/s per account, 100/s per workflow |
| Queued instances | 100,000 | 2,000,000 |
| Subrequests per instance | 50 | 10,000 default, up to 10M (`limits.subrequests`) |
| State retention after completion | 3 days | 30 days (tunable per-instance) |

Pricing (Paid): requests 10M included then $0.30/M; CPU 30M ms included then $0.02/M ms; storage 1 GB-month included then $0.20/GB-month; **steps 500k included then $0.80 per 100k steps**. Step and storage billing began **2026-08-10** (per the 2026-07-07 changelog) — one day before this writing, so real-world billing experience is minimal. Idle/sleeping/waiting instances incur no CPU.

## Durable Object ↔ Workflow patterns

Source: [Trigger Workflows](https://developers.cloudflare.com/workflows/build/trigger-workflows/), [Workers API](https://developers.cloudflare.com/workflows/build/workers-api/)

The docs explicitly list "within a Durable Object" as a supported trigger location. The natural composition for the resident agent service:

1. **DO owns the instance ID.** The resident-worker DO calls `await env.AGENT_TURN_WORKFLOW.create({ id: `${workerId}-turn-${n}`, params: {...} })` and writes the instance ID into its SQLite task graph. User-supplied instance IDs (≤100 chars) make turns addressable and prevent duplicates (duplicate `create` with same live ID throws).
2. **Results back to the DO.** There is no push callback from Workflow → DO. Options: (a) the Workflow's final step calls the DO's RPC/`fetch` method with the result (DO binding is available via `env` inside the Workflow — same script or via `script_name` cross-script binding); (b) the DO polls `get(id).status()` (which includes `output` when complete), e.g. from an alarm; (c) an MCP client polls the DO, which proxies `status()`. Option (a) is the standard fan-in pattern.
3. **Events into a running Workflow:** `instance.sendEvent({ type, payload })` → `step.waitForEvent`. Payload ≤ 1 MiB. Use for approvals, cancellations, new instructions mid-turn. Multiple `waitForEvent`s can be raced with `Promise.race`.
4. **Fan-out:** a parent Workflow can `create()` child instances from inside a `step.do` — the parent does not block; each child runs independently. Combined with `createBatch` (up to 100) this covers sub-agent fan-out. Fan-in is by child→parent `sendEvent` or DO-mediated status checks.
5. **Cross-script bindings:** a Workflow defined in another Worker script can be bound via `script_name` in the `[[workflows]]` config — lets the MCP front door, the DO, and the Workflow live in separately deployed Workers.

## Queues (task ingestion)

Source: [Queues](https://developers.cloudflare.com/queues/), [Limits](https://developers.cloudflare.com/queues/platform/limits/), [Pricing](https://developers.cloudflare.com/queues/platform/pricing/)

- At-least-once delivery, batching (max 100 messages or 256 KB per batch, 60 s max batch wait), per-message retries (max 100) with Dead Letter Queues, per-message delay up to 24 h, retention up to 14 days.
- Limits: 128 KB message size, 5,000 msg/s per queue, 250 concurrent consumer invocations (push), consumer wall time 15 min, CPU configurable to 5 min.
- Pricing (Paid): 1M operations included, then $0.40/million ops (1 write + 1 read + 1 delete ≈ 3 ops per delivered message). No egress charges.
- **Fit:** Queues matter for *decoupling task submission from worker activation* — e.g. the MCP front door enqueues "new task" messages, and a consumer Worker (or the queue handler directly) resolves the target DO and nudges it. Given that DOs already have alarms (a documented pattern is literally "build queues atop Durable Objects") and Workflows have their own durable queuing of instances, an actual Queue is only needed when you want buffering/backpressure across *many* workers, DLQ semantics, or HTTP pull consumers from outside Cloudflare. For v1, Queue-per-region ingestion is optional; a DO alarm loop or direct Workflow creation covers most cases.

## Fit for resident agent service

**(a) One DO per resident worker holding structured memory in SQLite — strong fit.**
10 GB per worker is generous for plans, decision logs, and a task graph. Synchronous SQL + FTS5 gives fast structured and full-text queries over memory without an external DB. Single-writer serialization via input/output gates eliminates concurrency bugs in memory updates. PITR (30 days) provides memory undo. Costs are row-based, so write amplification needs care (each updated index row counts as a write; every `setAlarm` is a write) — prefer batched appends over chatty updates. Watch the 128 MB memory ceiling: don't hydrate the whole task graph into memory; query it.

**(b) A Workflow instance per agent turn, owned by the DO — good fit, with one design decision.**
Durability (memoized steps, retries, resume-from-step via `restart({from})`), 5-minute CPU per step, unlimited wall time per step, `waitForEvent` for approvals, and 50,000 concurrent running instances all suit turn execution. The DO creating instances with deterministic IDs (`${workerId}-turn-${seq}`) gives idempotent turn submission. The missing piece is push notification: the Workflow's last step should RPC back into the owning DO to record the result (fan-in), or the DO polls via alarm. Alternative worth evaluating: **one long-lived Workflow per worker** (turns as `sendEvent`s, looping `waitForEvent` → do steps) — bounded by the 10k–25k step limit and 1 GB instance state, so per-turn instances with the DO as the durable memory is the safer default for long-lived workers.

**(c) Does one agent turn's step (model call + sandbox op) fit the limits? — yes, comfortably.**
A model call or sandbox operation is I/O-bound: wall time per step is unlimited and waiting on I/O doesn't consume CPU. The 30 s (up to 5 min) CPU budget per step is far above what request/response marshalling needs. Caveats: step results ≤ 1 MiB (persist large artifacts/logs in R2 and return references — the docs say exactly this); total persisted state per instance ≤ 1 GB; subrequests per instance default 10,000 (raiseable). On the Free plan the 10 ms CPU/step limit is unworkable — Paid plan required.

**(d) Cold-start latency for waking a hibernated worker — acceptable risk, must be measured.**
Hibernated DOs wake automatically on the next event (WS message, RPC, alarm) by re-running the constructor; SQLite storage is co-located with the object ("zero-latency storage" per Cloudflare's blog positioning). No official wake-latency number is published (UNVERIFIED). Expect: constructor + first query in the tens of ms range in the common case, with tail latency when the object was fully evicted from the host. Mitigations: keep constructors cheap, defer heavy state loading, and pre-warm via alarm before expected traffic. MCP clients should tolerate a slow first response after idle.

**Overall:** the planned architecture is well aligned with the platform's intended use — Cloudflare itself markets DOs for "AI agents" and Workflows for "reliable AI applications" with human-in-the-loop. The strongest open risks are DO wake latency (unpublished), Workflow step-billing economics at agent scale (billing is one day old), and the single-threaded 1,000 req/s ceiling per worker DO (fine for one task per worker; matters if a worker ever becomes a fan-in hub).

## Open questions

1. **DO wake latency (UNVERIFIED):** actual p50/p99 to wake a hibernated vs fully inactive SQLite-backed DO, including constructor + first SQL query. Needs a benchmark on the target regions. Cloudflare publishes no number.
2. **Hibernation + outbound sandbox connections:** Sandbox SDK / `connect()` sockets and outbound WebSockets block hibernation and bill up to 15 min of duration per idle connection. What is the Sandbox SDK container lifecycle, and can the worker DO hold a *hibernatable* channel to a container, or should sandbox calls be stateless per step?
3. **Workflow step/storage billing in practice (billing started 2026-08-10):** how many steps does a real agent turn consume (model call + sandbox op + memory writes could be 3–10 steps), and what does that cost at 500k included steps/month? Also: instance state retention (30 days default) accrues GB-month charges — tune per-instance `retention`.
4. **Result fan-in reliability:** if the Workflow's final "report to DO" step succeeds but the DO RPC inside it fails, retry semantics re-run the step — is DO result-recording idempotent? (Needs dedupe on turn ID in SQLite.)
5. **Cross-region model/sandbox placement:** DOs never move once created, and location hints are creation-time only. Which hint (or jurisdiction) minimizes latency to the model provider and Sandbox containers? UNVERIFIED whether Sandbox containers can be co-located with a chosen DO region.
6. **MCP transport:** MCP over Streamable HTTP vs WebSocket into the DO — hibernation only applies to the Hibernation WebSocket API; plain HTTP request/response to a DO keeps it active (billed) for the request duration. Which transport do target MCP clients require?
7. **Per-worker throughput ceiling:** ~1,000 req/s soft limit per DO and 6 outgoing connections per request — does any planned pattern (e.g. streaming many tool events per second into the worker) approach this?
8. **Workflow instance-per-turn state retention cost:** completed-instance state (up to 1 GB each) is retained 30 days on Paid by default and billed as storage; confirm expected instance volume × state size, and set short `successRetention`.

## Sources

All pages fetched 2026-08-11.

- [Durable Objects overview](https://developers.cloudflare.com/durable-objects/)
- [Durable Object Storage API (SQLite)](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Lifecycle of a Durable Object](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)
- [WebSockets & Hibernation API](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Alarms API](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Durable Object Namespace API (addressing)](https://developers.cloudflare.com/durable-objects/api/namespace/)
- [Data location (jurisdictions & location hints)](https://developers.cloudflare.com/durable-objects/platform/data-location/)
- [Durable Objects migrations / class lifecycle](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)
- [Workflows overview](https://developers.cloudflare.com/workflows/)
- [Workflows Workers API](https://developers.cloudflare.com/workflows/build/workers-api/)
- [Workflows sleeping and retrying](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/)
- [Trigger Workflows](https://developers.cloudflare.com/workflows/build/trigger-workflows/)
- [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/)
- [Workflows pricing](https://developers.cloudflare.com/workflows/reference/pricing/)
- [Changelog: Workflows step/storage billing starts 2026-08-10](https://developers.cloudflare.com/changelog/post/2026-07-07-workflows-billing-updates/)
- [Changelog: DO SQLite storage billing (Jan 2026)](https://developers.cloudflare.com/changelog/post/2025-12-12-durable-objects-sqlite-storage-billing/)
- [Blog: Workflows GA (2025-04-07)](https://blog.cloudflare.com/workflows-ga-production-ready-durable-execution/)
- [Queues overview](https://developers.cloudflare.com/queues/), [Queues limits](https://developers.cloudflare.com/queues/platform/limits/), [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/)
