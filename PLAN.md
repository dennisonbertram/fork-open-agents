Summary: Research and document a proof of concept for turning sandbox service previews, browser automation, logs, security, and network policy into first-class Open Agents product features instead of ad hoc shell behavior. The final blueprint is `docs/plans/sandbox-runtime-preview-browser-poc.md`.

Context: The existing sandbox abstraction already exposes shell execution, detached processes, public port URLs, snapshots, and persistent Vercel sandbox reconnection. Current dev-server and code-editor routes prove services can run in the sandbox, but their state is split between sandbox-local PID/state files and client-local UI state. The agent can run detached shell commands and the base sandbox prompt references `agent-browser`, but there are no typed preview or browser-evidence tools. Current Vercel docs confirm exposed ports, `domain(port)`, detached command streams, network policy updates, and a documented 15-port exposure limit.

System Impact: The proposed POC moves runtime service truth into Postgres records keyed by session, keeps PID/log files as sandbox-local probes, adds browser proof records/artifacts, and makes network policy explicit at session level. It preserves `packages/sandbox` as the provider boundary and extends it only with optional provider capabilities for route enumeration, port updates, and network policy updates.

Approach: Add a focused `apps/web/lib/sandbox/runtime/*` layer and new runtime API routes, then keep existing dev-server routes as compatibility wrappers. The first POC cut should implement service registry/logs and one browser proof run while keeping fixed ports and read-only network policy visibility. Dynamic ports, mutable network policy, and authenticated preview proxying should follow after provider capability checks and security decisions.

Changes:
- `PLAN.md` - concise summary of the research/design outcome.
- `docs/plans/sandbox-runtime-preview-browser-poc.md` - detailed POC plan and implementation blueprint covering current findings, provider docs, data model, API routes, agent tools, UI, security, lifecycle, phases, and verification.

Verification:
- Reviewed against current sandbox provider, dev-server, code-editor, lifecycle, agent tool, and UI code paths.
- Fetched current Vercel Sandbox documentation with Context7 and incorporated provider constraints.
- Run `bun --bun run check` for Markdown formatting/linting if practical.
