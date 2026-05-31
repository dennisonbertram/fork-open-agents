# POC 6a — Self-Hosted Hetzner-VM-Backed Sandbox Provider

A **complete, working** proof-of-concept for a self-hosted sandbox provider that
implements the real open-agents `Sandbox` interface
(`packages/sandbox/interface.ts`), backed by a pluggable VM driver. Two drivers
are implemented:

- **`HcloudDriver`** — PRODUCTION driver. Real Hetzner Cloud REST API code
  (create server + cloud-init + poll-until-ready + SSH exec + snapshot image +
  delete-on-stop). Runnable when `HCLOUD_TOKEN` is present; here it is proven
  against a local mock of the hcloud API.
- **`LocalDockerDriver`** — EVAL stand-in. One Docker container per sandbox.
  Used to drive the **full** `Sandbox` interface end-to-end on this macOS host
  (which has only Docker — no KVM/Firecracker), with a real Caddy reverse-proxy
  container providing the wildcard public-URL routing.

Everything is self-contained in this directory (its own `package.json`,
`bun.lock`, `tsconfig`). It does **not** modify the root project or any
app/package source.

---

## Goal

Prove that a Hetzner-backed provider can satisfy the open-agents `Sandbox`
contract — shell exec, detached processes, port→public-URL exposure,
snapshot/resume, lifecycle/timeout — and define the concrete integration into
the real `factory.ts` / `lifecycle.ts` seams. Prove everything provable locally
with Docker; make the real Hetzner path real and correct (mock-tested), without
faking results.

---

## Architecture

`RESEARCH.md` (read it first) evaluates two Hetzner architectures:

- **Arch A — one Hetzner Cloud VM per sandbox** (hcloud REST API, SSH exec,
  disk-only snapshots in minutes). Simple, API-driven, immediately runnable with
  a token. **This POC's `HcloudDriver` implements Arch A.**
- **Arch B — Firecracker microVMs on a Hetzner *dedicated* box** (hardware-KVM
  isolation, vsock exec, **3–28 ms** memory-snapshot restore). RESEARCH.md's
  **recommended production scale-out** because it is the only self-hosted path
  with sub-second resume parity to Vercel and 40–300× cheaper at scale. It
  **requires a Linux/KVM host** (Hetzner Cloud VMs do not expose nested KVM),
  so it cannot run on this macOS/Docker host — it is described, not faked.

```
            ┌─────────────────────────────────────────────┐
 agent ───▶ │  HetznerSandbox  (implements real Sandbox)   │
            │   exec / execDetached / fs / domain /        │
            │   snapshot / restore / stop / getState       │
            └───────────────┬──────────────┬──────────────┘
                            │              │
                    VmDriver│              │ProxyRegistrar
                            ▼              ▼
        ┌───────────────────────────┐   ┌──────────────────────┐
        │ LocalDockerDriver (eval)  │   │ CaddyRegistrar        │
        │ HcloudDriver  (prod, A)   │   │  → Caddy container    │
        │ [FirecrackerDriver = B,   │   │  *.lvh.me wildcard    │
        │  recommended, not built]  │   │  reverse proxy        │
        └───────────────────────────┘   └──────────────────────┘
```

### Why Docker is the eval stand-in (and what it is *not*)

A Docker container is the closest local isolation boundary to a VM available on
a macOS dev host without KVM: separate PID/mount/network namespaces, its own
filesystem and loopback. Every `VmDriver` primitive maps cleanly onto Docker, so
the **sandbox logic** (exec shaping, truncation, timeout semantics, port
exposure, snapshot/restore lifecycle, `getState` shape) is proven end-to-end.

Docker is **not** a true microVM — it shares the host kernel. Genuine
adversarial-code isolation and sub-second *memory* snapshots require Firecracker
on a Linux/KVM host (Arch B). The README is explicit about this throughout; the
eval characterizes Docker timings and cites Firecracker production targets from
RESEARCH.md.

---

## What was built

