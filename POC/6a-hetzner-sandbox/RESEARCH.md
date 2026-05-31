# Hetzner Self-Hosted Sandbox Provider — Research Report

**Purpose:** Design a self-hosted sandbox provider backed by isolated VMs on Hetzner as an
alternative to Vercel Sandbox for the open-agents platform. The provider must back a per-session
isolated execution environment that can run shell commands, run detached/long-lived processes,
expose an internal port to a public URL, snapshot/resume, and be torn down.

**Date:** 2026-05-31  
**Researcher:** External research agent

---

## Table of Contents

1. [Capability Map: Hetzner Offerings & Isolation Models](#1-capability-map)
2. [Mental Model: How to Think About the Problem](#2-mental-model)
3. [Networking / Port Exposure](#3-networking--port-exposure)
4. [Snapshot / Hibernate](#4-snapshot--hibernate)
5. [Command Execution Channel](#5-command-execution-channel)
6. [Cost Model](#6-cost-model)
7. [Provider Design: `HetznerSandbox`](#7-provider-design)
8. [Failure Modes & Gotchas](#8-failure-modes--gotchas)
9. [Expectation Gaps](#9-expectation-gaps)
10. [Recommendation Summary](#10-recommendation-summary)
11. [Top Blind Spots for the Build POC](#11-top-blind-spots-for-the-build-poc)
12. [Sources](#12-sources)

---

## 1. Capability Map

### 1A. Architecture A: Hetzner Cloud — One Cloud Server Per Sandbox

**What it is:** Provision a fresh Hetzner Cloud VM via the `hcloud` REST API for each sandbox session.
Each VM is the sandbox. Agent talks to it over SSH.

#### Server Types (as of May 2026, EU region, excl. VAT)

| Family | Type   | vCPU | RAM   | Disk   | Monthly  | Hourly     | Architecture |
|--------|--------|------|-------|--------|----------|------------|--------------|
| CX     | CX23   | 2    | 4 GB  | 40 GB  | €3.99    | €0.0064    | x86 shared   |
| CX     | CX33   | 4    | 8 GB  | 80 GB  | €6.49    | €0.0104    | x86 shared   |
| CX     | CX43   | 8    | 16 GB | 160 GB | €11.99   | €0.0192    | x86 shared   |
| CAX    | CAX11  | 2    | 4 GB  | 40 GB  | €4.49    | €0.0072    | ARM64 shared |
| CAX    | CAX21  | 4    | 8 GB  | 80 GB  | €7.99    | €0.0128    | ARM64 shared |
| CPX    | CPX22  | 2    | 4 GB  | 80 GB  | €7.99    | €0.0128    | x86 AMD EPYC |
| CPX    | CPX32  | 4    | 8 GB  | 160 GB | €13.99   | €0.0224    | x86 AMD EPYC |
| CCX    | CCX13  | 2    | 8 GB  | 80 GB  | €15.99   | €0.0256    | dedicated vCPU |
| CCX    | CCX23  | 4    | 16 GB | 160 GB | €31.49   | €0.0505    | dedicated vCPU |
| CCX    | CCX33  | 8    | 32 GB | 240 GB | €62.49   | €0.1001    | dedicated vCPU |

**Notes:**
- CX and CAX are EU-only (not available in US/Singapore regions).
- Pricing increased ~30–37% from April 1, 2026.
- All instances include 20–60 TB traffic, IPv4/IPv6, DDoS protection, firewalls.
- Source: [costgoat.com/pricing/hetzner](https://costgoat.com/pricing/hetzner)

**Provisioning time:** SSH-ready in **15–30 seconds** from a standard OS image with an established
account. Confirmed by community reports and automation tools. Custom snapshot restores take longer
(5–15 min) because snapshots are not cached locally on hypervisor nodes the way base images are.
Source: [LowEndTalk discussion](https://lowendtalk.com/discussion/184625/)

**Cloud-init / user data:** `user_data` field (up to 32 KiB) in `POST /v1/servers`. Accepts
cloud-config YAML. Runs on first boot to install agent, set SSH keys, etc.
Source: [Hetzner Cloud API docs](https://docs.hetzner.cloud/reference/cloud)

**Snapshots (cloud server):** Manually or API-triggered full-disk snapshots. Creation is
asynchronous and takes minutes (disk-size dependent). Restoring creates a new server from the
snapshot — does NOT restore a running VM's RAM. Storage billed separately.
Source: [Hetzner Cloud snapshot docs](https://docs.hetzner.com/cloud/servers/getting-started/taking-snapshots/)

**API Rate Limits:** 3600 requests per hour per project/token (~1 req/sec sustained, burst allowed).
`429 Too Many Requests` on breach. Headers: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`.
Source: [Hetzner Cloud API reference](https://docs.hetzner.cloud/reference/hetzner)

**Nested KVM:** **NOT supported** on Hetzner Cloud VMs. Cloud VMs cannot run KVM inside them.
Attempts to run Firecracker or QEMU inside a Hetzner Cloud VM will fail without the experimental
PVM approach (see Expectation Gaps). Source: community reports, Proxmox/Hetzner documentation.

**Security isolation strength:** Hetzner hypervisor-level isolation. Strong for CPU/memory boundary,
but you share the host kernel at the hypervisor level. For running untrusted agent code, the guest
OS is the boundary — one VM per sandbox provides adequate isolation for most threat models.

**Cold-start:** 15–30 s from base image.

**Density/cost:** One VM per sandbox. At CX23 (€0.0064/hr), you pay per sandbox-hour.

**Snapshot support:** Disk-only, minutes, not memory-consistent.

**Operational complexity:** Low. Pure API calls; no custom host setup.

---

### 1B. Architecture B: One Hetzner Dedicated Server Running Many Firecracker MicroVMs

**What it is:** A single Hetzner dedicated (bare-metal) server runs many Firecracker microVMs, each
acting as an isolated sandbox. The control plane (orchestrator) manages the full lifecycle via the
Firecracker HTTP API (over a Unix socket per VM).

#### The Host: Hetzner Dedicated Servers (AX/EX series)

Bare-metal servers billed **monthly** (not hourly). Full hardware virtualization (Intel VT / AMD-V)
available — confirmed hardware-level KVM works on Hetzner dedicated servers.
Source: community docs on [running KVM on Hetzner](https://blog.adamretter.org.uk/bridged-kvm-virtualisation-at-hetzer/)

Key model: **AX102** — AMD Ryzen 9 7950X3D, 16 cores / 32 threads @ 4.2 GHz, 128 GB RAM,
2 × 1.92 TB NVMe SSD. Price: **~€109/month** + €39 one-off setup fee (2025 pricing; post-April-2026
adjustment may add ~30%).
Source: [Hetzner AX102 product page](https://www.hetzner.com/dedicated-rootserver/ax102/)

Smaller options: AX41 (8 cores, 64 GB, ~€49/mo), AX51 (8 cores, 64 GB NVMe, ~€69/mo).

#### Firecracker MicroVM Specifics

**Firecracker version:** Latest is in active development; production builds available at
[github.com/firecracker-microvm/firecracker](https://github.com/firecracker-microvm/firecracker).

**Boot time spec:** `<= 125 ms` from `InstanceStart` API call to guest user-space init, measured
with minimal kernel/rootfs (serial console disabled). Official spec enforced by integration tests.
Source: [Firecracker SPECIFICATION.md](https://github.com/firecracker-microvm/firecracker/blob/main/SPECIFICATION.md)

**Snapshot restore time:** `3–8 ms p50` in production (AWS Lambda SnapStart, Fly.io). A developer
building AI sandboxes achieved **28 ms** restore using COW memory mapping. Full cold boot with
real workload: ~1 second.
Source: [DEV.to: How I built sandboxes that boot in 28ms](https://dev.to/adwitiya/how-i-built-sandboxes-that-boot-in-28ms-using-firecracker-snapshots-i0k)

**Memory overhead:** `< 5 MiB per VMM process` (excluding guest RAM allocation).
Source: [Firecracker SPECIFICATION.md](https://github.com/firecracker-microvm/firecracker/blob/main/SPECIFICATION.md)

**Creation rate:** Up to `150 microVMs/second per host`.
Source: [Firecracker homepage](https://firecracker-microvm.github.io/)

**Density on AX102 (128 GB, 16 cores):**
- At 512 MB RAM per sandbox VM: ~240 concurrent VMs
- At 256 MB RAM per sandbox VM: ~480 concurrent VMs
- At 128 MB RAM per sandbox VM: ~960 concurrent VMs (dominated by guest alloc, not VMM overhead)

**Devices emulated (minimal attack surface):**
1. virtio-block (disk)
2. virtio-net (via TAP device on host)
3. virtio-vsock (host-guest communication without TCP/IP)
4. Serial console (disabled in production for security)
5. Single-button keyboard controller (shutdown signal)

Source: [Firecracker design.md](https://github.com/firecracker-microvm/firecracker/blob/main/docs/design.md)

**Jailer isolation:**
The `jailer` companion process provides defense-in-depth by establishing cgroups, namespaces
(network, PID, mount, etc.), seccomp filters, and chroot — then drops privileges before execing
into Firecracker. Even if the KVM boundary is breached, the jailer provides a second containment
layer. **Required for production multi-tenant use.**
Source: [Firecracker design.md](https://github.com/firecracker-microvm/firecracker/blob/main/docs/design.md)

**Networking per VM:**
Each microVM gets a TAP device on the host (`tap0`, `tap1`, etc.) backed by a bridge or masquerade NAT.
Firecracker does **NOT** do any network traffic filtering itself — filtering must happen at host level
(iptables/nftables). Source: [Firecracker design.md](https://github.com/firecracker-microvm/firecracker/blob/main/docs/design.md)

**Snapshot mechanism (memory + disk):**
Full or diff snapshots via `PUT /snapshot/create`. Memory is persisted to a file; on restore,
Firecracker uses `MAP_PRIVATE` (lazy-load COW) rather than reading full memory at restore time.
The memory file must remain available for the VM's lifetime. Both CPU state and device state are
captured. Diff snapshots save only dirty pages (developer preview).
Source: [Firecracker snapshot-support.md](https://github.com/firecracker-microvm/firecracker/blob/main/docs/snapshotting/snapshot-support.md)

**Security isolation strength:** Hardware-level KVM boundary + jailer. Strong enough for running
genuinely adversarial/untrusted code. Each VM has its own Linux kernel instance.
Source: [Northflank Firecracker vs gVisor](https://northflank.com/blog/firecracker-vs-gvisor)

**Cold-start:** ~125 ms (minimal kernel) to ~1 s (full workload kernel). With snapshot restore: 3–28 ms.

**Operational complexity:** High. Requires:
- Dedicated host procurement and OS setup
- Firecracker binary deployment + jailer configuration
- Custom kernel images and rootfs images (ext4)
- TAP device management, iptables rules
- A control-plane orchestrator process
- Snapshot storage management

---

### 1C. Brief Contrast: Containers + gVisor or Kata Containers

**gVisor:** Intercepts syscalls in user-space kernel (not KVM). Reduces attack surface vs. plain
containers but provides NO hardware-level isolation. Adequate for medium-threat multi-tenant SaaS
where you control the code; insufficient for genuinely adversarial untrusted AI-generated code.
Compatible with Hetzner Cloud VMs (no KVM needed). Cold-start: same as containers (sub-second).
Source: [Northflank gVisor vs Firecracker](https://northflank.com/blog/firecracker-vs-gvisor)

**Kata Containers:** An orchestration layer that uses VMM backends (Firecracker, Cloud Hypervisor,
or QEMU). Provides hardware-level isolation like Firecracker. Adds Kubernetes/OCI integration.
Requires KVM — same constraint as Firecracker directly. Adds overhead and complexity on top
of Firecracker without meaningful gains for a custom control plane.

**Decision for this design:** For running UNTRUSTED AI agent code (the open-agents threat model),
gVisor is insufficient. Kata adds complexity without adding isolation. Firecracker directly (Arch B)
or one-VM-per-sandbox (Arch A) are the two viable paths.

---

## 2. Mental Model

### The Core Tradeoff

**Architecture A (one Cloud VM per sandbox)** is a "provision and run" model. Each sandbox is a
full Hetzner cloud server. The control plane is thin: create, configure, wait for ready, hand off.
Isolation comes from Hetzner's hypervisor. The unit of cost is per-server-hour, billing starts at
creation and stops only at deletion (not at stop/power-off — Hetzner charges for stopped servers).

The hard constraint: snapshot = disk only, takes minutes. There is no memory hibernation.
A "paused" session must be rebuilt from disk state. This makes session resume expensive in latency.

**Architecture B (dedicated server + Firecracker)** is a "dense microVM pool" model. The host
is fixed cost (monthly). Each sandbox is a sub-second microVM. The control plane is rich: it must
manage VM lifecycle, TAP devices, IP assignments, vsock paths, snapshot files, port forwarding.

The key insight: **snapshot restore in Firecracker is cheap (3–28 ms) but requires the host's
local storage**. Memory snapshots live on the dedicated server's NVMe. Migrating a running VM
between hosts is not supported (no live migration). A session is sticky to its host.

### How to Think About Sessions

A "session" in open-agents maps to a sandbox lifecycle:
1. `create/connect` → provision isolated execution environment
2. `exec` / `execDetached` → run commands, stream output
3. `domain(port)` → expose an internal port to a public URL
4. `snapshot` → hibernate/checkpoint
5. `stop` → tear down

For **Arch A**, steps 1 and 4 are the expensive operations (15–30 s provisioning, minutes for snapshot).
For **Arch B**, steps 1 and 4 can be fast (28 ms resume from snapshot), but step 3 requires a
reverse-proxy layer, and the overall system needs a live orchestrator process on the dedicated host.

### The Vercel Sandbox Comparison Frame

Vercel Sandbox (`@vercel/sandbox` SDK) provides:
- `Sandbox.create()` → likely a microVM or lightweight container in their infrastructure
- `exec()` / `execDetached()` → HTTP API to the VM
- `domain(port)` → returns a `*.vercel.run` URL via their proxy infrastructure
- `snapshot()` → native sub-second snapshot (their infra; disk + likely memory)
- `sandbox.stop()` → teardown

A self-hosted provider must replicate this exact interface with Hetzner as the compute substrate.
The `Sandbox` TypeScript interface in `packages/sandbox/interface.ts` is the contract to implement.

---

## 3. Networking / Port Exposure

### The Problem

When a sandbox starts a dev server on port 3000 inside the VM, `domain(3000)` must return a stable
public HTTPS URL that proxies to that port. Today this returns `*.vercel.run`-style URLs. We need
a `*.sandbox.<yourdomain>` equivalent.

### Option Analysis

**Option 1: Per-VM floating IP + direct port exposure**
Each VM gets its own public IP. `domain(3000)` returns `http://<vm-ip>:3000`. No shared proxy.
Problems: no TLS by default, IPv4 costs €0.50–€3/month per sandbox, IPs not reusable across
short-lived sandboxes without delay (IP assignment takes a few seconds via API).

**Option 2: Per-VM Primary IP + Caddy/Traefik reverse proxy**
A single proxy server (Caddy or Traefik) on a dedicated IP handles all incoming traffic.
Wildcard DNS `*.sandbox.yourdomain.com → proxy_ip`.
Proxy routes by subdomain: `<sandbox-id>-<port>.sandbox.yourdomain.com → VM_IP:PORT`.
VMs use Hetzner private networks (free) to communicate with the proxy — no public IP required per VM.

**Option 3: Hetzner Load Balancer**
LB11 costs ~€4.90/month. Routes TCP/HTTP traffic to backend pool. Does not support dynamic per-path
routing needed for per-sandbox per-port subdomains easily. Better suited to a fixed set of backends.
Not the right fit for ephemeral per-sandbox routing.

### Recommendation: Caddy + Wildcard DNS on Private Network

**Architecture:**
```
Internet → <wildcard DNS *.sandbox.yourdomain.com → proxy_public_ip>
         → Caddy proxy server (1 VM with public IP)
         → Hetzner private network
         → Sandbox VMs (no public IP, private network only)
```

**Subdomain scheme:** `<sandbox-id>-<port>.sandbox.yourdomain.com`
Example: `abc123-3000.sandbox.example.com` routes to VM abc123's port 3000.

**Caddy wildcard TLS:**
Caddy with a DNS-01 challenge (requires a supported DNS provider plugin, e.g. Cloudflare) issues
a wildcard cert `*.sandbox.yourdomain.com` automatically. No per-sandbox cert issuance needed.

```caddyfile
*.sandbox.example.com {
  tls {
    dns cloudflare {env.CLOUDFLARE_API_TOKEN}
  }
  @match header_regexp subdomain Host `^([a-z0-9-]+)-(\d+)\.sandbox\.example\.com$`
  handle @match {
    reverse_proxy {
      # Control plane must register sandbox IP:port dynamically
      dynamic <backend-from-control-plane>
    }
  }
}
```

For **dynamic routing**, Caddy supports the admin API (`POST /config/...`) to add/remove routes
at runtime without restart. Alternatively, use Caddy's `forward_auth` or a custom plugin that
queries the control plane for the target.

A simpler approach for the POC: Traefik with a file provider that the control plane updates.
Traefik supports hot-reload of the file provider. Each sandbox creation writes a new route entry;
deletion removes it. No restart needed.

**For Arch B (Firecracker on dedicated):**
The proxy and the microVM host can be the same physical machine. The proxy routes to
`127.0.0.1:<host_port>` where the host port is the forwarded port from the microVM's TAP subnet.
The host uses iptables to forward `tap0:3000` → host port `20000 + vmIndex`.

**TLS:** Caddy auto-HTTPS with wildcard certificate via DNS-01 challenge. Zero certificate management overhead.
Let's Encrypt rate limit (50 certs/domain/week) is not a problem with a single wildcard cert.
Source: [Caddy automatic HTTPS docs](https://caddyserver.com/docs/automatic-https)

**Cost of proxy server:** CX23 (€3.99/month) or even CAX11 (€4.49/month) is sufficient for a proxy.
Can collocate on the Firecracker host for Arch B (saves a VM cost).

---

## 4. Snapshot / Hibernate

### Vercel Sandbox Snapshot (current behavior)

Vercel Sandbox `snapshot()` captures the complete filesystem state (and likely memory state given
the sub-second restore times). The `VERCEL_SANDBOX_BASE_SNAPSHOT_ID` env var references a snapshot.
`sandbox.stop()` with a persistent config triggers an auto-snapshot before teardown.
Source: [Vercel Sandbox docs](https://vercel.com/docs/sandbox/concepts/snapshots)

The Vercel model achieves sub-second restore. Snapshots expire 30 days after last use by default.

### Architecture A: Hetzner Cloud Server Snapshot

- **What's saved:** Full disk image only. No memory (guest RAM is lost on stop/shutdown).
- **Creation time:** Minutes. Exact time varies by disk size. Community reports show 5–15 minutes.
  For a 40 GB CX23 with typical data, expect 2–10 minutes.
- **Restore:** Creates a new server from the snapshot. Add 15–30 s provisioning time.
- **Total hibernate-to-resume latency:** Easily 5–15 minutes. This is not suitable for session
  resume in a chat interface. Acceptable only for long-running background tasks where the agent
  starts fresh from a known disk state.
- **Cost:** Snapshots billed by GB. You control retention; API allows deletion.
- **Verdict:** Arch A snapshot is a checkpoint/restore tool for long-running tasks, NOT a
  hibernate/resume mechanism. It is fundamentally incompatible with the Vercel Sandbox pattern
  of fast session resume.

### Architecture B: Firecracker Snapshot + Restore

- **What's saved:** Guest memory file + microVM state file (vCPU registers, KVM state, device state).
  Disk files (virtio-block backing files) are user-managed and NOT automatically saved.
- **Memory persistence:** The snapshot memory file contains a MAP_PRIVATE COW copy of guest RAM.
  The original memory file must stay available for the VM's lifetime.
- **Creation process:**
  1. `PATCH /vm {"state": "Paused"}`
  2. `PUT /snapshot/create {"snapshot_type": "Full", "snapshot_path": "...", "mem_file_path": "..."}`
  3. `PATCH /vm {"state": "Resumed"}` (optional — or terminate and restore later)
- **Restore:** Load snapshot before any config: `PUT /snapshot/load`. New Firecracker process
  memory-maps the snapshot file. Guest resumes from exact point; vsock connection must reconnect.
- **Restore latency:** **3–28 ms** for memory-mapped resume (lazy COW paging). The 28 ms figure
  from a real AI sandbox builder includes: 5 ms process start, 8 ms mmap memory, 10 ms CPU/device
  restore, 5 ms vsock reconnect.
- **Copy-on-write efficiency:** Base snapshots are read-only. Multiple VMs cloned from one snapshot
  share unwritten pages. This enables a "pre-warmed pool" of identical sandboxes.
- **Disk files:** The rootfs (ext4 or other) backing file must be snapshotted separately (copy the
  file). For diff snapshots, only modified pages are stored — but diff snapshots are in developer
  preview.
- **Caveats:**
  - Resuming the same memory state multiple times is insecure (random number reuse). VMGenID
    device (Linux 5.18+) helps reseed PRNG on resume.
  - Vsock connections are reset on restore. The guest agent must re-register on its vsock port.
  - Wall-clock time skips forward; guest should update clock on resume.
  - Network: guest must reconfigure IP if the TAP device changed (use `network_overrides` in restore).
- **Verdict:** Arch B with Firecracker snapshot/restore achieves the same capability as Vercel
  Sandbox snapshots, at comparable latency (28 ms vs Vercel sub-second). This is the correct model.

Source: [Firecracker snapshot-support.md](https://github.com/firecracker-microvm/firecracker/blob/main/docs/snapshotting/snapshot-support.md),
[DEV.to 28ms sandbox](https://dev.to/adwitiya/how-i-built-sandboxes-that-boot-in-28ms-using-firecracker-snapshots-i0k)

---

## 5. Command Execution Channel

### Options

**SSH (key injected at create time):**
- Well understood. Works for both Arch A and Arch B.
- For Arch A: inject SSH key via `ssh_keys` in create API or cloud-init.
- For Arch B: SSH daemon in guest, host connects over VM's TAP network.
- Streaming stdout/stderr: SSH handles naturally via `ssh host 'command' 2>&1 | ...`.
- `execDetached`: backgrounded SSH command + log file.
- Drawback: TCP stack overhead, reconnect latency (~100 ms for new session), key management.
- Works on both architectures without custom guest code.

**In-VM HTTP/WebSocket agent:**
- Small agent process in guest listens on a port (e.g., 8080), exposes a REST or WebSocket API.
- Host reaches it over the TAP network (Arch B) or VM's public/private IP (Arch A).
- Streaming: WebSocket or SSE for stdout.
- Drawback: must be pre-installed in all VM images. Extra process in guest.
- Advantage: structured protocol, easy to add features (env vars, CWD, timeout, signal).

**Vsock (Firecracker virtio-vsock):**
- Host connects to guest over a virtio socket. No IP stack, no TCP. Direct kernel-to-kernel.
- Protocol: host connects to the UDS socket (`/path/to/v.sock`), sends `CONNECT PORT\n`,
  gets `OK PORT\n` acknowledgement; then streams command input and reads stdout/stderr back.
- Guest-side: a PID-1 agent binary listens on a vsock port (e.g., 5000). Executes commands
  via `os/exec`. Returns exit code.
- No IP address, no routing — eliminates a class of network-based attacks.
- **Arch B only** (vsock is a Firecracker/KVM feature not available on plain VMs).

**ForgeVM's production approach (Go binary, vsock + JSON):**
A real implementation built for AI sandboxes uses a custom `forgevm-agent` as PID 1 in the guest.
It listens on vsock and executes commands via `os/exec`. Length-prefixed JSON protocol:
`[4 bytes: message_length][JSON payload]`. Streaming stdout/stderr. The author notes gRPC-over-vsock
would have been cleaner, but the custom JSON protocol works.
Source: [ForgeVM architecture](https://dev.to/adwitiya/how-i-built-sandboxes-that-boot-in-28ms-using-firecracker-snapshots-i0k)

**Vsock snapshot caveat:** When restoring multiple VMs from the same snapshot, vsock CIDs collide.
The workaround: bind-mount each VM's vsock socket into a private mount namespace, or use
`vsock_override.uds_path` in the snapshot load API to give each restored VM a unique socket path.
Source: [Firecracker vsock.md](https://github.com/firecracker-microvm/firecracker/blob/main/docs/vsock.md)

### Recommendation

| Architecture | Recommended Exec Channel |
|---|---|
| Arch A (Cloud VM per sandbox) | SSH with pre-deployed key (lowest complexity) |
| Arch B (Firecracker microVM) | Vsock + lightweight guest agent (gRPC-over-vsock for streaming) |

For `execDetached` in both cases: background the process in the guest, return a `commandId`
(PID or UUID), poll/stream via the same channel.

For `domain(port)` implementation: the guest agent can report which ports have open listeners,
and the control plane registers those in the reverse proxy.

---

## 6. Cost Model

### Vercel Sandbox (Baseline, Pro plan)

Per the official pricing page:
- Active CPU: **$0.128/vCPU-hour** (only charges when CPU is actually running code, not waiting on I/O)
- Provisioned Memory: **$0.0212/GB-hour** (full wall-clock duration)
- Default: 2 vCPUs, 4 GB RAM

Example — 1-hour session with 4 vCPUs, 50% CPU utilization:
- CPU: 4 × 0.5 × $0.128 = **$0.256**
- Memory: 8 GB × 1 hr × $0.0212 = **$0.170**
- Total: **~$0.43/session-hour** (at 50% CPU)

At 100% CPU utilization:
- CPU: 4 × 1.0 × $0.128 = $0.512
- Memory: $0.170
- Total: **~$0.68/session-hour**

Source: [Vercel Sandbox pricing](https://vercel.com/docs/sandbox/pricing)

### Architecture A: Hetzner Cloud VM Per Sandbox

CX33 (4 vCPU, 8 GB RAM): **€0.0104/hour** (~$0.011/hour at current EUR/USD)

Billing: hourly, rounded up. Starts at creation, stops only at deletion. A stopped (powered-off)
server continues to accrue charges.

A 1-hour session: **~$0.011** — approximately **40× cheaper** than Vercel at 50% CPU utilization.

With 100 concurrent sessions (100 × CX33): ~$1.10/hour  
Vercel equivalent (100 × 4 vCPU, 50% utilization): ~$43/hour

The catch: If sessions are short-lived (5–15 minutes) but servers take 15–30 seconds to provision,
and you want pre-warming, you may keep a pool of warm VMs running even without active sessions.
The "idle tax" must be factored in.

### Architecture B: Firecracker on Dedicated Server

**AX102 host:** €109/month = **~$120/month** fixed cost.

At ~240 concurrent 512 MB sandboxes, or ~480 × 256 MB sandboxes:

- Monthly cost per concurrent slot (240 slots): $120/240 = **$0.50/concurrent-sandbox-month**
- Hourly equivalent per slot: $0.50/month ÷ 720 hours = **~$0.0007/slot-hour**

But "concurrent slots" ≠ "session-hours" (sessions are not all running simultaneously).
Assuming 50% average utilization across 240 slots:
- Total available: 240 × 720 = 172,800 session-hours/month
- At 50% utilization: 86,400 session-hours/month
- Cost per session-hour: $120 / 86,400 = **$0.0014/session-hour**

This is **300× cheaper** than Vercel at 50% CPU utilization per session-hour.

Even at 10% utilization: $120 / 17,280 = **$0.007/session-hour** — still **60× cheaper**.

**Minimum viable deployment (single AX41, ~€49/month, 8 cores, 64 GB, ~120 slots at 512 MB):**
- Cost per session-hour at 50% utilization: ~$0.0013/hr
- Break-even vs Vercel CX33 Cloud VM: at roughly 4–5 active sessions simultaneously, the dedicated
  server route starts winning on pure compute cost.

### Cost Comparison Table

| Approach | Per session-hour (4 vCPU equiv, 50% CPU util) | Fixed cost | Cold-start | Snapshot |
|---|---|---|---|---|
| Vercel Sandbox Pro | ~$0.43 | None | ~1 s (est.) | Sub-second (mem+disk) |
| Hetzner CX33 per-VM | ~$0.011 | None | 15–30 s | Minutes (disk only) |
| Hetzner AX102 Firecracker (50% util) | ~$0.0014 | $120/mo | 28 ms (snapshot restore) | 3–28 ms (mem+disk) |
| Hetzner AX102 Firecracker (10% util) | ~$0.007 | $120/mo | 28 ms | 3–28 ms |

**Winner on cost:** Arch B at any utilization above ~3–4 active sessions per dedicated host.
**Winner on operational simplicity:** Arch A (Hetzner Cloud VM per sandbox).
**Winner on cold-start + snapshot parity with Vercel:** Arch B (Firecracker snapshots).

---

## 7. Provider Design

### Interface Mapping

The existing `Sandbox` interface in `packages/sandbox/interface.ts` is the contract:

```typescript
interface Sandbox {
  type: SandboxType;
  workingDirectory: string;
  exec(command, cwd, timeoutMs, options?): Promise<ExecResult>
  execDetached?(command, cwd): Promise<{ commandId: string }>
  domain?(port: number): string
  stop(): Promise<void>
  snapshot?(): Promise<SnapshotResult>
  getState?(): unknown
  extendTimeout?(additionalMs): Promise<{ expiresAt: number }>
  // ... file system methods
}
```

### `HetznerSandbox` — Architecture A Design (Cloud VM per Sandbox)

**State tracked:**
```typescript
interface HetznerCloudState {
  type: "hetzner-cloud"
  serverId: number         // Hetzner server ID
  serverIp: string         // VM's private IP (within Hetzner network)
  serverPublicIp: string   // For SSH (or proxy only if private-net-only)
  snapshotId?: number      // Last snapshot ID (for restore)
  workingDirectory: string
  expiresAt?: number
  proxyRoutes: Record<number, string>  // port → public URL
}
```

**Control Plane Components (Arch A):**
1. **`HetznerCloudClient`**: Thin wrapper around `https://api.hetzner.cloud/v1`. Handles auth,
   rate limiting (max 1 req/s sustained), and retries on 429.
2. **`SSHClient`**: Connects to VM over SSH, runs exec, exec-detached, streams output.
3. **`ProxyRegistrar`**: Calls the Caddy/Traefik admin API to register/remove per-port routes.
4. **`SnapshotManager`**: Creates cloud server snapshots, tracks snapshot IDs, handles expiry.
5. **`VMPool`** (optional): Pre-warm a pool of VMs to reduce cold-start latency.

**Lifecycle — `create/connect`:**
```
1. POST /v1/servers (image, SSH key, user_data cloud-init, private network)
2. Poll server status until "running" (15–30 s)
3. Wait for SSH to become responsive (test with nc or SSH connect with retry)
4. Run afterStart hook (env setup, git clone, etc.)
5. Register in ProxyRegistrar (wildcard subdomain already covers it)
6. Return HetznerSandbox instance
```

**`exec(command, cwd, timeoutMs)`:**
```
ssh user@vm_private_ip "cd <cwd> && <command>"
Capture stdout, stderr, exit code with timeout enforcement.
```

**`execDetached(command, cwd)`:**
```
ssh user@vm_private_ip "cd <cwd> && nohup <command> > /tmp/cmd-<uuid>.log 2>&1 & echo $!"
Return { commandId: uuid }
```

**`domain(port)`:**
```
return `https://${sandboxId}-${port}.sandbox.${BASE_DOMAIN}`
Reverse proxy (Caddy) must already be configured to route this to vm_ip:port.
```

**`snapshot()`:**
```
1. POST /v1/servers/{id}/actions/create_image {"type": "snapshot"}
2. Poll action until complete (~2–10 minutes)
3. Return { snapshotId: image.id.toString() }
```

**`stop()`:**
```
1. beforeStop hook
2. Optional: create snapshot if persistent
3. DELETE /v1/servers/{id}  ← actually deletes the VM (billing stops)
4. Remove proxy routes via ProxyRegistrar
```

---

### `HetznerFirecrackerSandbox` — Architecture B Design (Firecracker on Dedicated Host)

This design assumes one (or more) dedicated servers, each running an orchestrator process.

**State tracked:**
```typescript
interface FirecrackerSandboxState {
  type: "hetzner-firecracker"
  hostId: string           // Which dedicated host
  vmId: string             // Unique per-VM UUID
  tapDevice: string        // e.g. "vmtap42" — unique per VM on host
  vmIp: string             // Internal IP (172.16.x.x/30)
  vsockUdsPath: string     // Host-side vsock socket path
  vsockGuestCid: number    // Guest CID
  snapshotPath?: string    // Path to mem+state snapshot on host NVMe
  rootfsPath: string       // Path to rootfs backing file
  forwardedPorts: Record<number, number>  // guestPort → hostPort
  workingDirectory: string
  expiresAt?: number
}
```

**Control Plane Components (Arch B):**
1. **`FirecrackerOrchestrator`**: Runs on the dedicated host. Manages the Firecracker process per
   VM, TAP devices, iptables port-forward rules, snapshot files.
2. **`VsockClient`**: Host-side client that connects to the VM's vsock socket and communicates
   with the in-VM guest agent.
3. **`GuestAgent`** (in-VM binary): Lightweight Go or Rust binary, PID 1 in the microVM.
   Listens on vsock port 5000. Accepts exec requests, streams stdout/stderr, returns exit code.
   On restore, re-listens on the same vsock port automatically.
4. **`ProxyRegistrar`**: Same as Arch A — registers port forwarding rules with Caddy/Traefik.
5. **`SnapshotStore`**: Manages snapshot files on host NVMe. Tracks base snapshots and per-VM
   COW overlays.
6. **`IPAllocator`**: Allocates unique TAP device names and /30 subnets for each VM.
   Example: VM 42 gets `vmtap42`, guest IP `172.16.42.2/30`, host IP `172.16.42.1/30`.

**Lifecycle — `create/connect`:**

*Cold start (no snapshot):*
```
1. Allocate TAP device + IP subnet
2. Launch Firecracker process (via jailer)
3. Configure VM via Firecracker API:
   - PUT /machine-config (vCPUs, mem)
   - PUT /drives/rootfs (rootfs backing file)
   - PUT /network-interfaces/eth0 (tap device)
   - PUT /vsock (uds_path, guest_cid)
   - PUT /boot-source (kernel, boot args with init=/guest-agent)
   - PUT /actions {"action_type": "InstanceStart"}
4. Wait for guest agent ready signal on vsock (~125 ms kernel + agent init)
5. Set up iptables DNAT for any pre-declared ports
6. Run afterStart hook (env, git clone, etc.)
```

*Resume from snapshot:*
```
1. Allocate new TAP device + IP subnet
2. Launch new Firecracker process
3. PUT /snapshot/load {snapshot_path, mem_file_path, network_overrides: [{iface_id: "eth0", host_dev_name: new_tap}]}
4. Guest resumes; vsock reconnects (agent re-listens on same port)
5. Re-register iptables DNAT rules for forwarded ports
6. Total: 28–50 ms
```

**`exec(command, cwd, timeoutMs)`:**
```
vsockClient.connect(vsockUdsPath)
vsockClient.send(CONNECT 5000\n)
vsockClient.send(JSON: {type: "exec", command, cwd, timeoutMs})
stream stdout/stderr back over the vsock connection
return { exitCode, stdout, stderr, truncated }
```

**`execDetached(command, cwd)`:**
```
vsockClient.send(JSON: {type: "exec-detached", command, cwd, commandId: uuid})
guest agent forks, writes output to /tmp/<uuid>.log
return { commandId: uuid }
```

**`domain(port)`:**
```
1. If port not already forwarded:
   hostPort = allocateHostPort(vmId, port)
   iptables -t nat -A PREROUTING -p tcp --dport hostPort -j DNAT --to 172.16.vmIdx.2:port
   proxyRegistrar.register(sandboxId, port, hostPort)
2. return `https://${sandboxId}-${port}.sandbox.${BASE_DOMAIN}`
```

**`snapshot()`:**
```
1. vsockClient.send({type: "prepare-snapshot"})  // flush buffers, quiesce FS
2. Firecracker: PATCH /vm {"state": "Paused"}
3. Firecracker: PUT /snapshot/create {
     snapshot_type: "Full",
     snapshot_path: "/snapshots/<vmId>/vmstate",
     mem_file_path: "/snapshots/<vmId>/mem"
   }
4. Copy rootfs backing file: cp /rootfs/<vmId>.ext4 /snapshots/<vmId>/rootfs.ext4
5. Firecracker: PATCH /vm {"state": "Resumed"}  (or terminate if stopping)
6. return { snapshotId: vmId }
```

**`stop()`:**
```
1. beforeStop hook (via vsock exec)
2. Optional: snapshot()
3. Kill Firecracker process
4. Remove TAP device
5. Remove iptables rules
6. Remove proxy routes
7. Optional: delete snapshot files if not persisting
```

**`getState()`:**
```
Returns FirecrackerSandboxState (serializable — stored in control-plane DB/Redis)
Used by factory to reconnect to a running VM after control-plane restart.
```

**Lifecycle Hooks:**

```typescript
interface SandboxHooks {
  afterStart?: (sandbox: Sandbox) => Promise<void>   // run env setup, git clone
  beforeStop?: (sandbox: Sandbox) => Promise<void>   // commit work, flush logs
  onTimeout?: (sandbox: Sandbox) => Promise<void>    // auto-snapshot before killing
  onTimeoutExtended?: (sandbox, additionalMs) => Promise<void>
}
```

**Timeout management (Arch B):**
Control plane tracks `expiresAt` per VM. Background goroutine fires `onTimeout` hook 30 s before
deadline, then kills the VM. `extendTimeout` updates `expiresAt` and cancels the timer.

---

## 8. Failure Modes & Gotchas

### Arch A Failure Modes

| Failure | Trigger | Symptom | Mitigation |
|---|---|---|---|
| Provisioning timeout | Hetzner infra slowness, region capacity | Server stuck in "creating" >60 s | Retry in different location; implement 90 s timeout with fallback |
| SSH not ready after server "running" | cloud-init still running | SSH connection refused | Retry SSH connect with exponential backoff up to 60 s |
| Orphaned IP/server billing | Crash of control plane after server created but before stop() | Billing continues indefinitely | Use Hetzner labels (`sandbox-id:<uuid>`) to audit and GC orphaned servers |
| API rate limit | High creation rates (>1/s) | 429 errors causing creation failures | Implement token bucket; queue creation requests; use separate API tokens per team/project |
| Snapshot creation during high load | Snapshot takes >10 min for large disks | Timeout in job queue | Run snapshot asynchronously; don't block session close on it |
| Stopped server still billed | Operator powers off instead of deleting | Silent cost leak | Control plane MUST DELETE servers (not stop them) to end billing |
| Cloud-init failure | Bad user_data YAML | VM running but agent not installed | Include health check in cloud-init that reports status; fail-fast on creation |

### Arch B (Firecracker) Failure Modes

| Failure | Trigger | Symptom | Mitigation |
|---|---|---|---|
| KVM not available | Using wrong Hetzner product (Cloud VM) | Firecracker fails to start with "no KVM" error | Verify KVM with `ls /dev/kvm` before deploying; only use dedicated servers |
| Vsock CID collision | Restoring multiple VMs from same snapshot without unique UDS paths | VMs unable to communicate on vsock | Use `vsock_override.uds_path` on snapshot load; unique path per VM instance |
| TAP device leak | Control plane crash between VM creation and TAP allocation | `RTNETLINK answers: File exists` on next allocation | Track TAP devices in persistent state; clean up on startup |
| Guest rootfs full | Disk-intensive workloads filling the virtio-block backing file | Write errors in guest | Pre-size backing files generously; monitor with `df` via vsock exec |
| Snapshot memory file lost | NVMe failure, or file deleted while VM running | VM crash; data loss | Mirror snapshot files to Hetzner Volume (network storage) for durability |
| No live migration | Need to move VM to another host | Session stuck on failed host | Stateless workloads: restore from last snapshot on new host. Stateful: data loss |
| Port forward table exhaustion | Too many VMs with many ports each on single host | iptables rule limit, or host port exhaustion | Limit ports per VM; use Caddy dynamic routing instead of iptables PREROUTING |
| Guest agent not ready after snapshot restore | Vsock connection succeeds but agent is still starting | Timeout on first exec | Implement handshake/ping on vsock after restore; retry for 200 ms |
| Jailer privilege misconfiguration | Incorrect UID/GID or seccomp filter | Firecracker process fails to start | Test jailer config in staging; pin to specific seccomp profiles |
| Host memory pressure | Too many VMs + guest memory not paged out | OOM killer on host | Reserve 10–15% host RAM for OS/network; enforce per-VM RAM limits via cgroups |

### Cross-Cutting Gotchas

1. **Firecracker requires a Linux HOST.** macOS development requires a fallback (Docker/gVisor)
   since Firecracker/KVM is unavailable. The ForgeVM project handles this with a provider switch.

2. **Dedicated server delivery time.** Hetzner dedicated servers are NOT instant — they take
   1–3 business days to provision. Build POC scheduling must account for this.

3. **Dedicated server is monthly, not hourly.** If you provision an AX102 for testing and don't
   use it, you still pay the full month. Plan accordingly.

4. **Firecracker Linux-only guests.** Windows guests are not supported.
   Source: [Firecracker design.md](https://github.com/firecracker-microvm/firecracker/blob/main/docs/design.md)

5. **No network filtering in Firecracker.** The host must implement iptables/nftables rules to
   control what the guest VM can reach externally. Without this, sandboxes can exfiltrate data or
   attack external systems.

6. **Diff snapshots are in developer preview** and not production-ready. Full snapshots only for
   production use.
   Source: [Firecracker snapshot-support.md](https://github.com/firecracker-microvm/firecracker/blob/main/docs/snapshotting/snapshot-support.md)

7. **Snapshot security: replay attacks.** Restoring the same memory snapshot twice may reuse
   random seeds, UUIDs, and cryptographic tokens. Ensure VMGenID device is used (Linux 5.18+)
   and any application-level UUIDs are re-generated after restore.

8. **cloud-init on Hetzner has a 32 KiB limit** on `user_data`. Complex bootstrap scripts may
   need to download from an external URL rather than being inlined.

9. **Hetzner API rate limit 3600/hr.** At 1 sandbox/second provisioning rate, you will hit this.
   Use multiple API tokens across multiple projects if needed.

---

## 9. Expectation Gaps

### Gap 1: "Hetzner Cloud VMs support nested KVM/Firecracker"
**Common assumption:** Since Hetzner is cheap and flexible, any Hetzner VM can run Firecracker.

**Reality:** Hetzner Cloud VMs (CX/CAX/CPX/CCX) do NOT support nested virtualization. Running
Firecracker, Kata Containers, or QEMU with KVM acceleration inside a Hetzner Cloud VM is not
possible. Only Hetzner **dedicated (bare-metal) servers** have the hardware virtualization
extensions passed through to the OS.

Source: [Proxmox on Hetzner Cloud blog](https://bennetgallein.de/blog/proxmox-on-hetzner-cloud),
community docs, and the PVM project documentation (PVM is experimental and not mainline).

### Gap 2: "Hetzner Cloud server snapshots work like memory snapshots"
**Common assumption:** "Snapshot" will preserve the full running state (like a hypervisor checkpoint).

**Reality:** Hetzner Cloud server snapshots are disk-only, async, take minutes, and require
creating a new server to restore. They are functionally similar to an AMI in AWS, not a VM pause.
For session hibernate/resume (as used in Vercel Sandbox), Arch A is a poor fit.

Source: [Hetzner snapshot docs](https://docs.hetzner.com/cloud/servers/getting-started/taking-snapshots/)

### Gap 3: "Stopped Hetzner Cloud servers don't cost money"
**Common assumption:** Like AWS (stopped EC2 = no compute charges, only storage), stopping a
Hetzner server saves money.

**Reality:** Hetzner charges for stopped servers because resources (CPU, RAM) remain allocated.
Billing stops only when the server is **DELETED**. A "paused" session that keeps a server powered
off accrues the same hourly cost as a running one. For session management, DELETE is the right
lifecycle event, not stop/shutdown.

Source: [Hetzner pricing model](https://docs.hetzner.cloud/reference/cloud)

### Gap 4: "Firecracker snapshot restore requires loading full memory from disk"
**Common assumption:** Snapshot restore means reading all of guest RAM from a file, which would
take seconds for a 512 MB guest.

**Reality:** Firecracker uses `MAP_PRIVATE` (lazy copy-on-write) for the memory backend. Only
pages that are actually accessed are faulted in from the file. This is why restore is 3–28 ms
(the minimal page faults at startup) rather than seconds. The memory file must stay on disk
for the VM's entire lifetime, but it is not read eagerly.

Source: [Firecracker snapshot-support.md](https://github.com/firecracker-microvm/firecracker/blob/main/docs/snapshotting/snapshot-support.md)

### Gap 5: "Vsock is a network protocol — it can be blocked like TCP"
**Common assumption:** Guest-to-host communication can be firewalled at the network layer.

**Reality:** Vsock bypasses the host's network stack entirely. It is a virtio device; there is no
IP address, no port number in the TCP sense, no iptables rule that can block it. The only controls
are at the hypervisor configuration level (enabling/disabling the device) and the guest agent's
own access control. This is both a security feature (no network attack surface) and something to
understand in your threat model.

Source: [Firecracker vsock.md](https://github.com/firecracker-microvm/firecracker/blob/main/docs/vsock.md)

### Gap 6: "Hetzner dedicated server ordering is fast like cloud VMs"
**Common assumption:** Ordering a Hetzner AX102 is like creating a CX33 — seconds.

**Reality:** Hetzner dedicated servers have a delivery time of **1–3 business days** (sometimes
longer with setup fees). The "Server Auction" (`hetzner.com/sb`) offers immediate availability for
some servers but with fixed configurations.

Source: [Hetzner dedicated server overview](https://www.hetzner.com/dedicated-rootserver/)

---

## 10. Recommendation Summary

### Primary Recommendation: Architecture B — Firecracker MicroVMs on a Hetzner Dedicated Server

**Build the POC on Arch B.**

#### Rationale

1. **Snapshot/resume parity with Vercel.** Firecracker snapshot restore at 3–28 ms is the only
   self-hosted path that replicates Vercel Sandbox's fast session resume. Arch A's disk-only
   snapshots (5–15 min) cannot support the open-agents session model.

2. **Cost at scale.** At any realistic load above ~5 concurrent sessions, a dedicated server running
   Firecracker microVMs is 40–300× cheaper than Vercel Sandbox or even Hetzner Cloud VMs. An
   AX102 at €109/month supporting 200+ concurrent sandboxes costs <$0.002/session-hour vs Vercel's
   ~$0.43/session-hour.

3. **Security isolation.** Arch B (Firecracker + jailer) provides hardware-level isolation per
   sandbox with its own kernel. This matches the threat model for untrusted AI agent code.

4. **The exec channel (vsock) is robust.** Vsock provides a direct kernel-to-kernel channel without
   IP stack complexity. No SSH key management, no network-based attacks.

#### When to Consider Arch A Instead

- **Low volume / prototype:** < 20 sessions/day where operational simplicity dominates.
- **No available KVM host:** Waiting for dedicated server delivery (1–3 days).
- **Long-running background tasks** where 15–30 s cold-start is acceptable.
- **Dev/test** where Arch B's operational complexity is too high.

#### Hybrid Approach

Use Arch A as the fallback for the POC (immediately runnable with a Hetzner API key) and Arch B as
the production path. The `Sandbox` interface allows swapping providers without changing agent code.

### What to Build for the POC

**Phase 1 (Immediate, Arch A fallback):**
- `HetznerCloudSandbox` implementing the `Sandbox` interface
- SSH exec channel, cloud-init bootstrap
- Caddy reverse proxy with wildcard DNS for `domain(port)`
- Manual snapshot (disk-only, accept the latency)

**Phase 2 (Dedicated server, Arch B production):**
- Firecracker orchestrator on AX41 or AX51 dedicated server
- Custom guest agent (vsock + gRPC or length-prefixed JSON)
- Snapshot/restore with COW rootfs
- Port forwarding via iptables + Caddy proxy registration

---

## 11. Top Blind Spots for the Build POC

1. **Actual provisioning time with cloud-init complexity.** The 15–30 s figure assumes a minimal
   cloud-init. If the cloud-init script installs packages (bun, node, git, custom binaries),
   it may take 2–5 minutes. Measure actual time-to-exec-ready, not just time-to-running.

2. **Firecracker kernel compatibility.** The guest kernel must be compiled with specific config
   options. Standard Ubuntu/Debian kernels may not work directly — a custom kernel is required.
   The Firecracker project provides a script (`resources/guest_configs`) but building takes time.
   Verify the kernel works before the POC assumes it.

3. **Vsock snapshot CID collision in practice.** The theoretical workaround (unique UDS path per VM)
   must be validated with actual snapshot restore of multiple concurrent VMs. The Firecracker vsock
   docs note "limited snapshot support" — the exact limitations need hands-on testing.

4. **iptables DNAT at scale.** Managing per-port, per-VM iptables rules for 200+ VMs with
   potentially 15 ports each is thousands of rules. This may impact network performance or hit
   kernel limits. Evaluate nftables (more scalable) vs iptables for the port-forward layer.

5. **COW rootfs semantics.** Each VM needs its own writable rootfs. Options are: (a) copy the
   base ext4 file per VM (slow, disk-intensive), (b) use a device mapper thin provisioned volume
   (complex setup), or (c) use an overlayfs-backed approach. The right choice needs benchmarking.

6. **Caddy dynamic routing latency.** When a sandbox starts a dev server on port 3000 and the agent
   calls `domain(3000)`, the proxy must be registered before the URL is reachable. Measure the
   Caddy admin API latency and ensure it is < 500 ms.

7. **Guest agent reliability on snapshot restore.** After restoring from a snapshot, the guest
   agent must immediately be responsive on vsock. Measure time from `snapshot/load` completion to
   first successful vsock exec. If the agent takes >100 ms to re-establish its listener, this
   affects session resume latency.

8. **Hetzner dedicated server availability.** Order the test server before starting the POC build.
   Account for 1–3 day delivery time.

9. **Network egress control (iptables allow-list).** Vercel Sandbox uses a network policy object
   to control egress. The self-hosted version needs iptables-based egress filtering per VM.
   This is complex — establish a simple "default allow with logging" first, then layer in filtering.

10. **Control-plane persistence across restarts.** The orchestrator process must track all running
    VMs (their TAP devices, vsock paths, snapshot states) in persistent storage (PostgreSQL or Redis).
    If the orchestrator crashes, it must recover state without losing track of running VMs or leaking
    TAP devices/iptables rules.

---

## 12. Sources

| URL | Title | Credibility | Notes |
|---|---|---|---|
| https://docs.hetzner.cloud/reference/cloud | Hetzner Cloud API Reference | Official | Primary API spec |
| https://costgoat.com/pricing/hetzner | Hetzner Cloud VPS Pricing Calculator | Third-party | Accurate as of May 2026 |
| https://github.com/firecracker-microvm/firecracker/blob/main/SPECIFICATION.md | Firecracker SPECIFICATION.md | Official | Boot time, memory overhead specs |
| https://github.com/firecracker-microvm/firecracker/blob/main/docs/snapshotting/snapshot-support.md | Firecracker snapshot-support.md | Official | Snapshot types, creation/restore workflow |
| https://github.com/firecracker-microvm/firecracker/blob/main/docs/vsock.md | Firecracker vsock.md | Official | Vsock device config, protocol, snapshot caveats |
| https://github.com/firecracker-microvm/firecracker/blob/main/docs/design.md | Firecracker design.md | Official | Security model, jailer, TAP networking |
| https://github.com/firecracker-microvm/firecracker/blob/main/docs/snapshotting/network-for-clones.md | Firecracker network-for-clones.md | Official | Network reconfiguration after snapshot restore |
| https://dev.to/adwitiya/how-i-built-sandboxes-that-boot-in-28ms-using-firecracker-snapshots-i0k | How I built sandboxes that boot in 28ms | Community | ForgeVM architecture, vsock, COW details |
| https://vercel.com/docs/sandbox/pricing | Vercel Sandbox pricing and limits | Official | Exact pricing, billing model, limits |
| https://caddyserver.com/docs/automatic-https | Caddy Automatic HTTPS | Official | TLS, wildcard cert, DNS-01 challenge |
| https://lowendtalk.com/discussion/184625/ | Hetzner Cloud provisioning speed discussion | Community | 15–30 s SSH-ready evidence |
| https://northflank.com/blog/firecracker-vs-gvisor | Firecracker vs gVisor | Vendor-blog | Isolation comparison |
| https://northflank.com/blog/kata-containers-vs-firecracker-vs-gvisor | Kata vs Firecracker vs gVisor | Vendor-blog | Three-way comparison |
| https://bennetgallein.de/blog/proxmox-on-hetzner-cloud | Proxmox on Hetzner Cloud | Community | KVM not available on Hetzner Cloud VMs |
| https://docs.hetzner.com/cloud/servers/getting-started/taking-snapshots/ | Hetzner Cloud snapshot docs | Official | Snapshot creation and limits |
| https://blog.alexellis.io/how-to-run-firecracker-without-kvm-on-regular-cloud-vms/ | Running Firecracker without KVM (PVM) | Community | PVM experimental approach, limitations |
| https://github.com/firecracker-microvm/firecracker/issues/1184 | Firecracker full snapshot GitHub issue | Official | Historical context on snapshot development |
| https://www.hetzner.com/dedicated-rootserver/ax102/ | Hetzner AX102 product page | Official | Specs and pricing |
| https://github.com/hetznercloud/hcloud-go/issues/79 | Hetzner API rate limits issue | Community | 3600 req/hr confirmed |
| https://caddyserver.com/docs/caddyfile/patterns | Caddy Caddyfile Patterns | Official | Wildcard subdomain config patterns |
| https://firecracker-microvm.github.io/ | Firecracker homepage | Official | 150 microVMs/sec, 125 ms boot, <5 MB overhead |
| https://docs.hetzner.com/general/infrastructure-and-availability/ipv4-pricing/ | Hetzner IP pricing | Official | Primary IP €0.50/mo, floating IP ~€3/mo |
