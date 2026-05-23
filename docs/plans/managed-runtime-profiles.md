# Managed Runtime Profiles

Managed runtime should evolve from a single hard-coded environment into a user-selectable, observable sandbox profile system.

## Near-Term Baseline

- Keep the current managed runtime mode opt-in.
- Treat the automatic Bun bootstrap as a compatibility fallback for repositories that already expect Bun, not as the long-term environment model.
- Show the selected runtime mode in the chat UI before work starts and keep sandbox actions visible with disabled-state explanations.
- Stream setup status into chat while the managed runtime is preparing tools.

## Profile Model

A managed runtime profile should describe:

- setup commands or a setup script
- optional base snapshot id
- profile version
- expected tools and verification commands
- exposed ports
- allowed safe environment variables
- display name and short user-facing description

Profiles should be versioned so sessions can record which runtime environment they used. Old profiles/snapshots should remain addressable for replay, debugging, and incremental migration.

## Setup Flow

The product should support both manual and assisted setup:

- Manual: user edits setup commands/scripts and runs a profile validation job.
- Assisted: the system inspects repository metadata, lockfiles, package scripts, and failed tool probes, then proposes setup steps.
- Snapshot: once setup passes, create a reusable sandbox snapshot for faster startup.
- Verification: each profile should have explicit probes such as `command -v bun`, `bun --version`, `command -v agent-browser`, or repo-specific checks.

## Observability

Managed runtime sessions should surface:

- active sandbox count
- sandbox names/ids and profile versions
- per-sandbox status: creating, installing, ready, running task, failed, hibernated
- current activity per sandbox
- setup/probe output summaries
- links to service previews, logs, and browser-check results

If the top-level agent coordinates multiple sandboxes, each sandbox should emit status events that the chat can group by sandbox.

## Environment Variables

Do not blindly inject user or project secrets into sandboxes. The environment variable policy should distinguish:

- safe public/config values
- scoped service credentials
- repo-specific build-time secrets
- secrets that must stay brokered outside the sandbox

Before broad secret injection, design an allowlist/redaction model and make injected values auditable without exposing their contents in chat or logs.