| File | Purpose |
|---|---|
| `src/interface.ts` | Byte copy of the real `packages/sandbox/interface.ts` (self-contained build). |
| `src/driver.ts` | `VmDriver` interface: create/exec/execDetached/putFile/getFile/exposePort/snapshot/restore/destroy/status. |
| `src/sandbox.ts` | **`HetznerSandbox`** — implements the real `Sandbox` interface on top of any `VmDriver` + `ProxyRegistrar`. Mirrors Vercel behaviors. |
| `src/connect.ts` | `connectHetzner()` provider entrypoint (mirror of `connectVercel`). |
| `src/conformance.ts` | **Compile-time conformance proof** against the REAL interface. |
| `src/drivers/local-docker-driver.ts` | `LocalDockerDriver` (eval stand-in). |
| `src/drivers/hcloud-driver.ts` | `HcloudDriver` (production Arch A) + `buildCloudInit()`. |
| `src/drivers/hcloud-client.ts` | Typed hcloud REST API client (create/get/delete/create_image/actions). |
| `src/proxy/registrar.ts` | `CaddyRegistrar` (Caddy admin API) + `NoopRegistrar`. |
| `src/proxy/caddy-container.ts` | Boots Caddy as a Docker container, programs `srv0` via admin API. |
| `integration/factory.patch.ts` | Type-checked `{type:"hetzner"} & HetznerState` union add + `connectSandbox` branch, imports REAL factory types. |
| `integration/lifecycle.patch.ts` | Type-checked generalization of the `lifecycle.ts:187` `type !== "vercel"` guard. |
| `integration/hetzner-state.ts` | Proposed `HetznerState` (carries `sandboxName` + `expiresAt`). |
| `test/eval.test.ts` | Full-interface Docker+Caddy eval, assertions (a)–(e). |
| `test/hcloud-driver.test.ts` | Mock-hcloud-API test (create payload, poll loop, snapshot, delete, cloud-init). |
| `scripts/run-eval.ts` | Timing harness → `evidence/measurements.json`. |
| `scripts/curl-proof.ts` | Raw `curl` wildcard-URL proof → `evidence/caddy-wildcard-curl-proof.txt`. |
| `scripts/cleanup.sh` | Remove all POC Docker resources. |

### Conformance approach (BOTH methods used)

1. `src/interface.ts` is a **byte copy** of `packages/sandbox/interface.ts`, so
   the POC builds without a cross-package import in its hot path.
   `HetznerSandbox implements Sandbox` against that copy.
2. `src/conformance.ts` additionally **imports the REAL interface** directly
   (`../../../packages/sandbox/interface.ts`) and asserts:
   - the copy is bidirectionally assignable to the real types (structural
     identity — guards against drift), and
   - `const _conformsReal: RealSandbox = hetznerSandboxInstance` plus a
     `satisfies` check.

   Run `bun run typecheck:conformance` — it compiles the real interface against
   `HetznerSandbox`. **Exit 0 == conformance proven at compile time.**

### Behavioral parity with `packages/sandbox/vercel/sandbox.ts`

- `exec` runs `bash -c 'cd "<cwd>" && <command>'`, truncates stdout/stderr at
  **50_000** chars, returns `ExecResult`.
- A timed-out command returns `{ success:false, exitCode:null, stderr:"…timed
  out…", truncated:false }` (no throw) — matches Vercel.
- `execDetached` returns `{ commandId }` after a **~2 s** quick-failure probe.
- `domain(port)` returns a per-port subdomain URL.
- `snapshot()` marks the sandbox stopped, clears `expiresAt`, removes proxy
  routes, returns `{ snapshotId }`.
- Client-side `timeout`/`expiresAt` with an `onTimeout` hook and `extendTimeout`.
- `getState()` returns `{ type:"hetzner", sandboxName, expiresAt, … }` — the
  shape `canOperateOnSandbox` / `getPersistentSandboxName`
  (`apps/web/lib/sandbox/utils.ts`) require.
- Lifecycle state machine: `active → hibernating → hibernated → restoring →
  active`.

---

## How it was tested + evidence

Run it yourself (requires Docker running):

```bash
cd POC/6a-hetzner-sandbox
bun install
bun run typecheck                 # full POC typecheck (exit 0)
bun run typecheck:conformance     # conformance vs REAL interface (exit 0)
bun run test:hcloud               # mock-hcloud-API test (5 pass)
bun run test:eval                 # full Docker+Caddy eval (6 pass)
bun run eval                      # timing harness -> evidence/measurements.json
bun run scripts/curl-proof.ts     # raw curl wildcard proof
bash scripts/cleanup.sh           # remove POC Docker resources
```

**All evidence is in `evidence/`:**

- `typecheck.log` — both typechecks pass (incl. conformance against the real
  interface).
- `hcloud-mock-test.log` / `hcloud-junit.xml` — 5/5 mock-API tests.
- `eval-test.log` / `eval-junit.xml` — 6/6 interface eval tests.
- `full-test-suite.log` — combined 11/11.
- `measurements.json` / `measure-run.log` — measured timings + proofs.
- `caddy-wildcard-curl-proof.txt` — raw `curl` showing `Via: 1.0 Caddy`.

### Eval assertions (a)–(e) — REAL outcomes

**(a) core exec + filesystem** — `echo`→`hello-sandbox` exit 0; `uname -s`→
`Linux`; `pwd` in `/workspace/sub` respects cwd; write→read byte-identical;
`stat`/`access`/`mkdir`/`readdir` correct.

**(b) port exposure → public URL (the novel piece)** — `execDetached` a Python
HTTP server on :3000, `exposePort(3000)` returns
`http://eval-b-3000.lvh.me:8088`, and a real HTTP GET through that wildcard URL
returns the sandbox's content. The raw-curl proof shows the response carries
`Via: 1.0 Caddy` and `Server: SimpleHTTP/0.6 Python/3.12.13` — i.e. the request
traversed the Caddy container into the right sandbox container.

**(c) isolation** — two sandboxes; B cannot read A's `secret.txt` (separate FS,
read throws), B's loopback :3000 is `CLOSED` (separate netns), B sees `0`
`http.server` processes (separate PID ns), and A/B get distinct `domain()` URLs.

**(d) snapshot/resume** — write+`sha256` a file, `snapshot()` (→ `hibernated`,
live container destroyed), `restore()` (→ `active`); restored bytes hash-match
the original. `getState()` transitions verified; the hibernated sandbox's Caddy
route is removed.

**(e) parity** — 60 000-char stdout truncates to exactly **50 000** with
`truncated:true`; a `sleep 10` under a 1 s timeout returns `success:false`,
`exitCode:null`.

### Mock-hcloud-API test result

Asserts the exact `POST /servers` payload (`server_type:cax11`,
`image:ubuntu-24.04`, `location:fsn1`, `ssh_keys:["my-key"]`,
`start_after_create:true`, `labels.sandbox-id`), the **cloud-init** contents
(injected SSH key + `/run/sandbox-ready` marker + workdir), the
**poll-until-running** loop (≥2 `GET /servers/:id` as status flips
`initializing→running`), `create_image` (snapshot) + action poll, and
`DELETE /servers/4242` on stop. **5/5 pass.**

### Measured timings (Docker eval stand-in)

| Operation | Docker (measured) | Firecracker production target (RESEARCH.md) |
|---|---|---|
| container/VM create | ~360 ms | ≤125 ms boot (Arch B) |
| create → exec-ready | ~440 ms | ≤125 ms + agent init |
| snapshot() | ~0.8–1.3 s (`docker commit`) | 3–28 ms full mem+disk snapshot |
| restore() | ~450 ms (`docker run` from image) | 3–28 ms (mmap COW resume) |

These are **Docker numbers** characterizing the eval mechanism. Production
targets are Firecracker's (Arch B) per RESEARCH.md §1B/§4. Arch A hcloud numbers
(not runnable here): 15–30 s SSH-ready provisioning, minutes for disk snapshots.

---

## Integration plan into the real codebase

The provider plugs into the existing seams with small, type-checked edits
(demonstrated in `integration/`, compiled against the real types):

1. **`packages/sandbox/factory.ts`** — generalize the union and dispatch:
   ```ts
   export type SandboxState =
     | ({ type: "vercel" } & VercelState)
     | ({ type: "hetzner" } & HetznerState);   // NEW

   // in connectSandbox():
   if (state.type === "hetzner") return connectHetzner(state, options);
   return connectVercel(state, options);
   ```
2. **`connectHetzner()`** — new provider entrypoint (this POC's `src/connect.ts`
   is the working shape); selects a driver from env (`HCLOUD_TOKEN` →
   `HcloudDriver`, else local), provisions/restores, runs `afterStart`.
3. **`apps/web/lib/sandbox/lifecycle.ts:187`** — widen the
   `type !== "vercel"` guard to an allow-list
   (`isLifecycleSupported(type)` in `integration/lifecycle.patch.ts`). No other
   lifecycle change needed because `getState()` already returns
   `sandboxName` + `expiresAt`, which `canOperateOnSandbox`
   (`apps/web/lib/sandbox/utils.ts`) consumes.
4. **`DEFAULT_SANDBOX_PORTS`** (`apps/web/lib/sandbox/config.ts` =
   `[3000, 5173, 4321, 8000]`) — register these with the proxy on `afterStart`
   so `domain(port)` URLs are live for the standard dev-server ports.
5. **Caddy wildcard DNS + TLS** — production replaces `lvh.me:8088` with
   `*.sandbox.<yourdomain>` (A/AAAA → proxy IP) and Caddy DNS-01 wildcard TLS
   (one cert covers all sandboxes; no per-sandbox issuance). In Arch B the proxy
   and the Firecracker host can be the same machine, dialing
   `127.0.0.1:<forwarded-port>` (iptables/nftables DNAT from the VM's TAP).

---

## Cost comparison vs Vercel (from RESEARCH.md §6)

| Approach | Per session-hour (4 vCPU, 50% CPU) | Fixed | Cold-start | Snapshot |
|---|---|---|---|---|
| Vercel Sandbox Pro | ~$0.43 | none | ~1 s | sub-second (mem+disk) |
| Hetzner CX33 per-VM (Arch A) | ~$0.011 (**~40×** cheaper) | none | 15–30 s | minutes (disk only) |
| Hetzner AX102 Firecracker (Arch B, 50% util) | ~$0.0014 (**~300×** cheaper) | $120/mo | 28 ms | 3–28 ms (mem+disk) |
| Hetzner AX102 Firecracker (10% util) | ~$0.007 (**~60×** cheaper) | $120/mo | 28 ms | 3–28 ms |

Arch B wins on cost above ~3–4 concurrent sessions per dedicated host, and is
the only self-hosted path with Vercel-parity resume latency.

---

## Feasibility verdict

**Feasible.** The `Sandbox` interface maps cleanly onto a `VmDriver`
abstraction; the genuinely novel pieces vs Vercel — wildcard port→URL exposure
and snapshot/restore — are both proven working here (real Caddy routing + a
hash-verified snapshot round-trip). The production hcloud control-plane calls
are implemented and verified against a faithful API mock. The recommended
production substrate (Firecracker on a Hetzner dedicated box) is the documented
scale-out; it needs a Linux/KVM host to run, which is the one thing this
environment cannot provide.

---

## Blind spots ELIMINATED

- **Interface mapping** — `HetznerSandbox` satisfies the REAL `Sandbox`
  interface at compile time (`typecheck:conformance`, exit 0) and all 26
  interface assertions pass in the eval.
- **Wildcard port-exposure** — a real HTTP request to
  `http://<id>-<port>.lvh.me:8088/` is served by the correct sandbox via the
  Caddy container (raw-curl evidence, `Via: 1.0 Caddy`). Routes are added on
  `exposePort` and removed on `stop`/`snapshot`.
- **Snapshot/restore mechanism** — `snapshot()→destroy→restore()` preserves
  filesystem bytes (sha256 match) and drives the lifecycle state machine.
- **Factory/lifecycle integration** — the union add, `connectHetzner` branch,
  and `lifecycle.ts:187` guard generalization are written against the real types
  and type-check clean.
- **hcloud API correctness** — exact create payload, cloud-init, poll loop,
  snapshot image, and delete-on-stop verified against a mock API.

## Blind spots REMAINING

- **Firecracker true-microVM isolation + sub-second memory snapshot** — needs a
  Linux/KVM host or a real Hetzner *dedicated* box; cannot run on macOS/Docker.
  Docker shares the host kernel (weaker isolation than a microVM).
- **Live hcloud provisioning time** — the real 15–30 s SSH-ready (and
  minutes-long disk snapshots) are unmeasured without a token; only the API
  choreography is proven.
- **vsock guest agent (Arch B)** — the kernel-to-kernel exec channel, agent
  re-listen on snapshot restore, and CID-collision handling are unbuilt.
- **iptables/nftables DNAT at scale** — per-VM, per-port forwarding rules for
  200+ VMs (Arch B) are untested.
- **Egress filtering** — per-VM network policy (Vercel-equivalent) is not
  implemented.

---

## Remaining risks

- Hetzner dedicated-server delivery is **1–3 business days** and billed monthly
  (not hourly) — plan procurement before an Arch B build.
- Hetzner charges for **stopped** Cloud servers; the lifecycle must **DELETE**
  to end billing (the `HcloudDriver.destroy` does this).
- hcloud API rate limit is **3600 req/hr**; high create rates need a token
  bucket / multiple tokens.
- Snapshot-restore replay (PRNG/UUID reuse) needs VMGenID + app-level UUID
  regeneration (Arch B).

---

## What a live run needs

- **Arch A (hcloud), runnable today:** set `HCLOUD_TOKEN`, plus
  `SANDBOX_SSH_PUBLIC_KEY` and `SANDBOX_SSH_PRIVATE_KEY_PATH` (or a project SSH
  key id via `sshKeys`). Then `HcloudDriver.fromEnv()` provisions a real CX/CAX
  server, bootstraps via cloud-init, and execs over SSH. A public host + Caddy
  with wildcard DNS/TLS makes `domain(port)` URLs live.
- **Arch B (Firecracker), the production recommendation:** a Linux **KVM** host
  — a Hetzner dedicated box (e.g. AX41/AX102) or any Linux/KVM machine — to run
  Firecracker + jailer, a guest kernel/rootfs, a vsock guest agent, and TAP/DNAT
  networking, with Caddy collocated on the host.
